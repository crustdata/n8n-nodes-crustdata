'use strict';
// Runs against dist/, so `npm run build` must come first. CI orders them that way.
//
// `test` and `expect` are vitest globals rather than node:test imports. n8n's verification
// scan rejects any import that is neither a devDependency nor on its short allowlist, and
// the Node builtins are on neither, so a test file importing node:test fails the scan even
// though `files: ["dist"]` never ships it.
//
// The assert surface is kept as a thin shim over expect: the point of the move is to drop a
// restricted import, not to restate 89 assertions in a second dialect.
const assert = {
	equal: (actual, expected, message) => expect(actual, message).toBe(expected),
	deepEqual: (actual, expected, message) => expect(actual, message).toStrictEqual(expected),
	ok: (value, message) => expect(value, message).toBeTruthy(),
	match: (value, re, message) => expect(value, message).toMatch(re),
	doesNotMatch: (value, re, message) => expect(value, message).not.toMatch(re),
	fail: (message) => expect.fail(message),
	rejects: async (fn, re, message) => await expect(fn(), message).rejects.toThrow(re),
	doesNotThrow: (fn, message) => expect(fn, message).not.toThrow(),
	doesNotReject: async (fn, message) => await expect(fn(), message).resolves.not.toThrow(),
};

const { buildFilters } = require('../dist/nodes/Crustdata/filters');
const { splitArrayRoot, splitIntoItems } = require('../dist/nodes/Crustdata/response');
const { attachUsage } = require('../dist/nodes/Crustdata/usage');

const row = (field, operator, value) => ({ field, operator, value: { mode: 'text', value } });
const ctx = (params) => ({ getNodeParameter: (name, fallback) => params[name] ?? fallback });

test('operator aliases become the API tokens n8n cannot store directly', () => {
	assert.deepEqual(buildFilters('and', [row('a', 'eq', '1')]), { field: 'a', type: '=', value: '1' });
	assert.equal(buildFilters('and', [row('a', 'gte', '1')]).type, '=>');
	assert.equal(buildFilters('and', [row('a', 'lte', '1')]).type, '=<');
});

test('a lone condition is not wrapped, except under all_of', () => {
	assert.equal(buildFilters('and', [row('a', 'eq', '1')]).op, undefined);
	assert.deepEqual(buildFilters('all_of', [row('a', 'eq', '1')]), {
		op: 'all_of',
		conditions: [{ field: 'a', type: '=', value: '1' }],
	});
});

test('rows that cannot make a filter are dropped, and an empty build is undefined', () => {
	// The API rejects `value: []`, so an unfilled list row must not ship.
	assert.equal(buildFilters('and', [row('a', 'in', '  ')]), undefined);
	assert.equal(buildFilters('and', [row('', 'eq', 'x')]), undefined);
	assert.equal(buildFilters('and', []), undefined);
	assert.deepEqual(buildFilters('and', [row('a', 'in', 'x, y')]).value, ['x', 'y']);
});

test('no null-check operator is offered, because v2 search has none', () => {
	const { FILTER_OPERATORS } = require('../dist/nodes/Crustdata/filter-fields.generated');
	const values = FILTER_OPERATORS.map((o) => o.value);
	assert.ok(!values.includes('is_null') && !values.includes('is_not_null'));
});

test('an empty array answer keeps the row instead of deleting it', async () => {
	const items = [{ json: { in: 1 } }];
	assert.deepEqual(await splitArrayRoot.call(ctx({}), items, { body: [] }), items);
	assert.deepEqual(await splitArrayRoot.call(ctx({}), items, { body: {} }), items);
});

test('a bare array answer becomes one item per element', async () => {
	const out = await splitArrayRoot.call(ctx({}), [{ json: {} }], { body: [{ a: 1 }, { a: 2 }] });
	assert.deepEqual(out.map((i) => i.json), [{ a: 1 }, { a: 2 }]);
});

test('the envelope is kept whole unless splitting is asked for, and never emptied', async () => {
	const envelope = [{ json: { profiles: [{ a: 1 }], total_count: 9 } }];
	assert.deepEqual(await splitIntoItems.call(ctx({ splitIntoItems: false }), envelope), envelope);

	const split = await splitIntoItems.call(ctx({ splitIntoItems: true }), envelope);
	assert.deepEqual(split.map((i) => i.json), [{ a: 1 }]);

	const empty = [{ json: { profiles: [], total_count: 0 } }];
	assert.deepEqual(await splitIntoItems.call(ctx({ splitIntoItems: true }), empty), empty);
});

test('usage is opt-OUT and never explodes a non-object payload', async () => {
	const headers = { 'x-credits-used': '3' };
	const items = [{ json: { a: 1 } }];
	assert.deepEqual(await attachUsage.call(ctx({ includeUsage: false }), items, { headers }), items);

	const on = await attachUsage.call(ctx({ includeUsage: true }), items, { headers });
	assert.deepEqual(on[0].json, { a: 1, usage: { creditsUsed: 3 } });

	// Absent, not false: a model driving this node sees no spend unless the default is on,
	// and n8n's auto tool description cannot carry the price either.
	const byDefault = await attachUsage.call(ctx({}), items, { headers });
	assert.deepEqual(byDefault[0].json, { a: 1, usage: { creditsUsed: 3 } });

	const scalar = [{ json: 'abc' }];
	assert.deepEqual(await attachUsage.call(ctx({ includeUsage: true }), scalar, { headers }), scalar);

	// The property default is what governs a new workflow; the fallback above only covers a
	// parameter that is absent entirely.
	const { Crustdata: Node } = require('../dist/nodes/Crustdata/Crustdata.node.js');
	const toggles = new Node().description.properties.filter((p) => p.name === 'includeUsage');
	assert.ok(toggles.length > 0, 'no Include Usage toggle found');
	for (const t of toggles) assert.equal(t.default, true, 'Include Usage must default on');
});

const { buildSorts } = require('../dist/nodes/Crustdata/sort');
const { cursorPagination } = require('../dist/nodes/Crustdata/pagination');

test('sort rows without a field are dropped, and order defaults to ascending', () => {
	assert.deepEqual(buildSorts([{ field: 'a', order: 'desc' }, { order: 'asc' }, { field: 'b' }]), [
		{ field: 'a', order: 'desc' },
		{ field: 'b', order: 'asc' },
	]);
	assert.deepEqual(buildSorts([]), []);
});

// Fakes one page per scripted response, recording the body each call was made with.
const pager = (pages, params = {}) => {
	const calls = [];
	// cursorPagination reads resource/operation to find that endpoint's page cap.
	const withRoute = { resource: 'person', operation: 'search', ...params };
	const ctx = {
		getNodeParameter: (name, fallback) => withRoute[name] ?? fallback,
		async makeRoutingRequest(req) {
			calls.push(JSON.parse(JSON.stringify(req.options.body)));
			return pages[calls.length - 1] ?? [{ json: {} }];
		},
	};
	return { ctx, calls };
};
const envelope = (cursor) => [{ json: { profiles: [{ a: 1 }], next_cursor: cursor } }];

test('paging stops when the envelope carries no next cursor', async () => {
	const { ctx, calls } = pager([envelope('c1'), envelope(null)], { pageSize: 2, maxResults: 100 });
	const out = await cursorPagination().call(ctx, { options: { body: {} } });
	assert.equal(calls.length, 2);
	assert.equal(out.length, 2);
	assert.equal(calls[0].cursor, undefined, 'no cursor on the first page');
	assert.equal(calls[1].cursor, 'c1');
});

test('a repeated cursor stops the loop instead of spinning forever', async () => {
	const { ctx, calls } = pager([envelope('same'), envelope('same'), envelope('same')], {
		pageSize: 1,
		maxResults: 100,
	});
	await cursorPagination().call(ctx, { options: { body: {} } });
	assert.equal(calls.length, 2);
});

test('the budget is counted in results and never overshot, because search bills per result', async () => {
	// Three results per page, budget of 5: the second page must ask for 2, not 3.
	const page = (cursor) => [
		{ json: { profiles: [{ a: 1 }, { a: 2 }, { a: 3 }], next_cursor: cursor } },
	];
	const { ctx, calls } = pager([page('c1'), page('c2'), page('c3')], {
		pageSize: 3,
		maxResults: 5,
	});
	await cursorPagination().call(ctx, { options: { body: {} } });
	assert.deepEqual(calls.map((c) => c.limit), [3, 2]);
});

test('page size is clamped to the endpoint maximum whatever the user typed', async () => {
	const { ctx, calls } = pager([envelope(null)], { pageSize: 99999, maxResults: 100000 });
	await cursorPagination().call(ctx, { options: { body: {} } });
	assert.equal(calls[0].limit, 1000);
});

const { sendFilters } = require('../dist/nodes/Crustdata/filters');
const { sendSemanticSearch } = require('../dist/nodes/Crustdata/resources/company/search');

