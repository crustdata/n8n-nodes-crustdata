#!/usr/bin/env node
/**
 * Emit nodes/Crustdata/filter-fields.generated.ts from the published Crustdata
 * OpenAPI spec.
 *
 *   node scripts/gen-filter-fields.mjs            # fetch the published spec and write
 *   node scripts/gen-filter-fields.mjs --check    # fail if the committed file differs
 *   node scripts/gen-filter-fields.mjs --spec x.yaml
 *
 * The spec is the same public artifact the Crustdata MCP server's codegen reads;
 * crustdata-docs republishes it on every push to main.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const SPEC_VERSION = '2025-11-01';
const SPEC_URL = `https://static-assets.crustdata.com/openapi-specs/${SPEC_VERSION}/crustdata.yaml`;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'nodes', 'Crustdata', 'filter-fields.generated.ts');

/** Only the resources the node models. Web is live-only and has no condition builder. */
const SEARCH_SCHEMAS = {
	PersonSearchCondition: 'PERSON',
	CompanySearchCondition: 'COMPANY',
	JobSearchCondition: 'JOB',
	SocialPostDbSearchCondition: 'SOCIALPOST',
};

const AUTOCOMPLETE_SCHEMAS = {
	PersonAutocompleteRequest: 'PERSON',
	CompanyAutocompleteRequest: 'COMPANY',
	JobAutocompleteRequest: 'JOB',
};

/**
 * Every `fields` vocabulary, keyed `resource.operation`, because they are genuinely
 * different sets: enrich takes record groups, identify takes the three it can resolve,
 * contact enrich takes billing tiers, and search takes response paths.
 */
const FIELD_GROUP_SCHEMAS = {
	'person.enrich': ['PersonEnrichRequest', 'fields'],
	'company.enrich': ['CompanyEnrichRequest', 'fields'],
	'company.identify': ['CompanyIdentifyRequest', 'fields'],
	'person.contactEnrich': ['PersonContactEnrichRequest', 'fields'],
};

/** Each search request points `sorts.items` at its own schema; the sortable set is a
 *  strict subset of the filterable one, so it cannot be derived from the filter list. */
const SORT_SCHEMAS = {
	Sort: 'PERSON',
	CompanySearchSort: 'COMPANY',
	JobSearchSort: 'JOB',
	SocialPostDbSearchSort: 'SOCIALPOST',
};

/**
 * Endpoints the Raw operation may call: everything synchronous.
 *
 * `batch` answers with a `batch_id` and a `status_url`, and `watch` is a subscription, so
 * a raw call to either leaves the caller holding a handle it has no way to redeem. Those
 * need their own operations, and Raw must not pretend to cover them.
 */
const RAW_EXCLUDED_AREAS = new Set(['batch', 'watch']);

/** The record each search endpoint returns, walked for selectable `fields` paths. */
const SEARCH_RECORDS = {
	PersonSearch: 'PERSON',
	CompanySearch: 'COMPANY',
	Job: 'JOB',
	SocialPostDb: 'SOCIALPOST',
};

/**
 * Constant prefix -> the node's resource value, listed only where lowercasing the prefix is
 * not it. FIELD_VOCABULARY is looked up at runtime by `resource.operation`, so a key of
 * `socialpost.search` would never be found under the `socialPost` resource.
 */
const RESOURCE_KEY = { SOCIALPOST: 'socialPost' };

const FIELD_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

/**
 * The UI value is NEVER the raw API token: n8n reads any value starting with `=`
 * as an expression, so `=`, `=>` and `=<` come back empty — three of the sixteen
 * operators, the most used one included.
 *
 * `is_null`/`is_not_null` are absent deliberately. v2 search has no null-check
 * operator; person 400s and company 500s on both.
 */
const OPERATORS = [
	['eq', '=', 'Equals'],
	['ne', '!=', 'Not Equals'],
	['lt', '<', 'Less Than'],
	['lte', '=<', 'Less than or Equal'],
	['gt', '>', 'Greater Than'],
	['gte', '=>', 'Greater than or Equal'],
	['in', 'in', 'In (Value Is a List)'],
	['not_in', 'not_in', 'Not in (Value Is a List)'],
	['all_words', '(.)', 'Contains All Words'],
	['not_contains', '(!)', 'Does Not Contain'],
	['exact_phrase', '[.]', 'Exact Phrase'],
	['has_all', 'has_all', 'Has All (Nested Array)'],
	['geo_distance', 'geo_distance', 'Within Distance'],
	['geo_exclude', 'geo_exclude', 'Outside Distance'],
];

