import { NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';
import {
	assertDataset,
	assertWatchId,
	DISCOVERY_DATASETS,
	ENTITY_DATASETS,
	watchPath,
} from '../../watch';
import { splitArrayRoot } from '../../response';

/**
 * Replaced in preSend; a routing block must declare a url for the operation to dispatch at all.
 * `/watch` is not a real path on purpose: if the preSend ever stops running, this 404s loudly
 * instead of quietly answering something else.
 */
const PLACEHOLDER = '/watch';

const showOnlyForWatch = { resource: ['watch'] };
const showFor = (...operations: string[]) => ({
	show: { ...showOnlyForWatch, operation: operations },
});

/** Needs a watch id in the path, so all of these validate before dispatch. */
const BY_ID = ['get', 'update', 'cancel', 'test', 'getRuns', 'getRun'];

/**
 * The rest address `/watch/{id}`, which resolves either kind and reports its own `kind` and
 * `dataset` back. Naming a dataset there made the caller state what the id already determines,
 * and 404d when they guessed wrong.
 */
const NEEDS_DATASET = ['list', 'preview', 'test'] as const;

/** Update takes no dataset but does need the kind: the two accept different body fields. */
const NEEDS_KIND = ['list', 'test', 'update'] as const;

export const watchDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showOnlyForWatch },
		options: [
			{
				name: 'Cancel',
				value: 'cancel',
				action: 'Cancel a watch',
				description:
					'Stop a watch permanently. Terminal: the schedule is deleted and never recreated, so use Update with Paused if you may want it back.',
				routing: { request: { method: 'DELETE', url: PLACEHOLDER }, send: { preSend: [sendWatchRequest] } },
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a watch',
				description: 'One watch: its subjects or filters, schedule, delivery channels and status',
				routing: { request: { method: 'GET', url: PLACEHOLDER }, send: { preSend: [sendWatchRequest] } },
			},
			{
				name: 'Get Run',
				value: 'getRun',
				action: 'Get one watch run',
				description:
					'One run in full: its stage logs and, per delivery channel, the payload that was sent',
				routing: { request: { method: 'GET', url: PLACEHOLDER }, send: { preSend: [sendWatchRequest] } },
			},
			{
				name: 'Get Runs',
				value: 'getRuns',
				action: 'Get a watch s run history',
				description:
					'What a watch has found, newest first. The way to read a watch without hosting a webhook, and the only place a failed delivery can still be recovered.',
				routing: { request: { method: 'GET', url: PLACEHOLDER }, send: { preSend: [sendWatchRequest] } },
			},
			{
				name: 'List',
				value: 'list',
				action: 'List watches',
				description:
					'Your watches for a dataset, newest first. Free, and the way to find a watch no workflow holds the ID for.',
				routing: {
					request: { method: 'GET', url: PLACEHOLDER },
					send: { preSend: [sendWatchRequest] },
					output: { postReceive: [splitArrayRoot] },
				},
			},
			{
				name: 'Preview',
				value: 'preview',
				action: 'Preview a watch before creating it',
				description:
					'Dry-run a track condition against a sample record, before any watch exists. Nothing is persisted.',
				routing: {
					request: { method: 'POST', url: PLACEHOLDER },
					send: { preSend: [sendWatchRequest, sendWatchBody] },
				},
			},
			{
				name: 'Test',
				value: 'test',
				action: 'Test an existing watch',
				description: 'Re-check a watch that already exists against a sample record',
				routing: {
					request: { method: 'POST', url: PLACEHOLDER },
					send: { preSend: [sendWatchRequest, sendWatchBody] },
				},
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a watch',
				description:
					'Pause, resume or reconfigure. Only status, config, notifications and (entity only) entities can change.',
				routing: {
					request: { method: 'PATCH', url: PLACEHOLDER },
					send: { preSend: [sendWatchRequest, sendWatchBody] },
				},
			},
		],
		default: 'list',
	},
	{
		displayName: 'Watch Kind',
		name: 'watchKind',
		type: 'options',
		default: 'entity',
		description:
			'Which tree the watch lives in. List and Test are scoped to one tree, and Update needs it because the two kinds accept different fields. Get, Cancel and the run reads address the ID alone and do not ask.',
		displayOptions: { show: { ...showOnlyForWatch, operation: [...NEEDS_KIND] } },
		options: [
			{
				name: 'Discovery',
				value: 'discovery',
				description: 'A filter tree that fires when an entity newly matches it',
			},
			{
				name: 'Entities',
				value: 'entity',
				description: 'A fixed list of people or companies plus a condition on what changed',
			},
		],
	},
	{
		displayName: 'Dataset',
		name: 'entityDataset',
		type: 'options',
		default: 'person',
		description:
			'Which dataset the watch was created on. A mismatch is a 404 rather than a redirect.',
		options: ENTITY_DATASETS,
		displayOptions: {
			show: { ...showOnlyForWatch, operation: [...NEEDS_DATASET] },
			hide: { watchKind: ['discovery'] },
		},
	},
	{
		displayName: 'Dataset',
		name: 'discoveryDataset',
		type: 'options',
		default: 'person',
		description:
			'Which dataset the watch was created on. A mismatch is a 404 rather than a redirect.',
		options: DISCOVERY_DATASETS,
		// Preview is absent: there is no discovery pre-create form to preview against.
		displayOptions: {
			show: { ...showOnlyForWatch, operation: ['list', 'test'], watchKind: ['discovery'] },
		},
	},
	{
		displayName: 'Watch ID',
		name: 'watchId',
		type: 'string',
		required: true,
		default: '',
		// A literal, not an expression: the ID-casing lint rule rewrites a bare `id` token and
		// turned `{{ $json.id }}` into a reference to a field that does not exist.
		placeholder: 'e.g. 4821',
		description: 'The numeric watch ID that List returns. Takes an expression.',
		displayOptions: showFor(...BY_ID),
	},
	{
		displayName: 'Run ID',
		name: 'runId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 91055',
		description: 'The numeric run ID that Get Runs returns. Takes an expression.',
		displayOptions: showFor('getRun'),
	},

	// ---- List ----
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		default: '',
		description:
			'Only return watches in this state. Leave as Any for everything except cancelled, which is what the API omits by default.',
		displayOptions: showFor('list'),
		options: [
			{ name: 'Active', value: 'active' },
			{ name: 'Any', value: '' },
			{ name: 'Cancelled', value: 'cancelled' },
			{ name: 'Expired', value: 'expired' },
			{ name: 'Paused', value: 'paused' },
			{ name: 'Suspended', value: 'suspended' },
		],
		routing: { send: { type: 'query', property: 'status', value: '={{ $value || undefined }}' } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1, maxValue: 500 },
		description: 'Max number of results to return',
		displayOptions: showFor('list'),
		routing: { send: { type: 'query', property: 'limit' } },
	},
	{
		displayName: 'Offset',
		name: 'offset',
		type: 'number',
		default: 0,
		typeOptions: { minValue: 0 },
		description:
			'Skip this many watches. This listing pages on offset rather than a cursor, unlike Get Runs.',
		displayOptions: showFor('list'),
		routing: { send: { type: 'query', property: 'offset', value: '={{ $value || undefined }}' } },
	},

	// ---- Get Runs ----
	{
		displayName: 'Limit',
		name: 'runsLimit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1, maxValue: 1000 },
		description: 'Max number of results to return',
		displayOptions: showFor('getRuns'),
		routing: { send: { type: 'query', property: 'limit' } },
	},
	{
		displayName: 'Cursor',
		name: 'runsCursor',
		type: 'string',
		default: '',
		placeholder: 'e.g. {{ $json.next_cursor }}',
		description:
			'Read the next page of runs. Feed it the next_cursor from the previous answer; leave empty for the first page.',
		displayOptions: showFor('getRuns'),
		routing: { send: { type: 'query', property: 'cursor', value: '={{ $value || undefined }}' } },
	},
	{
		displayName: 'Only Credited Runs',
		name: 'onlyCredited',
		type: 'boolean',
		default: false,
		description:
			'Whether to return only the runs that actually cost credits, which is the answer to what this watch has spent',
		displayOptions: showFor('getRuns'),
		routing: { send: { type: 'query', property: 'only_credited' } },
	},

	// ---- Update ----
	{
		displayName: 'Status',
		name: 'newStatus',
		type: 'options',
		default: '',
		description:
			'New lifecycle state. Leave unchanged to edit the other fields only. Suspended and expired are set by the system and cannot be written here.',
		displayOptions: showFor('update'),
		options: [
			{ name: 'Active', value: 'active' },
			{ name: 'Cancelled (Terminal)', value: 'cancelled' },
			{ name: 'Leave Unchanged', value: '' },
			{ name: 'Paused', value: 'paused' },
		],
	},
	{
		displayName: 'Entities (JSON)',
		name: 'entities',
		type: 'json',
		default: '',
		description:
			'Replacement subject list, exactly as the API documents it. Subjects added here are baselined on the next run, so they do not fire spuriously. Leave empty to leave them alone.',
		displayOptions: { show: { ...showOnlyForWatch, operation: ['update'] }, hide: { watchKind: ['discovery'] } },
	},
	{
		displayName: 'Config (JSON)',
		name: 'config',
		type: 'json',
		default: '',
		description: 'Replacement schedule and freshness config. Leave empty to leave it alone.',
		displayOptions: showFor('update'),
	},
	{
		displayName: 'Notifications (JSON)',
		name: 'notifications',
		type: 'json',
		default: '',
		description:
			'Replacement delivery channels, as a JSON array. Replaces the watch\'s channels wholesale rather than appending. Leave empty to leave them alone.',
		displayOptions: showFor('update'),
	},
	{
		displayName:
			'Track and Fields are immutable on an entity watch, and Filters, Sorts, On and Fields on a discovery one. Sending any of them is a 400: a wrong rule has to be cancelled and recreated.',
		name: 'updateNotice',
		type: 'notice',
		default: '',
		displayOptions: showFor('update'),
	},

	// ---- Preview ----
	{
		displayName: 'Track (JSON)',
		name: 'track',
		type: 'json',
		required: true,
		default: '{}',
		description:
			'The track condition to dry-run, exactly as the API documents it. This is the whole point of Preview: track is immutable once a watch exists, and a wrong rule fails by never firing rather than by erroring.',
		displayOptions: showFor('preview'),
	},
	{
		displayName:
			'Discovery watches have no pre-create preview. Check a discovery filter by running the same filters through Person, Company or Job Search at Limit 1 and reading total_count — that is a normal billed search, roughly 0.03 credits per result.',
		name: 'previewNotice',
		type: 'notice',
		default: '',
		displayOptions: showFor('preview'),
	},

	// ---- Preview + Test ----
	{
		displayName: 'Sample Fields',
		name: 'sampleFields',
		type: 'string',
		default: '',
		placeholder: 'e.g. basic_profile, headcount',
		description:
			'Field groups to project the sample record to, comma-separated. Entitlement-checked like a create. Leave empty for the watch\'s own fields.',
		// Absent from the discovery test body: a discovery watch projects with the fields it
		// was created with.
		displayOptions: {
			show: { ...showOnlyForWatch, operation: ['preview', 'test'] },
			hide: { watchKind: ['discovery'] },
		},
	},
	{
		displayName: 'Sample Count',
		name: 'count',
		type: 'number',
		default: 1,
		typeOptions: { minValue: 1, maxValue: 25 },
		description: 'How many sample subjects to put in the one envelope',
		displayOptions: showFor('preview', 'test'),
	},
	{
		displayName: 'Deliver',
		name: 'deliver',
		type: 'boolean',
		default: false,
		description:
			'Whether to actually send the sample to a delivery channel. Off returns the envelope without sending anything, which is what you want while checking a rule. <b>The API defaults this on; this node defaults it off</b>, so a test run does not fire a webhook you did not ask for.',
		displayOptions: showFor('preview', 'test'),
	},
	{
		displayName: 'Notification Endpoint',
		name: 'notificationEndpoint',
		type: 'string',
		default: '',
		placeholder: 'e.g. https://example.com/hook',
		description:
			'Public URL to deliver the sample to. Required by Preview when Deliver is on, since no saved watch exists to fall back on; optional on Test, which otherwise uses the watch\'s own channels.',
		displayOptions: showFor('preview', 'test'),
	},
];