const ctxOf = (params) => ({ getNodeParameter: (name, fallback) => params[name] ?? fallback });

const preSendCtx = (params) => ({
	getNodeParameter: (name, fallback) => (name in params ? params[name] : fallback),
	getNode: () => ({ name: 'Crustdata', type: 'CUSTOM.crustdata', typeVersion: 1 }),
});

test('search is sent whole or not at all, because the API refuses an empty query', async () => {
	// Routing the query straight to search.query put "" there and the call 400d.
	const blank = await sendSemanticSearch.call(preSendCtx({ query: '   ' }), { body: { limit: 5 } });
	assert.deepEqual(blank.body, { limit: 5 });

	const set = await sendSemanticSearch.call(
		preSendCtx({ query: ' fintech rails ', searchMode: 'semantic' }),
		{ body: { limit: 5 } },
	);
	assert.deepEqual(set.body, { limit: 5, search: { query: 'fintech rails', mode: 'semantic' } });
});

test('nothing reaches a legacy API', () => {
	const gen = require('../dist/nodes/Crustdata/filter-fields.generated');
	const { API_VERSION } = require('../dist/credentials/CrustdataApi.credentials');

	// The credential's version and the spec the tables were generated from are declared in
	// two files. Drift between them is how a caller ends up on an older surface without
	// anyone choosing to, so they are pinned to each other rather than to a literal.
	assert.equal(API_VERSION, gen.SPEC_VERSION);

	const reachable = [
		...gen.SYNC_ENDPOINTS.map((e) => e.path),
		...gen.BATCH_ENDPOINTS.map((e) => e.path),
		...gen.WATCH_ROUTES.map((r) => r.split(' ')[1]),
	];
	assert.ok(reachable.length > 50, 'endpoint lists look empty');
	for (const path of reachable) {
		assert.doesNotMatch(path, /\/(screener|v1)\b/, `${path} is a legacy path`);
	}
});

test('a new request parameter or watch route fails the build', () => {
	const { REQUEST_PARAMS, WATCH_ROUTES } = require('../dist/nodes/Crustdata/filter-fields.generated');

	// The generated pickers cannot see either of these. A request parameter we never send is
	// just a narrower query, not an error, which is how three went missing unnoticed; and
	// /watch is excluded from SYNC_ENDPOINTS, so routes added there produced no diff at all.
	// Pinning the SPEC's own lists means a change upstream is a red build and somebody decides,
	// rather than a list of ours that quietly goes stale.
	const pinned = {
		'/person/search': ['count', 'cursor', 'explain', 'fields', 'filters', 'limit', 'post_processing', 'preview', 'return_query', 'sorts'],
		'/person/enrich': ['fields', 'preview', 'professional_network_profile_urls'],
		'/person/contact/enrich': ['business_emails', 'fields', 'professional_network_profile_urls', 'verified'],
		'/company/search': ['cursor', 'fields', 'filters', 'limit', 'search', 'sorts'],
		'/company/enrich': ['crustdata_company_ids', 'domains', 'exact_match', 'fields', 'names', 'professional_network_profile_urls'],
		'/company/identify': ['crustdata_company_ids', 'domains', 'exact_match', 'fields', 'names', 'professional_network_profile_urls'],
		'/job/search': ['aggregations', 'cursor', 'fields', 'filters', 'limit', 'sorts'],
		'/social_post/search': ['cursor', 'fields', 'filters', 'limit', 'sorts'],
		'/web/search/live': ['end_date', 'human_mode', 'location', 'page', 'query', 'site', 'sources', 'start_date'],
		'/web/enrich/live': ['human_mode', 'urls'],
	};

	for (const [path, params] of Object.entries(pinned)) {
		assert.deepEqual(
			REQUEST_PARAMS[path],
			params,
			`${path} request parameters changed upstream; wire the new one or pin it deliberately`,
		);
	}

	// Deliberately unsent on person search: `count` is the spec's own alias for `limit`, and
	// `return_query` echoes the internal query back for debugging.
	assert.ok(REQUEST_PARAMS['/person/search'].includes('count'));
	assert.ok(REQUEST_PARAMS['/person/search'].includes('return_query'));

	assert.equal(WATCH_ROUTES.length, 20, 'watch routes changed upstream; the Watch resource may need one');
	for (const route of ['GET /watch/{watch_id}', 'PATCH /watch/{watch_id}', 'DELETE /watch/{watch_id}']) {
		assert.ok(WATCH_ROUTES.includes(route), `${route} missing`);
	}
});

test('a country name in an ISO-3 column is refused before it returns zero rows', async () => {
	const { ISO3_FILTER_COLUMNS } = require('../dist/nodes/Crustdata/geo-formats');
	const { PERSON_FILTER_FIELDS } = require('../dist/nodes/Crustdata/filter-fields.generated');

	// value_format is not in the spec, so this list is hand-kept. A renamed column would
	// disarm the guard silently, which is exactly the failure the guard exists to prevent.
	for (const column of ISO3_FILTER_COLUMNS) {
		assert.ok(PERSON_FILTER_FIELDS.includes(column), `${column} is no longer a filter column`);
	}

	const col = 'experience.employment_details.current.company_headquarters_country';
	const row = (value, operator = 'eq') => ({
		'filters.condition': [{ field: col, operator, value }],
		combinator: 'and',
		resource: 'person',
	});

	// The name is the trap: structurally valid, so the API answers zero rows and ok.
	await assert.rejects(
		() => sendFilters().call(preSendCtx(row('United States')), { body: {} }),
		/wants an ISO-3 country code/,
	);
	// An alias the store does not hold is just as wrong, and just as silent.
	for (const bad of ['Czech Republic', 'Turkey', 'UK', 'us']) {
		await assert.rejects(
			() => sendFilters().call(preSendCtx(row(bad)), { body: {} }),
			/wants an ISO-3 country code/,
			`accepted ${bad}`,
		);
	}
	// Inside a list operator, every element is checked.
	await assert.rejects(
		() => sendFilters().call(preSendCtx(row('DEU,France', 'in')), { body: {} }),
		/wants an ISO-3 country code/,
	);

	// A three-letter token passes even when this table does not carry it: the live API owns
	// which codes exist, and rejecting the tail would be worse than the trap.
	const ok = await sendFilters().call(preSendCtx(row('SVK')), { body: {} });
	assert.equal(ok.body.filters.value, 'SVK');

	// Any casing passes, because the API matches these case-insensitively: "usa" returns
	// what "USA" returns (verified live 2026-09-22). So no alias may be three letters.
	const lower = await sendFilters().call(preSendCtx(row('usa')), { body: {} });
	assert.equal(lower.body.filters.value, 'usa');

	// A misspelling nothing maps exactly still gets corrected, through the nearest-valid
	// scorer rather than the alias table. Untested, this branch could rot unnoticed.
	for (const [typo, want] of [['Unite States', 'USA'], ['Germny', 'DEU'], ['Netherlads', 'NLD']]) {
		let thrown;
		try {
			await sendFilters().call(preSendCtx(row(typo)), { body: {} });
		} catch (error) {
			thrown = error;
		}
		assert.ok(thrown, `${typo} was accepted`);
		// The suggestion rides on `description`, which is the did-you-mean slot; the message
		// alone would pass this while suggesting nothing.
		assert.ok(
			thrown.description?.includes(`Use '${want}'`),
			`${typo} suggested ${JSON.stringify(thrown.description)} instead of ${want}`,
		);
	}

	// The name-wanting sibling has autocomplete and must not be caught by this guard.
	const sibling = await sendFilters().call(
		preSendCtx({
			'filters.condition': [
				{ field: 'basic_profile.location.country', operator: 'eq', value: 'United States' },
			],
			combinator: 'and',
			resource: 'person',
		}),
		{ body: {} },
	);
	assert.equal(sibling.body.filters.value, 'United States');
});

test('filters stay required unless the operation names an alternative', async () => {
	const empty = { filtersJson: '', 'filters.condition': [], combinator: 'and' };

	await assert.rejects(() => sendFilters().call(preSendCtx(empty), { body: {} }), /at least one filter/);

	// Company search accepts a plain-language query instead.
	await assert.rejects(
		() => sendFilters('query').call(preSendCtx({ ...empty, query: '' }), { body: {} }),
		/at least one filter/,
	);
	const ok = await sendFilters('query').call(
		preSendCtx({ ...empty, query: 'fintech' }),
		{ body: { limit: 1 } },
	);
	assert.deepEqual(ok.body, { limit: 1 }, 'no filters key is added when the query carries the search');
});