/** Three phrasings across the schemas, so try each rather than assume one. */
function parseFields(description) {
	const out = [];
	const seen = new Set();
	const add = (raw) => {
		const tok = raw.trim().replace(/\.+$/, '');
		if (FIELD_RE.test(tok) && !seen.has(tok)) {
			seen.add(tok);
			out.push(tok);
		}
	};

	const ticked = description.match(/`([^`]+)`/g);
	if (ticked) {
		for (const t of ticked) add(t.slice(1, -1));
		return out;
	}
	const valid = description.match(/[Vv]alid fields(?: include)?:\s*([\s\S]+)/);
	if (valid) {
		for (const t of valid[1].replace(/\n/g, ' ').split(',')) add(t);
		return out;
	}
	for (const chunk of description.split(/[A-Z][A-Za-z ]+:/).slice(1)) {
		for (const t of chunk.replace(/\n/g, ' ').split(',')) add(t);
	}
	return out;
}

/**
 * Every dotted path the `fields` param may select, from the 200-response record. A family
 * name is valid too, so branch nodes are kept alongside leaves. Filter-only columns are
 * absent by construction: they are not in the response.
 */
function returnPaths(schemas, record) {
	const deref = (s) => (s && s.$ref ? schemas[s.$ref.split('/').pop()] : s);
	const out = new Set();
	const walk = (schema, prefix, depth, seen) => {
		const resolved = deref(schema);
		if (!resolved || depth > 8) return;
		const node = resolved.type === 'array' ? deref(resolved.items) : resolved;
		if (!node?.properties) return;
		for (const [key, value] of Object.entries(node.properties)) {
			const path = prefix ? `${prefix}.${key}` : key;
			out.add(path);
			// Guard only self-referential $refs; inline objects cannot recurse forever.
			const ref = value.$ref ?? (value.type === 'array' && value.items?.$ref);
			if (ref) {
				if (seen.has(ref)) continue;
				seen.add(ref);
			}
			walk(value, path, depth + 1, seen);
			if (ref) seen.delete(ref);
		}
	};
	walk({ $ref: `#/components/schemas/${record}` }, '', 0, new Set());
	return [...out].sort();
}

/**
 * A `fields` vocabulary out of its prose. Two phrasings: a comma list after a "Valid …:"
 * lead-in, and backticked names scattered through a sentence. Backticks win when present,
 * since a description carrying them lists nothing else.
 */
function parseGroups(description) {
	const out = [];
	const seen = new Set();
	const add = (raw) => {
		const tok = raw.trim().replace(/^`|`$/g, '');
		if (/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(tok) && !seen.has(tok)) {
			seen.add(tok);
			out.push(tok);
		}
	};
	const lead = /(?:Valid field groups for enrich|Valid field groups|Also available|Only contact fields are accepted):\s*([^.]+(?:\.[a-z_]+[^.]*)*)/g;
	for (const m of description.matchAll(lead)) {
		for (const raw of m[1].split(/,|\band\b/)) add(raw);
	}
	return out;
}

/**
 * `AggregationRequest.field` backticks its prose (`type`, `group_by`, `count`) as well as the
 * real columns, and those match the field shape, so only the tail after the lead-in is read.
 */
function parseListAfter(description, lead) {
	const at = description.indexOf(lead);
	return at === -1 ? [] : parseFields(description.slice(at + lead.length));
}

const q = (s) => JSON.stringify(s);
const block = (name, values) => [`export const ${name}: string[] = [`, ...values.map((v) => `\t${q(v)},`), '];', ''];

/** The asynchronous submit endpoints, which Raw deliberately excludes. */
/**
 * Request-body properties the spec declares, per synchronous POST endpoint, and every watch
 * route. Neither is used to build the UI: they exist so CI can see the two kinds of drift the
 * pickers cannot. A new request parameter is invisible because a missing one is just a
 * narrower query, and the whole /watch area is excluded from SYNC_ENDPOINTS, so routes added
 * there produced no diff at all.
 */
/** The `sources` enum on /web/search/live. The node offers a live-verified subset of it. */
function webSearchSources(spec) {
	const values = spec.components?.schemas?.WebSearchRequest?.properties?.sources?.items?.enum;
	if (!Array.isArray(values) || values.length === 0) throw new Error('WebSearchRequest.sources carries no enum');
	return [...values].sort();
}

function requestParams(paths, spec) {
	const out = {};
	for (const [path, item] of Object.entries(paths)) {
		if (path.includes('{') || !item.post) continue;
		const ref = item.post.requestBody?.content?.['application/json']?.schema?.$ref;
		const schema = ref && spec.components?.schemas?.[ref.split('/').pop()];
		if (schema?.properties) out[path] = Object.keys(schema.properties).sort();
	}
	return out;
}