const kindOf = (ctx: IExecuteSingleFunctions): string =>
	ctx.getNodeParameter('watchKind', 'entity') as string;

const datasetOf = (ctx: IExecuteSingleFunctions, kind: string): string =>
	ctx.getNodeParameter(
		kind === 'discovery' ? 'discoveryDataset' : 'entityDataset',
		'person',
	) as string;

/**
 * Every watch URL in one function, because the path rules are the thing that goes wrong. What
 * is left of them binds List and Test only: entity and discovery are different trees, and the
 * dataset must be the one the watch was created on or the call 404s.
 */
export async function sendWatchRequest(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const operation = this.getNodeParameter('operation', '') as string;

	if (operation === 'preview') {
		// Entity only, and the one route with no id to address, so the tree is named rather
		// than read back from a parameter this operation hides.
		const only = assertDataset(this.getNode(), 'entity', datasetOf(this, 'entity'));
		requestOptions.url = `${watchPath('entity', only)}/test`;
		return requestOptions;
	}

	if (operation === 'list') {
		const kind = kindOf(this);
		requestOptions.url = watchPath(kind, assertDataset(this.getNode(), kind, datasetOf(this, kind)));
		return requestOptions;
	}

	const watchId = assertWatchId(this.getNode(), this.getNodeParameter('watchId', ''), 'Watch ID');

	// Test is the only id-addressed route still scoped to a dataset and a kind.
	if (operation === 'test') {
		const kind = kindOf(this);
		const dataset = assertDataset(this.getNode(), kind, datasetOf(this, kind));
		requestOptions.url = `${watchPath(kind, dataset, watchId)}/test`;
		return requestOptions;
	}

	switch (operation) {
		case 'getRuns':
			requestOptions.url = `/watch/${watchId}/runs`;
			break;
		case 'getRun': {
			const runId = assertWatchId(this.getNode(), this.getNodeParameter('runId', ''), 'Run ID');
			requestOptions.url = `/watch/${watchId}/runs/${runId}/summary`;
			break;
		}
		default:
			requestOptions.url = `/watch/${watchId}`;
	}
	return requestOptions;
}