test('every operation has a field vocabulary, and they are genuinely different sets', () => {
	const { FIELD_VOCABULARY } = require('../dist/nodes/Crustdata/filter-fields.generated');
	for (const key of ['person.search', 'person.enrich', 'person.contactEnrich', 'company.search', 'company.enrich', 'company.identify', 'job.search']) {
		assert.ok(FIELD_VOCABULARY[key]?.length, `${key} has no field vocabulary`);
	}
	// Identify resolves identity only; enrich reaches the rest.
	assert.deepEqual(FIELD_VOCABULARY['company.identify'], ['crustdata_company_id', 'basic_info', 'social_profiles']);
	// Contact enrich takes billing tiers, not record groups.
	assert.ok(FIELD_VOCABULARY['person.contactEnrich'].every((f) => f.startsWith('contact.')));
	// Filter-only columns are absent from search by construction.
	assert.ok(!FIELD_VOCABULARY['company.search'].some((f) => f.startsWith('technographics')));
});

const { NodeHelpers } = require('n8n-workflow');
const { Crustdata } = require('../dist/nodes/Crustdata/Crustdata.node.js');

const node = new Crustdata();

test('no fields picker sends an empty array when you clear it', () => {
	// Two operations hand-rolled this property instead of calling fieldsProperty, so
	// clearing the picker sent `fields: []` while the description promised the API
	// default. Asserted over every fields property, because the bug was the copy.
	const pickers = node.description.properties.filter((p) => p.name === 'fields');
	assert.ok(pickers.length >= 6, 'expected a fields picker on every operation that takes one');
	for (const picker of pickers) {
		const sent = picker.routing?.send?.value;
		assert.match(
			String(sent),
			/\$value\.length/,
			`${JSON.stringify(picker.displayOptions?.show)} sends fields unguarded`,
		);
	}
});

test('post_processing is sent whole or not at all, and names split on lines not commas', async () => {
	const { sendPostProcessing } = require('../dist/nodes/Crustdata/resources/person/search');

	// Neither field filled: the key must not appear at all.
	const empty = { ...ctx({ excludeProfiles: '', excludeNames: '  ' }), getNode: () => ({}) };
	const untouched = await sendPostProcessing.call(empty, { body: { limit: 10 } });
	assert.deepEqual(untouched.body, { limit: 10 }, 'an empty exclusion is no exclusion');

	// A person name may contain a comma, so names split on newlines and URLs on commas.
	const filled = {
		...ctx({
			excludeProfiles: 'https://a.example/in/x, https://b.example/in/y ,',
			excludeNames: 'Jane Doe\nJohn Smith, Jr.\n\n',
		}),
		getNode: () => ({}),
	};
	const sent = await sendPostProcessing.call(filled, { body: { limit: 10 } });
	assert.deepEqual(sent.body.post_processing, {
		exclude_profiles: ['https://a.example/in/x', 'https://b.example/in/y'],
		exclude_names: ['Jane Doe', 'John Smith, Jr.'],
	});
	assert.equal(sent.body.limit, 10, 'the rest of the body survives');

	// One side filled sends only that side, never the other as an empty array.
	const namesOnly = { ...ctx({ excludeProfiles: '', excludeNames: 'Jane Doe' }), getNode: () => ({}) };
	const one = await sendPostProcessing.call(namesOnly, { body: {} });
	assert.deepEqual(one.body.post_processing, { exclude_names: ['Jane Doe'] });
});

const { assertPageSources, SOURCE_OPTIONS, EXCLUDED_SOURCES } = require('../dist/nodes/Crustdata/resources/web');

test('aggregating web search pages is refused only for two or more sources', async () => {
	// Live 2026-09-24: page 2 with two sources is a 400, page 2 with NONE is served and costs
	// two credits. The API's own message says "exactly one source", which is why the guard was
	// written to match it and had to be corrected against what it actually does.
	const guard = { getNode: () => ({ name: 'Crustdata' }) };
	const run = (body) => assertPageSources.call(guard, { body });

	await assert.rejects(() => run({ query: 'x', page: 2, sources: ['web', 'news'] }), /at most one source/);
	await assert.doesNotReject(() => run({ query: 'x', page: 4, sources: ['web'] }));
	await assert.doesNotReject(() => run({ query: 'x', page: 3 }), 'no sources searches them all');
	// One page merges nothing, so every source combination is fine.
	await assert.doesNotReject(() => run({ query: 'x', sources: ['web', 'news'] }));
	await assert.doesNotReject(() => run({ query: 'x', page: 1 }));
});

test('the web sources picker is a verified subset of the spec enum', () => {
	// Three of the spec's seven are unusable, live-checked 2026-09-24: `social` answers 200
	// with zero rows for any query, and both scholar-article values answer 500. Offering them
	// would be a control that returns nothing. Pinned against the SPEC's own list so an
	// upstream change reds the build and someone re-checks, rather than this going stale.
	const { WEB_SEARCH_SOURCES } = require('../dist/nodes/Crustdata/filter-fields.generated');
	const offered = SOURCE_OPTIONS.map((o) => o.value);

	assert.ok(offered.length >= 4, 'the picker is empty; this would pass on two empty lists');
	assert.deepEqual([...offered, ...EXCLUDED_SOURCES].sort(), [...WEB_SEARCH_SOURCES].sort());
	assert.deepEqual(offered.filter((v) => EXCLUDED_SOURCES.includes(v)), [], 'offered and excluded overlap');
});

test('every loadOptions and listSearch method a property names is actually registered', () => {
	// A rename once left both Enrich pickers calling a method that no longer existed.
	// TypeScript cannot type these strings, so this is the only thing that can catch it.
	const loadOptions = new Set();
	const listSearch = new Set();
	const walk = (props) =>
		props.forEach((p) => {
			if (p.typeOptions?.loadOptionsMethod) loadOptions.add(p.typeOptions.loadOptionsMethod);
			(p.modes ?? []).forEach((m) => {
				if (m.typeOptions?.searchListMethod) listSearch.add(m.typeOptions.searchListMethod);
			});
			(p.options ?? []).forEach((o) => o.values && walk(o.values));
		});
	walk(node.description.properties);

	const missing = [...loadOptions].filter((m) => !(m in node.methods.loadOptions));
	assert.deepEqual(missing, [], `loadOptions referenced but not registered: ${missing}`);
	const missingSearch = [...listSearch].filter((m) => !(m in node.methods.listSearch));
	assert.deepEqual(missingSearch, [], `listSearch referenced but not registered: ${missingSearch}`);
	assert.ok(loadOptions.size >= 3 && listSearch.size >= 1, 'walk found nothing; it is not looking');
});

// What n8n itself would show for these saved parameters.
const displayed = (params) =>
	node.description.properties
		.filter((p) => NodeHelpers.displayParameter(params, p, { parameters: params }, node.description))
		.map((p) => p.name);

test('Split Results Into Items survives a mode that has no Return All', () => {
	const ranked = { resource: 'company', operation: 'search', query: 'ai infra' };
	// `show: { returnAll: [false] }` matched nothing here, because a mode without paging
	// leaves returnAll undisplayed and an absent parameter satisfies no `show`.
	assert.ok(displayed(ranked).includes('splitIntoItems'), 'split vanished in ranked mode');
	assert.ok(!displayed(ranked).includes('returnAll'), 'ranked mode must not offer paging');
	assert.ok(!displayed(ranked).includes('sorts'), 'the API refuses sorts beside a query');

	const filter = { resource: 'company', operation: 'search', query: '' };
	assert.ok(displayed(filter).includes('returnAll') && displayed(filter).includes('sorts'));
	assert.ok(displayed({ ...filter, returnAll: true }).includes('splitIntoItems') === false,
		'split must stay hidden while paging, since it strips the cursor');
});

test('a ranked search cannot send the filter-mode limit, which the API refuses', async () => {
	// Both Limit properties are named `limit`, and maxValue is editor-only.
	const out = await sendSemanticSearch.call(
		preSendCtx({ query: 'ai infra', searchMode: 'hybrid' }),
		{ body: { limit: 1000 } },
	);
	assert.equal(out.body.limit, 100);

	const under = await sendSemanticSearch.call(
		preSendCtx({ query: 'ai infra', searchMode: 'hybrid' }),
		{ body: { limit: 25 } },
	);
	assert.equal(under.body.limit, 25);
});

test('a page with no countable rows stops the loop instead of spinning', async () => {
	// countOf could not see rows, so the budget never advanced and the next page asked
	// for the full size again. It ran until the seen-Set overflowed.
	const { ctx, calls } = pager(
		Array.from({ length: 5 }, (_, i) => [{ json: { next_cursor: 'c' + i } }]),
		{ pageSize: 1000, maxResults: 10 },
	);
	await cursorPagination().call(ctx, {
		options: { body: {} },
	});
	assert.equal(calls.length, 1, 'one empty page is enough to know the budget cannot bind');
});