function watchRoutes(paths) {
	const out = [];
	for (const [path, item] of Object.entries(paths)) {
		if (!path.startsWith('/watch')) continue;
		for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
			if (item[method]) out.push(`${method.toUpperCase()} ${path}`);
		}
	}
	return out.sort();
}

function batchEndpoints(paths, spec) {
	return Object.keys(paths)
		.filter((p) => p.startsWith('/batch/') && !p.includes('{') && paths[p].post)
		.sort()
		.map((path) => ({
			path,
			label: path.replace('/batch/', '').replace(/\//g, ' '),
			maxItems: batchMaxItems(paths[path].post, spec),
		}));
}

/**
 * The job's identifier cap, off the request schema. It ranges from 10 to 10,000 across these
 * endpoints, and a caller who assumes the synchronous 25 everywhere makes batch pointless.
 * Undefined for the search jobs, which take filters rather than a list.
 */
function batchMaxItems(operation, spec) {
	const ref = operation?.requestBody?.content?.['application/json']?.schema?.$ref;
	const schema = ref && spec.components?.schemas?.[ref.split('/').pop()];
	if (!schema?.properties) return undefined;
	const caps = new Set();
	// The cap sits on the array branch of a `oneOf`, because each identifier list also accepts
	// a comma-separated string, so reading the property alone finds nothing.
	const collect = (node) => {
		if (!node || typeof node !== 'object') return;
		if (typeof node.maxItems === 'number') caps.add(node.maxItems);
		for (const branch of [...(node.oneOf ?? []), ...(node.anyOf ?? []), ...(node.allOf ?? [])]) {
			collect(branch);
		}
	};
	for (const property of Object.values(schema.properties)) collect(property);
	// The smallest, so the number shown is one every identifier on that endpoint honours.
	return caps.size ? Math.min(...caps) : undefined;
}

function syncEndpoints(paths) {
	const out = [];
	for (const [path, item] of Object.entries(paths)) {
		if (RAW_EXCLUDED_AREAS.has(path.split('/')[1])) continue;
		// A templated path needs values Raw has nowhere to ask for.
		if (path.includes('{')) continue;
		for (const method of ['get', 'post']) {
			if (item[method]) out.push({ method: method.toUpperCase(), path });
		}
	}
	return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

async function loadSpec() {
	const flag = process.argv.indexOf('--spec');
	if (flag !== -1) return yaml.load(readFileSync(process.argv[flag + 1], 'utf8'));
	const res = await fetch(SPEC_URL);
	if (!res.ok) throw new Error(`${SPEC_URL} answered ${res.status}`);
	return yaml.load(await res.text());
}

const spec = await loadSpec();
const schemas = spec.components.schemas;

const pick = (name, prop) => {
	const schema = schemas[name];
	if (!schema) throw new Error(`${name} missing from the spec`);
	return schema.properties[prop]?.description ?? '';
};

const lines = [
	`// GENERATED from the Crustdata OpenAPI ${SPEC_VERSION} spec by scripts/gen-filter-fields.mjs.`,
	'// Do not edit by hand; run `npm run gen:fields` and commit the result.',
	'//',
	'// Note the dialect: the range operators are `=>` and `=<`, reversed from the',
	'// near-universal `>=` and `<=`. A picker is how the node makes that unmissable.',
	'',
	"import type { INodePropertyOptions } from 'n8n-workflow';",
	'',
];

for (const [schema, prefix] of Object.entries(SEARCH_SCHEMAS)) {
	lines.push(...block(`${prefix}_FILTER_FIELDS`, parseFields(pick(schema, 'field'))));
}
for (const [schema, prefix] of Object.entries(AUTOCOMPLETE_SCHEMAS)) {
	lines.push(...block(`${prefix}_AUTOCOMPLETE_FIELDS`, parseFields(pick(schema, 'field'))));
}
for (const [schema, prefix] of Object.entries(SORT_SCHEMAS)) {
	lines.push(...block(`${prefix}_SORTABLE_FIELDS`, parseFields(pick(schema, 'field'))));
}
for (const [record, prefix] of Object.entries(SEARCH_RECORDS)) {
	lines.push(...block(`${prefix}_RETURN_PATHS`, returnPaths(schemas, record)));
}

lines.push('/** What each operation\'s `fields` parameter accepts, keyed `resource.operation`. */');
lines.push('export const FIELD_VOCABULARY: Record<string, string[]> = {');
for (const [key, [schema, prop]] of Object.entries(FIELD_GROUP_SCHEMAS)) {
	const groups = parseGroups(pick(schema, prop));
	if (groups.length === 0) throw new Error(`${key}: parsed no field groups from ${schema}.${prop}`);
	lines.push(`\t${q(key)}: [`);
	for (const g of groups) lines.push(`\t\t${q(g)},`);
	lines.push('\t],');
}
for (const [record, prefix] of Object.entries(SEARCH_RECORDS)) {
	lines.push(`\t"${RESOURCE_KEY[prefix] ?? prefix.toLowerCase()}.search": ${prefix}_RETURN_PATHS,`);
}
lines.push('};', '');

const aggregationFields = parseListAfter(pick('AggregationRequest', 'field'), 'Supported fields:');
if (aggregationFields.length === 0) throw new Error('parsed no aggregation fields from AggregationRequest.field');
lines.push('/** Columns `aggregations` may group by. A strict subset of the filterable ones. */');
lines.push(...block('JOB_AGGREGATION_FIELDS', aggregationFields));

lines.push('export const FILTER_OPERATORS: INodePropertyOptions[] = [');
for (const [ui, , name] of OPERATORS) lines.push(`\t{ name: ${q(name)}, value: ${q(ui)} },`);
lines.push('];', '');

lines.push('/** UI value -> the token the API expects. */');
lines.push('export const OPERATOR_TO_API: Record<string, string> = {');
for (const [ui, api] of OPERATORS) lines.push(`\t${q(ui)}: ${q(api)},`);
lines.push('};', '');

lines.push('/** Every synchronous endpoint, for the Raw operation. Batch and watch are excluded:');
lines.push(' *  each answers with a handle Raw has no way to redeem. */');
lines.push('export const SYNC_ENDPOINTS: Array<{ method: string; path: string }> = [');
for (const { method, path } of syncEndpoints(spec.paths)) {
	lines.push(`\t{ method: ${q(method)}, path: ${q(path)} },`);
}
lines.push('];', '');

lines.push('/** Batch submit endpoints. Each answers with a batch_id rather than records. */');
lines.push(
	'export const BATCH_ENDPOINTS: Array<{ path: string; label: string; maxItems?: number }> = [',
);
for (const { path, label, maxItems } of batchEndpoints(spec.paths, spec)) {
	const cap = maxItems === undefined ? '' : `, maxItems: ${maxItems}`;
	lines.push(`\t{ path: ${q(path)}, label: ${q(label)}${cap} },`);
}
lines.push('];', '');

lines.push('/** The spec version these tables came from. The credential must send this exact value. */');
lines.push(`export const SPEC_VERSION = ${q(SPEC_VERSION)};`, '');

lines.push('/** Spec-declared request properties per synchronous POST endpoint. Drift guard only. */');
lines.push('export const REQUEST_PARAMS: Record<string, readonly string[]> = {');
for (const [p, params] of Object.entries(requestParams(spec.paths, spec)).sort()) {
	lines.push(`\t${q(p)}: [${params.map(q).join(', ')}],`);
}
lines.push('};', '');

lines.push('/** Every `sources` value /web/search/live declares. The node offers a verified subset. */');
lines.push('export const WEB_SEARCH_SOURCES: readonly string[] = [');
for (const source of webSearchSources(spec)) lines.push(`\t${q(source)},`);
lines.push('];', '');

lines.push('/** Every watch route in the spec. Drift guard only: /watch is excluded from Raw. */');
lines.push('export const WATCH_ROUTES: readonly string[] = [');
for (const route of watchRoutes(spec.paths)) lines.push(`\t${q(route)},`);
lines.push('];', '');

lines.push('export const FILTER_COMBINATORS: INodePropertyOptions[] = [');
lines.push("\t{ name: 'AND', value: 'and' },");
lines.push("\t{ name: 'OR', value: 'or' },");
lines.push("\t{ name: 'All of (Across Nested Array Elements)', value: 'all_of' },");
lines.push('];', '');

const rendered = lines.join('\n');

if (process.argv.includes('--check')) {
	const current = readFileSync(OUT, 'utf8');
	if (current !== rendered) {
		console.error('filter-fields.generated.ts is out of date — run `npm run gen:fields` and commit');
		process.exit(1);
	}
	console.log('ok: filter-fields.generated.ts matches the spec');
} else {
	writeFileSync(OUT, rendered);
	console.log(`wrote ${path.relative(ROOT, OUT)} (${lines.length} lines)`);
}