/** A JSON box the author left empty is not an edit, so the key is omitted rather than sent null. */
function parsedOrUndefined(
	ctx: IExecuteSingleFunctions,
	parameter: string,
	label: string,
): unknown {
	const authored = ctx.getNodeParameter(parameter, '');
	const raw = typeof authored === 'string' ? authored.trim() : JSON.stringify(authored ?? '');
	if (!raw || raw === '""') return undefined;
	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new NodeOperationError(ctx.getNode(), `${label} is not valid JSON: ${(error as Error).message}`, {
			description: 'Leave it empty to leave that part of the watch alone.',
		});
	}
}

const csv = (value: unknown): string[] =>
	String(value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

/**
 * Update sends only the keys the author filled, because every one of them REPLACES what the
 * watch holds: an empty notifications array sent by accident would silently unhook every
 * delivery channel.
 */
export async function sendWatchBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const operation = this.getNodeParameter('operation', '') as string;
	const body: IDataObject = {};

	if (operation === 'update') {
		const status = this.getNodeParameter('newStatus', '') as string;
		if (status) body.status = status;
		for (const [parameter, key, label] of [
			['entities', 'entities', 'Entities (JSON)'],
			['config', 'config', 'Config (JSON)'],
			['notifications', 'notifications', 'Notifications (JSON)'],
		] as const) {
			// Entities is hidden for a discovery watch, so it reads back as '' and is skipped.
			const value = parsedOrUndefined(this, parameter, label);
			if (value !== undefined) body[key] = value;
		}
		if (Object.keys(body).length === 0) {
			throw new NodeOperationError(this.getNode(), 'This update changes nothing', {
				description:
					'Set a Status, or fill one of the JSON boxes. An empty box leaves that part of the watch alone.',
			});
		}
		requestOptions.body = body;
		return requestOptions;
	}

	const deliver = this.getNodeParameter('deliver', false) as boolean;
	const endpoint = String(this.getNodeParameter('notificationEndpoint', '') ?? '').trim();

	if (operation === 'preview') {
		const track = parsedOrUndefined(this, 'track', 'Track (JSON)');
		if (track === undefined) {
			throw new NodeOperationError(this.getNode(), 'Preview needs a Track condition', {
				description: 'It is the rule being dry-run; there is no watch here to read one from.',
			});
		}
		body.track = track;
	}

	// Preview has no saved watch to fall back on, so the API requires an endpoint whenever it
	// is going to deliver. Caught here rather than relayed as a 400 that names nothing.
	if (operation === 'preview' && deliver && !endpoint) {
		throw new NodeOperationError(
			this.getNode(),
			'Deliver is on, so Preview needs a Notification Endpoint',
			{ description: 'Turn Deliver off to get the envelope back without sending it anywhere.' },
		);
	}

	if (endpoint) body.notification_endpoint = endpoint;
	const fields = csv(this.getNodeParameter('sampleFields', ''));
	if (fields.length) body.fields = fields;
	body.count = this.getNodeParameter('count', 1);
	// Always explicit: the API defaults this to true, and this node defaults it to false.
	body.deliver = deliver;

	requestOptions.body = body;
	return requestOptions;
}