test('sorts is omitted rather than sent empty', async () => {
	const { sendSorts } = require('../dist/nodes/Crustdata/sort');
	const none = await sendSorts.call(preSendCtx({ 'sorts.sort': [] }), { body: { limit: 1 } });
	assert.deepEqual(none.body, { limit: 1 }, 'an empty sorts key must not be sent');

	// A real sortable column: the pre-dispatch check rejects invented ones.
	const field = 'crustdata_person_id';
	const some = await sendSorts.call(
		preSendCtx({ resource: 'person', 'sorts.sort': [{ field, order: 'desc' }] }),
		{ body: { limit: 1 } },
	);
	assert.deepEqual(some.body, { limit: 1, sorts: [{ field, order: 'desc' }] });
});

test('usage is not attached when the response carried no usage headers', async () => {
	const items = [{ json: { a: 1 } }];
	const out = await attachUsage.call(ctxOf({ includeUsage: true }), items, { headers: {} });
	assert.deepEqual(out, items, 'an empty usage object must not be written onto the payload');
});

const { sendRawRequest } = require('../dist/nodes/Crustdata/resources/raw');
const { describe: discoverDescribe } = require('../dist/nodes/Crustdata/resources/discover');
const { SYNC_ENDPOINTS } = require('../dist/nodes/Crustdata/filter-fields.generated');

test('Raw reaches only synchronous endpoints, never batch or watch', () => {
	// Both answer with a handle a one-shot request has no way to redeem.
	const bad = SYNC_ENDPOINTS.filter((e) => /^\/(batch|watch)\b/.test(e.path));
	assert.deepEqual(bad, [], `Raw offers endpoints it cannot complete: ${JSON.stringify(bad)}`);
	assert.deepEqual(SYNC_ENDPOINTS.filter((e) => e.path.includes('{')), [], 'templated paths have no values to fill');
	assert.ok(SYNC_ENDPOINTS.length > 15);
});

test('Raw sends the endpoint you picked, with the body you wrote', async () => {
	const out = await sendRawRequest.call(
		preSendCtx({ endpoint: 'POST /job/search', body: '{"filters":{"field":"title","type":"=","value":"x"}}' }),
		{ method: 'POST', url: '/account/credits' },
	);
	assert.equal(out.method, 'POST');
	assert.equal(out.url, '/job/search');
	assert.deepEqual(out.body, { filters: { field: 'title', type: '=', value: 'x' } });

	// A GET carries no body; saying so beats a silent no-op downstream.
	const get = await sendRawRequest.call(
		preSendCtx({ endpoint: 'GET /account/credits', body: '{"ignored":1}' }),
		{ method: 'POST', url: '/', body: { stale: true } },
	);
	assert.equal(get.method, 'GET');
	assert.equal(get.body, undefined);

	await assert.rejects(
		() => sendRawRequest.call(preSendCtx({ endpoint: 'POST /job/search', body: '{oops' }), { url: '/' }),
		/Body is not valid JSON/,
	);
});

test('Discover answers from the generated tables and reports this account\u2019s prices', async () => {
	// The carrier is /account/endpoints, whose premium prices are per account and are in no
	// spec, so they can only come from a live call.
	const carrier = {
		body: {
			endpoints: [
				{
					path: '/person/search',
					base_credits: 0.03,
					premium_filters: [{ field: 'experience', credits: 5 }, { field: 'skills', credits: 0 }],
					premium_fields: [{ field: 'experience', credits: 10 }, { field: 'education', credits: 0 }],
				},
				{ path: '/company/enrich', base_credits: 2, premium_fields: [{ field: 'technographics', credits: 2 }] },
			],
		},
	};

	const summary = await discoverDescribe.call(ctxOf({ detail: 'summary' }), [{ json: {} }], carrier);
	const s = summary[0].json;
	assert.equal(s.pricing['/person/search'].base_credits, 0.03);
	// Only what actually charges: most premium entries are zero and would bury the rest.
	assert.deepEqual(s.pricing['/person/search'].premium_filters, [{ field: 'experience', credits: 5 }]);
	assert.deepEqual(s.pricing['/person/search'].premium_fields, [{ field: 'experience', credits: 10 }]);
	assert.equal(s.pricing['/company/enrich'].premium_filters, undefined, 'an empty list is omitted');
	assert.ok(s.discover.operations.includes('person.search'));
	assert.ok(s.discover.operations.includes('raw.request'));
	assert.equal(typeof s.discover.filterable_columns.person, 'number');

	const detail = await discoverDescribe.call(
		ctxOf({ detail: 'detailed', forResource: 'company' }),
		[{ json: {} }],
		carrier,
	);
	// Detailed scopes the prices to the resource asked about.
	assert.deepEqual(Object.keys(detail[0].json.pricing), ['/company/enrich']);
	const d = detail[0].json.discover;
	assert.equal(d.resource, 'company');
	assert.ok(d.filterable_columns.length > 50 && Array.isArray(d.sortable_columns));
	assert.ok(d.operators.every((o) => o.sends), 'every operator must report the token it sends');
});

test('Discover cannot drift from the pickers, because both read the same tables', async () => {
	const { getFilterFields, getSortableFields } = require('../dist/nodes/Crustdata/options');
	const pickerCtx = { getCurrentNodeParameter: () => 'person' };
	const fromPicker = (await getFilterFields.call(pickerCtx)).map((o) => o.value);

	const d = (await discoverDescribe.call(
		ctxOf({ detail: 'detailed', forResource: 'person' }),
		[{ json: {} }],
		{ body: {} },
	))[0].json.discover;
	assert.deepEqual(d.filterable_columns, fromPicker);
	assert.deepEqual(d.sortable_columns, (await getSortableFields.call(pickerCtx)).map((o) => o.value));
});

test('Raw refuses any endpoint that is not in the generated table', async () => {
	// The control takes an expression, so its value can come from upstream data or from a
	// model. The value becomes the request URL, and the credential header is attached to
	// whatever host it names, so this check is the only thing standing between a workflow
	// and the API key being posted to someone else's server.
	const hostile = [
		'POST https://evil.example/steal',
		'POST //evil.example/steal',
		'DELETE /watch/person/abc',
		'POST /batch/person/enrich',
		'POST /person/search?x=1',
		'GET /account/credits/../../admin',
		'nonsense',
		'',
	];
	for (const endpoint of hostile) {
		await assert.rejects(
			() => sendRawRequest.call(preSendCtx({ endpoint, body: '{}' }), { url: '/' }),
			/Not a Crustdata endpoint/,
			`Raw accepted ${JSON.stringify(endpoint)}`,
		);
	}
	// Every option the dropdown offers must still pass.
	for (const { method, path } of SYNC_ENDPOINTS) {
		const out = await sendRawRequest.call(
			preSendCtx({ endpoint: `${method} ${path}`, body: '{}' }),
			{ url: '/' },
		);
		assert.equal(out.url, path);
	}
});

test('Raw validates the body whatever the method, and drops it only for non-POST', async () => {
	// The branch keyed on the path, so a GET skipped validation entirely.
	await assert.rejects(
		() => sendRawRequest.call(preSendCtx({ endpoint: 'GET /account/credits', body: '{oops' }), { url: '/' }),
		/Body is not valid JSON/,
	);
	// An expression can yield an object; `?.trim()` threw a raw TypeError on it.
	const obj = await sendRawRequest.call(
		preSendCtx({ endpoint: 'POST /person/search', body: { limit: 1 } }),
		{ url: '/' },
	);
	assert.deepEqual(obj.body, { limit: 1 });
});

test('Discover lists exactly the operations the node registers', async () => {
	// It was half generated and half a hardcoded literal, so it could drift either way,
	// and asserting two members are present let two fabricated ones through. This reads
	// what Discover actually emits rather than rebuilding the literal here.
	const registered = new Set();
	node.description.properties
		.filter((p) => p.name === 'operation' && p.displayOptions?.show?.resource)
		.forEach((p) =>
			p.displayOptions.show.resource.forEach((r) =>
				(p.options ?? []).forEach((o) => registered.add(`${r}.${o.value}`)),
			),
		);

	const emitted = (await discoverDescribe.call(ctxOf({ detail: 'summary' }), [{ json: {} }], { body: {} }))[0]
		.json.discover.operations;

	assert.deepEqual([...emitted].sort(), [...registered].sort());
});

test('Discover cannot be walked onto Object.prototype', async () => {
	for (const forResource of ['constructor', 'toString', '__proto__', 'job']) {
		const d = (await discoverDescribe.call(
			ctxOf({ detail: 'detailed', forResource }),
			[{ json: {} }],
			{ body: {} },
		))[0].json.discover;
		assert.ok(Array.isArray(d.filterable_columns), `${forResource} returned a non-array`);
		assert.ok(Array.isArray(d.sortable_columns), `${forResource} returned a non-array`);
	}
});

const { nearestValid, editDistance, assertKnown } = require('../dist/nodes/Crustdata/diagnostics');
const { validateFields } = require('../dist/nodes/Crustdata/resources/validate-fields');
const { PERSON_FILTER_FIELDS, PERSON_SORTABLE_FIELDS } = require('../dist/nodes/Crustdata/filter-fields.generated');

test('a transposition costs one, so the commonest typo stays suggestible', () => {
	assert.equal(editDistance('titel', 'title'), 1);
	assert.equal(editDistance('name', 'name'), 0);
	assert.equal(editDistance('', 'abc'), 3);
});

test('the suggestion catches a wrong namespace, not just a misspelling', () => {
	// The two ways an agent gets a column wrong. Edit distance alone misses the first
	// entirely: 'current_title' is nowhere near the real path by characters.
	const near = (bad) => nearestValid(bad, PERSON_FILTER_FIELDS);
	assert.ok(
		near('current_title').includes('experience.employment_details.current.title'),
		`wrong namespace not caught: ${near('current_title')}`,
	);
	assert.ok(near('basic_profile.nmae').includes('basic_profile.name'), 'typo not caught');
	assert.ok(near('basic_profile.locaton.city').includes('basic_profile.location.city'));
	// Nothing plausible should suggest nothing, rather than noise.
	assert.deepEqual(nearestValid('zzzzqqqqxxxx', PERSON_FILTER_FIELDS), []);
	// An oversized token is refused outright rather than scored against every column.
	assert.deepEqual(nearestValid('a'.repeat(5000), PERSON_FILTER_FIELDS), []);
});

test('an unknown column is refused before the request, with what to use instead', () => {
	const node = { name: 'Crustdata', type: 'CUSTOM.crustdata', typeVersion: 1 };
	assert.doesNotThrow(() => assertKnown(node, ['basic_profile.name'], PERSON_FILTER_FIELDS, 'Conditions'));

	try {
		assertKnown(node, ['current_title'], PERSON_FILTER_FIELDS, 'Conditions');
		assert.fail('expected a throw');
	} catch (e) {
		assert.match(e.message, /'Conditions' names a column/);
		assert.match(e.description, /did you mean 'experience\.employment_details\.current\.title'/);
		assert.match(e.description, /Discover/, 'the error should point at the free way to get the list');
	}
});

test('sortable is checked against the sortable set, not the filterable one', async () => {
	const { sendSorts } = require('../dist/nodes/Crustdata/sort');
	// A real column, filterable, that the API will not order by.
	const filterableOnly = PERSON_FILTER_FIELDS.find((f) => !PERSON_SORTABLE_FIELDS.includes(f));
	await assert.rejects(
		() =>
			sendSorts.call(
				preSendCtx({ resource: 'person', 'sorts.sort': [{ field: filterableOnly, order: 'asc' }] }),
				{ body: {} },
			),
		/'Sort' names a column/,
		`${filterableOnly} should not be sortable`,
	);
	// And a genuinely sortable one passes.
	const ok = await sendSorts.call(
		preSendCtx({ resource: 'person', 'sorts.sort': [{ field: PERSON_SORTABLE_FIELDS[0], order: 'asc' }] }),
		{ body: {} },
	);
	assert.ok(ok.body.sorts);
});

test('fields is checked against that operation own vocabulary', async () => {
	// company.identify accepts three groups; company.enrich accepts far more.
	await assert.rejects(
		() =>
			validateFields.call(
				preSendCtx({ resource: 'company', operation: 'identify', fields: ['headcount'] }),
				{ body: {} },
			),
		/'Field Names or IDs' names a column/,
	);
	await assert.doesNotReject(() =>
		validateFields.call(
			preSendCtx({ resource: 'company', operation: 'enrich', fields: ['headcount'] }),
			{ body: {} },
		),
	);
});

test('with nothing similar, a short vocabulary is listed rather than pointed at', () => {
	const node = { name: 'Crustdata', type: 'CUSTOM.crustdata', typeVersion: 1 };
	const { FIELD_VOCABULARY } = require('../dist/nodes/Crustdata/filter-fields.generated');
	try {
		// Identify accepts three groups; 'headcount' resembles none of them, and the right
		// answer is "those three", not "go look it up".
		assertKnown(node, ['headcount'], FIELD_VOCABULARY['company.identify'], 'Field Names or IDs');
		assert.fail('expected a throw');
	} catch (e) {
		assert.match(e.description, /Valid here: 'crustdata_company_id', 'basic_info', 'social_profiles'/);
		assert.doesNotMatch(e.description, /Discover/, 'a short set should be listed, not deferred');
	}
	// A long set still defers, because it cannot fit in a message.
	try {
		assertKnown(node, ['zzzzqqqq'], PERSON_FILTER_FIELDS, 'Conditions');
		assert.fail('expected a throw');
	} catch (e) {
		assert.match(e.description, /Discover/);
	}
});

const { sendBatchSubmit, sendBatchGet } = require('../dist/nodes/Crustdata/resources/batch');
const { BATCH_ENDPOINTS } = require('../dist/nodes/Crustdata/filter-fields.generated');

test('Batch submits only to endpoints the spec declares', async () => {
	// Same reason as Raw: the value becomes the request URL.
	for (const bad of ['https://evil.example/steal', '//evil.example', '/person/search', '/batch/../admin', '']) {
		await assert.rejects(
			() => sendBatchSubmit.call(preSendCtx({ endpoint: bad, body: '{}' }), { url: '/' }),
			/Not a Crustdata batch endpoint/,
			`accepted ${JSON.stringify(bad)}`,
		);
	}
	assert.ok(BATCH_ENDPOINTS.length >= 10);
	assert.ok(BATCH_ENDPOINTS.every((e) => e.path.startsWith('/batch/')));
});

test('Submit wires the callback to this execution, and never over an explicit one', async () => {
	const ctx = (params) => ({
		...preSendCtx(params),
		evaluateExpression: () => 'https://n8n.example/webhook-waiting/abc',
	});

	const on = await sendBatchSubmit.call(
		ctx({ endpoint: '/batch/person/enrich', body: '{"professional_network_profile_urls":["x"]}', useCallback: true }),
		{ url: '/' },
	);
	assert.equal(on.url, '/batch/person/enrich');
	assert.equal(on.body.webhook_url, 'https://n8n.example/webhook-waiting/abc');

	// An author who set their own callback meant it.
	const explicit = await sendBatchSubmit.call(
		ctx({ endpoint: '/batch/person/enrich', body: '{"webhook_url":"https://mine.example/hook"}', useCallback: true }),
		{ url: '/' },
	);
	assert.equal(explicit.body.webhook_url, 'https://mine.example/hook');

	const off = await sendBatchSubmit.call(
		ctx({ endpoint: '/batch/person/enrich', body: '{}', useCallback: false }),
		{ url: '/' },
	);
	assert.equal(off.body.webhook_url, undefined);
});

test('Batch Get takes a uuid and nothing else, because it lands in the path', async () => {
	const ok = await sendBatchGet.call(
		preSendCtx({ batchId: '53ab686b-c054-496b-8baf-baff5ecc85cf' }),
		{ url: '/batch' },
	);
	assert.equal(ok.url, '/batch/53ab686b-c054-496b-8baf-baff5ecc85cf');

	for (const bad of ['../../admin', 'https://evil.example', 'not-a-uuid', '']) {
		await assert.rejects(
			() => sendBatchGet.call(preSendCtx({ batchId: bad }), { url: '/batch' }),
			/is not a batch ID/,
			`accepted ${JSON.stringify(bad)}`,
		);
	}
});

const { sendUsageEvent, assertSummaryShape } = require('../dist/nodes/Crustdata/resources/account/usage');

test('the usage summary refuses what daily rollups cannot answer, and only then', async () => {
	// Every case below was run against the live API on 2026-09-24. The default window is the
	// last 7 whole days, so the restricted mode is the one a caller lands in without choosing.
	const run = (params) => assertSummaryShape.call(preSendCtx(params), { qs: {} });
	const WHOLE = { start: '2026-09-21', end: '2026-09-24' };

	// Refused over whole days, served with bucket=1h or a part-day window.
	await assert.rejects(() => run({ ...WHOLE, statusCodes: '400' }), /window of whole days/);
	await assert.rejects(() => run({ ...WHOLE, errorType: 'invalid_request' }), /window of whole days/);
	await assert.doesNotReject(() => run({ ...WHOLE, statusCodes: '400', bucket: '1h' }));
	await assert.doesNotReject(() => run({ start: '2026-09-21T06:00:00Z', end: '2026-09-24', statusCodes: '400' }));
	// An explicit midnight timestamp is the same window as a bare date, and is refused too.
	await assert.rejects(() => run({ start: '2026-09-21T00:00:00Z', end: '2026-09-24T00:00:00Z', statusCodes: '400' }), /whole days/);
	// No window at all defaults to whole days.
	await assert.rejects(() => run({ statusCodes: '400' }), /whole days/);

	// Component grouping: day and product beside it, and the products filter, and nothing else.
	await assert.doesNotReject(() => run({ ...WHOLE, groupBy: ['component', 'day'] }));
	await assert.doesNotReject(() => run({ ...WHOLE, groupBy: ['component', 'product'] }));
	await assert.doesNotReject(() => run({ ...WHOLE, groupBy: ['component'], products: 'person_search' }));
	for (const dim of ['endpoint', 'api_key_id', 'client_surface', 'status_class']) {
		await assert.rejects(() => run({ ...WHOLE, groupBy: ['component', dim] }), /rules out/, dim);
	}
	for (const [name, value] of [['endpoints', '/person/search'], ['apiKeyIds', '170'], ['clientSurfaces', 'mcp'], ['statusClass', '4xx']]) {
		await assert.rejects(() => run({ ...WHOLE, groupBy: ['component'], [name]: value }), /rules out/, name);
	}

	// Each dimension on its own is answerable from the rollups, so none of this fires.
	for (const dim of ['day', 'product', 'endpoint', 'component', 'api_key_id', 'client_surface', 'status_class']) {
		await assert.doesNotReject(() => run({ ...WHOLE, groupBy: [dim] }), dim);
	}
	// And these filters are fine without component.
	await assert.doesNotReject(() => run({ ...WHOLE, statusClass: '4xx', endpoints: '/person/search', apiKeyIds: '170' }));
});


test('a usage request ID is checked before it reaches the path', async () => {
	// The spec types it as a 256-character string rather than a uuid, so the check is on the
	// characters. The control takes an expression, so the value can arrive from upstream data.
	const ok = await sendUsageEvent.call(
		preSendCtx({ requestId: ' 678a3646-371d-4f81-b5c3-488fdda81e21 ' }),
		{ url: '/account/usage/events' },
	);
	assert.equal(ok.url, '/account/usage/events/678a3646-371d-4f81-b5c3-488fdda81e21');

	const hostile = ['../../admin', 'https://evil.example/x', 'a/b', 'a?b=1', 'a#b', 'a b', '', 'x'.repeat(257)];
	for (const bad of hostile) {
		await assert.rejects(
			() => sendUsageEvent.call(preSendCtx({ requestId: bad }), { url: '/account/usage/events' }),
			/Not a request ID/,
			`accepted ${JSON.stringify(bad)}`,
		);
	}
});

const { CrustdataTrigger } = require('../dist/nodes/CrustdataTrigger/CrustdataTrigger.node.js');

// A hook context: records the requests the lifecycle makes, and can be told to fail.
const hookCtx = (params, { reply, staticData = {} } = {}) => {
	const calls = [];
	return {
		calls,
		staticData,
		getNodeParameter: (name, fallback) => params[name] ?? fallback,
		getNode: () => ({ name: 'Crustdata Trigger', type: 'CUSTOM.crustdataTrigger', typeVersion: 1 }),
		getNodeWebhookUrl: () => params.__webhookUrl ?? 'https://n8n.example/webhook/abc',
		getWorkflowStaticData: () => staticData,
		helpers: {
			httpRequestWithAuthentication: async function (_cred, opts) {
				calls.push({ method: opts.method, url: opts.url, body: opts.body });
				if (reply) return reply(opts);
				// The spec's own 201 body: an INTEGER `id`, and no `watch_id` anywhere.
				return { id: 46936, kind: 'entity', dataset: 'person', status: 'active' };
			},
		},
	};
};
const hooks = new CrustdataTrigger().webhookMethods.default;

const { createHmac } = require('node:crypto');

test('activating creates the watch and records the path it was made at', async () => {
	const ctx = hookCtx({ watchKind: 'entity', entityDataset: 'company', entityDefinition: '{"track":{}}' });
	assert.equal(await hooks.create.call(ctx), true);

	const [req] = ctx.calls;
	assert.equal(req.method, 'POST');
	assert.equal(req.url, '/watch/company', 'entity watches post to the dataset root');
	assert.deepEqual(req.body.notifications, [
		{ type: 'webhook', url: 'https://n8n.example/webhook/abc' },
	]);
	// The id is an integer on the wire and a string in static data. Requiring a string on
	// the wire threw on every activation, after the watch had already been made.
	assert.equal(ctx.staticData.watchId, '46936');
	// The path is stored so teardown addresses the watch that exists, not the one the
	// parameters describe by then.
	assert.equal(ctx.staticData.watchPath, '/watch/company/46936');

	const disc = hookCtx({ watchKind: 'discovery', discoveryDataset: 'job', discoveryDefinition: '{"filters":{}}' });
	await hooks.create.call(disc);
	assert.equal(disc.calls[0].url, '/watch/job/search');
	assert.equal(disc.staticData.watchPath, '/watch/job/search/46936');
});

test('teardown deletes the watch that exists, even after the parameters change', async () => {
	// Recomputing the path from current parameters sent the DELETE to a path the watch
	// never lived at: a 404, swallowed as "already gone", handle discarded, watch billing.
	const created = hookCtx({ watchKind: 'entity', entityDataset: 'company', entityDefinition: '{}' });
	await hooks.create.call(created);

	const edited = hookCtx(
		{ watchKind: 'discovery', discoveryDataset: 'job' },
		{ staticData: created.staticData },
	);
	assert.equal(await hooks.delete.call(edited), true);
	assert.equal(edited.calls[0].method, 'DELETE');
	assert.equal(edited.calls[0].url, '/watch/company/46936', 'the path the watch was created at');
});

test('an id this node cannot address is refused rather than interpolated', async () => {
	for (const id of ['../../admin', 'abc', '1/2', -5, 1.5]) {
		const ctx = hookCtx(
			{ watchKind: 'entity', entityDataset: 'person', entityDefinition: '{}' },
			{ reply: async () => ({ id }) },
		);
		await assert.rejects(() => hooks.create.call(ctx), /cannot address/, `accepted ${id}`);
	}
});

test('an author who declared their own channels keeps them', async () => {
	const ctx = hookCtx({
		watchKind: 'entity',
		entityDataset: 'person',
		entityDefinition: '{"notifications":[{"type":"email","to":["a@b.c"]}]}',
	});
	await hooks.create.call(ctx);
	assert.equal(ctx.calls[0].body.notifications.length, 2);
	assert.equal(ctx.calls[0].body.notifications[0].type, 'email');
});

test('a create that returns no watch id fails loudly rather than stranding a watch', async () => {
	const ctx = hookCtx(
		{ watchKind: 'entity', entityDataset: 'person', entityDefinition: '{}' },
		{ reply: async () => ({ ok: true }) },
	);
	await assert.rejects(() => hooks.create.call(ctx), /returned no id/);
});

test('deactivating deletes the watch, and already-gone counts as done', async () => {
	const ctx = hookCtx({ watchKind: 'entity', entityDataset: 'person' }, { staticData: { watchId: 'w_9' } });
	assert.equal(await hooks.delete.call(ctx), true);
	assert.equal(ctx.calls[0].method, 'DELETE');
	assert.equal(ctx.calls[0].url, '/watch/person/w_9');
	assert.equal(ctx.staticData.watchId, undefined);

	const gone = hookCtx(
		{ watchKind: 'entity', entityDataset: 'person' },
		{ staticData: { watchId: 'w_9' }, reply: async () => { throw { httpCode: '404' }; } },
	);
	assert.equal(await hooks.delete.call(gone), true, '404 means the subscription is already gone');
});

test('a delete that fails for any other reason must not report success', async () => {
	// Reporting true would strand a live watch that still bills and delivers nowhere.
	const ctx = hookCtx(
		{ watchKind: 'entity', entityDataset: 'person' },
		{ staticData: { watchId: 'w_9' }, reply: async () => { throw { httpCode: '500' }; } },
	);
	await assert.rejects(() => hooks.delete.call(ctx));
	assert.equal(ctx.staticData.watchId, 'w_9', 'the id survives so a retry can still clean up');
});

test('checkExists decides whether we spend money, so it is tested', async () => {
	// Three mutations of this method previously stayed green: always-true (never fires),
	// always-false (duplicates a paid watch), and never clearing a stale id.
	const noId = hookCtx({ watchKind: 'entity', entityDataset: 'person' });
	assert.equal(await hooks.checkExists.call(noId), false);
	assert.equal(noId.calls.length, 0, 'nothing to check means no request');

	// A watch registered before this node stored a path. Confirming it would skip the
	// create that records one, and teardown would guess the path forever.
	const legacy = hookCtx(
		{ watchKind: 'entity', entityDataset: 'person' },
		{ staticData: { watchId: '46936' } },
	);
	assert.equal(await hooks.checkExists.call(legacy), false);
	assert.equal(legacy.calls.length, 0);

	const live = hookCtx(
		{ watchKind: 'entity', entityDataset: 'person' },
		{
			staticData: { watchId: '46936', watchPath: '/watch/person/46936' },
			reply: async () => ({ id: 46936, status: 'active' }),
		},
	);
	assert.equal(await hooks.checkExists.call(live), true);
	assert.equal(live.calls[0].url, '/watch/person/46936');

	const gone = hookCtx(
		{ watchKind: 'entity', entityDataset: 'person' },
		{
			staticData: { watchId: '46936', watchPath: '/watch/person/46936' },
			reply: async () => { throw { httpCode: '404' }; },
		},
	);
	assert.equal(await hooks.checkExists.call(gone), false);
	assert.equal(gone.staticData.watchId, undefined, 'a dead id must not block the next create');
	assert.equal(gone.staticData.watchPath, undefined, 'and neither must its path');

	// A transient failure must not read as "gone", or activation makes a second watch.
	const flaky = hookCtx(
		{ watchKind: 'entity', entityDataset: 'person' },
		{
			staticData: { watchId: '46936', watchPath: '/watch/person/46936' },
			reply: async () => { throw { httpCode: '500' }; },
		},
	);
	await assert.rejects(() => hooks.checkExists.call(flaky));
	assert.equal(flaky.staticData.watchId, '46936');
});

// Crustdata's real signature: HMAC-SHA256 over `<t>.<raw body>` keyed by the API key.
const KEY = 'test-api-key';
const signedCtx = (body, { t = Math.floor(Date.now() / 1000), key = KEY, v1 } = {}) => {
	const raw = Buffer.from(body);
	const sig = v1 ?? createHmac('sha256', key).update(`${t}.${raw.toString()}`).digest('hex');
	const written = {};
	return {
		written,
		getCredentials: async () => ({ apiKey: KEY }),
		getRequestObject: () => ({ rawBody: raw }),
		getHeaderData: () => ({ 'x-crustdata-signature': `t=${t},v1=${sig}` }),
		getBodyData: () => JSON.parse(body),
		getResponseObject: () => ({
			status(code) { written.code = code; return this; },
			send(text) { written.body = text; return this; },
			end() { written.ended = true; return this; },
		}),
		helpers: { returnJsonArray: (j) => [{ json: j }] },
	};
};
const triggerNode = new CrustdataTrigger();

test('every hint fires on a parameter that exists', () => {
	// A displayCondition naming a parameter that does not exist is false forever: the hint
	// never shows and nothing errors, so only a check like this one can see it.
	const declared = new Set();
	const walk = (props) =>
		props.forEach((p) => {
			declared.add(p.name);
			(p.options ?? []).forEach((o) => o.values && walk(o.values));
		});
	walk(node.description.properties);
	walk(triggerNode.description.properties);

	const hints = [...(node.description.hints ?? []), ...(triggerNode.description.hints ?? [])];
	assert.ok(hints.length >= 4, 'no hints found; this is not looking at anything');

	const referenced = hints.flatMap((h) =>
		[...(h.displayCondition ?? '').matchAll(/\$parameter\["([^"]+)"\]/g)].map((m) => m[1]),
	);
	assert.ok(referenced.length >= 5, 'no conditions parsed; the pattern is not matching');
	const unknown = [...new Set(referenced)].filter((n) => !declared.has(n));
	assert.deepEqual(unknown, [], `hint condition names a parameter that does not exist: ${unknown}`);
});

test('a genuinely signed delivery is relayed verbatim', async () => {
	// Signed over the RAW bytes: this body re-serialises differently, which is exactly why
	// the parsed body cannot be used to recompute the signature.
	const body = '{\n  "event": "person.changed",\n  "n": 1.0\n}';
	const ctx = signedCtx(body);
	const out = await triggerNode.webhook.call(ctx);
	assert.deepEqual(out.workflowData[0][0].json, { event: 'person.changed', n: 1 });
	assert.equal(ctx.written.code, undefined, 'a good delivery writes no error response');
});

test('a delivery that is unsigned, forged or stale is answered 401, not left hanging', async () => {
	const body = '{"event":"person.changed"}';

	const cases = {
		'wrong key': signedCtx(body, { key: 'not-the-key' }),
		'forged v1': signedCtx(body, { v1: 'deadbeef' }),
		'stale timestamp': signedCtx(body, { t: Math.floor(Date.now() / 1000) - 3600 }),
	};
	for (const [label, ctx] of Object.entries(cases)) {
		const out = await triggerNode.webhook.call(ctx);
		assert.equal(out.noWebhookResponse, true, label);
		assert.equal(out.workflowData, undefined, label);
		// Returning noWebhookResponse without writing leaves the socket open, which on an
		// unauthenticated path is a way to exhaust the instance.
		assert.equal(ctx.written.code, 401, `${label}: must answer 401`);
		assert.equal(ctx.written.ended, true, `${label}: must end the response`);
	}

	// No signature header at all.
	const bare = signedCtx(body);
	bare.getHeaderData = () => ({});
	const out = await triggerNode.webhook.call(bare);
	assert.equal(out.noWebhookResponse, true);
	assert.equal(bare.written.code, 401);

	// Signature valid, so an absent body is the only reason left to reject. n8n fills
	// rawBody only for the content types it parses a body from, and the caller picks the
	// content type: multipart reaching `.toString()` is a 500 on an unauthenticated path.
	const unparsed = signedCtx(body);
	unparsed.getRequestObject = () => ({});
	const crashed = await triggerNode.webhook.call(unparsed);
	assert.equal(crashed.noWebhookResponse, true);
	assert.equal(unparsed.written.code, 401);
});

test('a batch ID that merely contains a uuid is still rejected', async () => {
	// Dropping the regex anchors reopens path traversal, and the old hostile list could
	// not see it because none of its values embedded a well-formed uuid.
	const real = '53ab686b-c054-496b-8baf-baff5ecc85cf';
	for (const bad of [`../../admin/${real}`, `${real}/../../admin`, `${real}?x=1`, `x${real}`]) {
		await assert.rejects(
			() => sendBatchGet.call(preSendCtx({ batchId: bad }), { url: '/batch' }),
			/is not a batch ID/,
			`accepted ${JSON.stringify(bad)}`,
		);
	}

	// Surrounding whitespace is trimmed before the check, so what reaches the path is the
	// clean id. Rejecting a pasted value for a trailing newline would be noise.
	const padded = await sendBatchGet.call(
		preSendCtx({ batchId: `  ${real}\n` }),
		{ url: '/batch' },
	);
	assert.equal(padded.url, `/batch/${real}`);
});

test('the oversized-token guard is asserted at its boundary, not on an empty result', () => {
	// The old test compared two empty arrays: a 5000-char token scores ~0.0003 either way,
	// so removing the guard left the suite green. A near-miss either side of the 128-char
	// limit does distinguish them, because without the guard the long one still scores.
	const { nearestValid } = require('../dist/nodes/Crustdata/diagnostics');
	const real = 'basic_profile.name';
	const pad = (n) => real + 'x'.repeat(n - real.length);

	assert.ok(
		nearestValid(pad(128), PERSON_FILTER_FIELDS).includes(real),
		'a near-miss at the limit must still be scored',
	);
	assert.deepEqual(
		nearestValid(pad(129), PERSON_FILTER_FIELDS),
		[],
		'one character over the limit is refused outright, not scored',
	);
});

test('activation refuses to proceed without a webhook URL', async () => {
	// hookCtx has always had a __webhookUrl escape hatch and no test ever used it, so
	// deleting the guard stayed green.
	const ctx = hookCtx({
		watchKind: 'entity',
		entityDataset: 'person',
		entityDefinition: '{}',
		__webhookUrl: '',
	});
	await assert.rejects(() => hooks.create.call(ctx), /did not provide a webhook URL/);
	assert.equal(ctx.calls.length, 0, 'no watch may be created without somewhere to deliver');
});

test('the batch list limit is capped at what the API accepts', () => {
	// Dropping maxValue stayed green: nothing asserted on the property itself, and n8n's
	// own lint rule for this is disabled upstream.
	const d = new Crustdata().description;
	const limit = d.properties.find(
		(p) => p.name === 'limit' && p.displayOptions?.show?.resource?.includes('batch'),
	);
	assert.equal(limit.typeOptions.maxValue, 100, 'GET /batch caps limit at 100');
	assert.equal(limit.typeOptions.minValue, 1);
});

const { sendWatchRequest, sendWatchBody } = require('../dist/nodes/Crustdata/resources/watch');
const watchCtx = (params) => ({ ...ctx(params), getNode: () => ({}) });
const urlOf = async (params) => (await sendWatchRequest.call(watchCtx(params), {})).url;

test('an ID alone addresses a watch, whatever kind it is', async () => {
	// /watch/{id} resolves either kind and reports its own kind and dataset back, so these
	// operations no longer make the caller state what the ID already determines. Asking used
	// to mean a wrong guess 404d, and for the run reads it read as an empty history.
	for (const op of ['get', 'cancel', 'update']) {
		assert.equal(await urlOf({ operation: op, watchId: '12' }), '/watch/12');
	}
	assert.equal(await urlOf({ operation: 'getRuns', watchId: '12' }), '/watch/12/runs');
	assert.equal(
		await urlOf({ operation: 'getRun', watchId: '12', runId: '9' }),
		'/watch/12/runs/9/summary',
	);

	// A dataset left over from another operation must not steer them back onto a scoped path.
	assert.equal(
		await urlOf({ operation: 'get', watchKind: 'discovery', discoveryDataset: 'job', watchId: '12' }),
		'/watch/12',
	);

	// Test has no ID-only route, so it stays scoped to both, including the search/ segment.
	assert.equal(
		await urlOf({ operation: 'test', watchKind: 'discovery', discoveryDataset: 'job', watchId: '12' }),
		'/watch/job/search/12/test',
	);
	assert.equal(
		await urlOf({ operation: 'test', watchKind: 'entity', entityDataset: 'person', watchId: '12' }),
		'/watch/person/12/test',
	);
	// List still walks one tree.
	assert.equal(
		await urlOf({ operation: 'list', watchKind: 'discovery', discoveryDataset: 'job' }),
		'/watch/job/search',
	);
});

test('watch and run IDs are checked before they reach the path', async () => {
	// The value becomes the request URL, and an expression can put anything here.
	for (const bad of ['', 'abc', '12/../../account/credits', 'https://example.com/x']) {
		await assert.rejects(
			() => sendWatchRequest.call(watchCtx({ operation: 'get', watchId: bad }), {}),
			/not a numeric/,
		);
	}
	await assert.rejects(
		() => sendWatchRequest.call(watchCtx({ operation: 'getRun', watchId: '5', runId: 'x' }), {}),
		/Run ID/,
	);
});

test('the watch dataset is checked before it reaches the path, like the IDs are', async () => {
	// A picker constrains the UI, not an expression, and this value becomes the request URL.
	for (const bad of ['../../batch', '..', 'not_a_dataset', '']) {
		await assert.rejects(
			() => sendWatchRequest.call(watchCtx({ operation: 'list', entityDataset: bad }), {}),
			/is not a dataset for entity watches/,
			`accepted ${JSON.stringify(bad)}`,
		);
	}

	// Real datasets on the wrong tree: job and social post exist only as discovery watches,
	// so an entity call naming one is a 404 that reads as an empty result.
	await assert.rejects(
		() => sendWatchRequest.call(watchCtx({ operation: 'list', entityDataset: 'job' }), {}),
		/is not a dataset for entity watches/,
	);
	assert.equal(
		await urlOf({ operation: 'list', watchKind: 'discovery', discoveryDataset: 'job' }),
		'/watch/job/search',
	);

	// Preview is pinned to the entity tree, so it refuses one there too.
	await assert.rejects(
		() => sendWatchRequest.call(watchCtx({ operation: 'preview', entityDataset: 'social_post' }), {}),
		/is not a dataset for entity watches/,
	);
});

test('preview stays on the entity tree and does not fire a delivery nobody asked for', async () => {
	const c = watchCtx({ operation: 'preview', entityDataset: 'company', track: '{"a":1}', count: 1 });
	assert.equal((await sendWatchRequest.call(c, {})).url, '/watch/company/test');

	const { body } = await sendWatchBody.call(c, {});
	assert.deepEqual(body.track, { a: 1 });
	assert.equal(body.deliver, false, 'the API defaults deliver to true; this node must not');

	// Delivering with nowhere to deliver to is the API's own 400, caught with the reason.
	await assert.rejects(
		() => sendWatchBody.call(watchCtx({ operation: 'preview', track: '{}', deliver: true }), {}),
		/Notification Endpoint/,
	);
	await assert.rejects(
		() => sendWatchBody.call(watchCtx({ operation: 'preview', track: '' }), {}),
		/Track/,
	);
});

test('update sends only the keys you filled, because each one replaces what is there', async () => {
	const status = watchCtx({ operation: 'update', newStatus: 'paused', entities: '', config: '', notifications: '' });
	assert.deepEqual(
		(await sendWatchBody.call(status, {})).body,
		{ status: 'paused' },
		'an empty JSON box must not blank the field it stands for',
	);

	// An explicit empty array is a deliberate unhook, and must survive as one.
	const unhook = watchCtx({ operation: 'update', newStatus: '', entities: '', config: '', notifications: '[]' });
	assert.deepEqual((await sendWatchBody.call(unhook, {})).body, { notifications: [] });

	await assert.rejects(
		() => sendWatchBody.call(watchCtx({ operation: 'update', newStatus: '', entities: '', config: '', notifications: '' }), {}),
		/changes nothing/,
	);
});

const { sendAggregations } = require('../dist/nodes/Crustdata/resources/job');
const { FILTERS_OPTIONAL } = require('../dist/nodes/Crustdata/filters');
const jobCtx = (params) => ({ ...ctx(params), getNode: () => ({}) });
const aggRows = (rows) => ({ 'aggregations.aggregation': rows });

test('a count aggregation carries no field, and a group_by is completed for you', async () => {
	const c = jobCtx(aggRows([
		{ type: 'count', field: 'job_details.title' },
		{ type: 'group_by', field: 'job_details.title' },
		{ type: 'group_by', field: 'location.country', size: 5 },
	]));
	const { body } = await sendAggregations.call(c, { body: { limit: 20 } });
	assert.deepEqual(body.aggregations, [
		// `field` is refused on a count, so a value left behind by switching Type is dropped.
		{ type: 'count' },
		// `agg` is required and `count` is the only value the API takes, so it is not a control.
		{ type: 'group_by', field: 'job_details.title', agg: 'count', size: 100 },
		{ type: 'group_by', field: 'location.country', agg: 'count', size: 5 },
	]);
	assert.equal(body.limit, 20, 'rows are still returned unless Aggregations Only says otherwise');

	await assert.rejects(
		() => sendAggregations.call(jobCtx(aggRows([{ type: 'group_by' }])), { body: {} }),
		/needs a Field/,
	);
});

test('groupable is a much smaller set than filterable, and is checked against its own', async () => {
	// company.basic_info.industries groups; job_details.description does not.
	await assert.rejects(
		() => sendAggregations.call(jobCtx(aggRows([{ type: 'group_by', field: 'content.description' }])), { body: {} }),
		/Aggregations/,
	);
	const ok = jobCtx(aggRows([{ type: 'group_by', field: 'company.basic_info.industries' }]));
	await assert.doesNotReject(() => sendAggregations.call(ok, { body: {} }));
});

test('Aggregations Only sends limit 0, which is what makes the count cheap', async () => {
	const c = jobCtx({ ...aggRows([{ type: 'count' }]), aggregationsOnly: true });
	const { body } = await sendAggregations.call(c, { body: { limit: 50 } });
	assert.equal(body.limit, 0, 'this endpoint bills per result, so the count must return none');

	// On with nothing to compute would send limit 0 and no aggregations: an empty answer.
	await assert.rejects(
		() => sendAggregations.call(jobCtx({ aggregationsOnly: true }), { body: {} }),
		/no aggregation is defined/,
	);
});

test('job search accepts no filters at all, unlike person and company', async () => {
	// /job/search marks nothing required: a filterless call is how you count the dataset.
	const bare = { ...ctx({ resource: 'job', filtersJson: '', 'filters.condition': [] }), getNode: () => ({}) };
	const out = await sendFilters(FILTERS_OPTIONAL).call(bare, { body: {} });
	assert.deepEqual(out.body, {}, 'no filters means no filters key, not an empty one');
});

test('every search envelope this node returns is a key the splitter and the pager know', () => {
	const { resultArray } = require('../dist/nodes/Crustdata/response');
	// person, company, job, social post, web, and the three account usage reports. A key
	// missing here fails TWICE and silently:
	// Split Results quietly does nothing, and the Return All row counter reads zero, which
	// the no-rows guard turns into "stop after page one" with no error.
	for (const key of ['profiles', 'companies', 'job_listings', 'posts', 'results', 'buckets', 'events', 'groups']) {
		assert.deepEqual(
			resultArray({ [key]: [{ a: 1 }], total_count: 9, next_cursor: 'x' }),
			[{ a: 1 }],
			`'${key}' is not a recognised envelope key`,
		);
	}
});

test('Count Only sends limit 0, which this endpoint serves for free', async () => {
	const { sendCountOnly } = require('../dist/nodes/Crustdata/resources/social-post');
	const on = await sendCountOnly.call(ctx({ countOnly: true }), { body: { limit: 50 } });
	assert.equal(on.body.limit, 0, 'reading posts is billed per post; counting them is not');

	const off = await sendCountOnly.call(ctx({ countOnly: false }), { body: { limit: 50 } });
	assert.equal(off.body.limit, 50, 'the Limit you set must survive when Count Only is off');
});
