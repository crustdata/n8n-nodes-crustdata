import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteSingleFunctions, IHttpRequestOptions, INodeProperties } from 'n8n-workflow';
import { splitProperty } from '../../response';
import { usageProperty } from '../../usage';

const WINDOWED = ['usageSummary', 'usageEvents', 'usageErrors'];
const SUMMARY_AND_EVENTS = ['usageSummary', 'usageEvents'];

const forOps = (operations: string[]) => ({ show: { resource: ['account'], operation: operations } });

/** Comma-separated in the UI, comma-separated on the wire: the API accepts the list form. */
const listOrNothing = '={{ $value.split(",").map(s => s.trim()).filter(Boolean).join(",") || undefined }}';

const csvFilter = (
	displayName: string,
	name: string,
	property: string,
	operations: string[],
	description: string,
	placeholder: string,
): INodeProperties => ({
	displayName,
	name,
	type: 'string',
	default: '',
	placeholder,
	description,
	displayOptions: forOps(operations),
	routing: { send: { type: 'query', property, value: listOrNothing } },
});

export const accountUsageDescription: INodeProperties[] = [
	{
		displayName: 'Start',
		name: 'start',
		type: 'string',
		default: '',
		placeholder: 'e.g. 2026-09-21',
		description:
			'Start of the window, inclusive. A date reads as midnight UTC; an ISO 8601 timestamp is exact. Defaults to 7 days before the end, and cannot be more than 12 months ago.',
		displayOptions: forOps(WINDOWED),
		routing: { send: { type: 'query', property: 'start', value: '={{ $value || undefined }}' } },
	},
	{
		displayName: 'End',
		name: 'end',
		type: 'string',
		default: '',
		placeholder: 'e.g. 2026-09-24',
		description:
			'End of the window, exclusive. Same formats as Start. Defaults to the coming midnight UTC.',
		displayOptions: forOps(WINDOWED),
		routing: { send: { type: 'query', property: 'end', value: '={{ $value || undefined }}' } },
	},
	{
		displayName: 'Group By',
		name: 'groupBy',
		type: 'multiOptions',
		default: [],
		description:
			'Dimensions to split the totals by. Leave empty for one total row. Day returns the time column as bucket_start; Component returns what the credits were spent on and swaps errors and results for quantity.',
		hint: 'Over a window of whole days, Component pairs only with Day and Product, and any other combination needs Bucket set to Hour.',
		displayOptions: forOps(['usageSummary']),
		options: [
			{ name: 'API Key ID', value: 'api_key_id' },
			{ name: 'Client Surface', value: 'client_surface' },
			{ name: 'Component', value: 'component' },
			{ name: 'Day', value: 'day' },
			{ name: 'Endpoint', value: 'endpoint' },
			{ name: 'Product', value: 'product' },
			{ name: 'Status Class', value: 'status_class' },
		],
		routing: {
			send: { type: 'query', property: 'group_by', value: '={{ $value.length ? $value.join(",") : undefined }}' },
		},
	},
	{
		displayName: 'Bucket',
		name: 'bucket',
		type: 'options',
		default: '1d',
		description:
			'Size of each time bucket when grouping by Day. Hour reads every request rather than daily totals, which is slower and accepts every grouping and filter.',
		displayOptions: forOps(['usageSummary']),
		options: [
			{ name: 'Day', value: '1d' },
			{ name: 'Hour', value: '1h' },
		],
		routing: { send: { type: 'query', property: 'bucket' } },
	},
	csvFilter(
		'Endpoints',
		'endpoints',
		'endpoints',
		WINDOWED,
		'Keep only these endpoints, comma-separated, up to 50. Written as they appear in an event, so a legacy path you called is filtered by its own name.',
		'e.g. /person/search',
	),
	csvFilter(
		'API Key IDs',
		'apiKeyIds',
		'api_key_ids',
		WINDOWED,
		'Keep only requests made with these API key IDs, comma-separated, up to 50. The IDs come back as api_key_id on an event.',
		'e.g. 170',
	),
	csvFilter(
		'Products',
		'products',
		'products',
		SUMMARY_AND_EVENTS,
		'Keep only these products, comma-separated, up to 50, as they appear in an event',
		'e.g. person_search',
	),
	csvFilter(
		'Client Surfaces',
		'clientSurfaces',
		'client_surface',
		SUMMARY_AND_EVENTS,
		'Keep only requests from these surfaces, comma-separated, up to 10. This is how API traffic is told apart from MCP traffic.',
		'e.g. mcp',
	),
	csvFilter(
		'Status Codes',
		'statusCodes',
		'status',
		SUMMARY_AND_EVENTS,
		'Keep only these HTTP status codes, comma-separated, up to 20. On the summary this needs Bucket set to Hour, or a window that is not whole days.',
		'e.g. 400,404',
	),
	{
		displayName: 'Status Class',
		name: 'statusClass',
		type: 'options',
		default: '',
		description: 'Keep only one class of response. Leave empty for all.',
		displayOptions: forOps(SUMMARY_AND_EVENTS),
		options: [
			{ name: '2xx', value: '2xx' },
			{ name: '3xx', value: '3xx' },
			{ name: '4xx', value: '4xx' },
			{ name: '5xx', value: '5xx' },
			{ name: 'Any', value: '' },
		],
		routing: { send: { type: 'query', property: 'status_class', value: '={{ $value || undefined }}' } },
	},
	{
		displayName: 'Error Type',
		name: 'errorType',
		type: 'string',
		default: '',
		placeholder: 'e.g. invalid_request',
		description:
			'Keep only requests that failed with this error type. On the summary this needs Bucket set to Hour, or a window that is not whole days.',
		displayOptions: forOps(SUMMARY_AND_EVENTS),
		routing: { send: { type: 'query', property: 'error_type', value: '={{ $value || undefined }}' } },
	},
	{
		displayName: 'Error Key',
		name: 'errorKey',
		type: 'string',
		default: '',
		placeholder: 'e.g. {{ $json.error_key }}',
		description:
			'Keep only the requests in one error group. Feed it an error_key from Get Usage Errors exactly as returned.',
		displayOptions: forOps(['usageEvents']),
		routing: { send: { type: 'query', property: 'error_key', value: '={{ $value || undefined }}' } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1, maxValue: 500 },
		description: 'Max number of results to return',
		displayOptions: forOps(['usageEvents']),
		routing: { send: { type: 'query', property: 'limit' } },
	},
	{
		displayName: 'Cursor',
		name: 'cursor',
		type: 'string',
		default: '',
		placeholder: 'e.g. {{ $json.next_cursor }}',
		description:
			'Read the next page. Feed it the next_cursor from the previous answer, which is present while has_more is true. Leave empty for the first page.',
		displayOptions: forOps(['usageEvents']),
		routing: { send: { type: 'query', property: 'cursor', value: '={{ $value || undefined }}' } },
	},
	{
		displayName: 'Request ID',
		name: 'requestId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. {{ $json.example_event_id }}',
		description:
			"A response's X-Request-ID, also returned as event_id by Get Usage Events and as example_event_id by Get Usage Errors",
		displayOptions: forOps(['usageEvent']),
	},
	splitProperty('account', 'usageSummary'),
	splitProperty('account', 'usageEvents'),
	splitProperty('account', 'usageErrors'),
	usageProperty('account', 'usageSummary'),
	usageProperty('account', 'usageEvents'),
	usageProperty('account', 'usageErrors'),
	usageProperty('account', 'usageEvent'),
];

/** Anything that would re-address the request rather than name an event within it. */
const UNSAFE_IN_PATH = /[^A-Za-z0-9._~-]/;

/**
 * The ID lands in the path, and the control takes an expression, so its value can arrive from
 * upstream data or from a model. The spec types it as a 256-character string rather than a
 * uuid, so the check is on the characters, not the shape.
 */
export async function sendUsageEvent(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const requestId = String(this.getNodeParameter('requestId', '') ?? '').trim();
	if (requestId === '' || requestId.length > 256 || UNSAFE_IN_PATH.test(requestId)) {
		throw new NodeOperationError(
			this.getNode(),
			`Not a request ID: ${JSON.stringify(requestId)}`,
			{ description: 'Use the X-Request-Id of a response, or an event_id from Get Usage Events.' },
		);
	}
	return { ...requestOptions, url: `/account/usage/events/${requestId}` };
}

/**
 * With `bucket=1d` over a window of whole UTC days the summary is read from daily rollups,
 * which do not carry every dimension. Live-verified 2026-09-24: grouping by `component` then
 * admits only `day` and `product` beside it and only the `products` filter, and the `status`
 * and `error_type` filters are refused outright. An hourly bucket or a window that is not
 * whole days reads every request and accepts all of it.
 *
 * The default window is the last 7 whole days, so the restricted mode is the one a caller
 * lands in without choosing it.
 */
const COMPONENT_ALLOWS = ['day', 'product'];
const HOURLY_ONLY = [
	{ parameter: 'statusCodes', label: 'Status Codes' },
	{ parameter: 'errorType', label: 'Error Type' },
];
const COMPONENT_REFUSES = [
	{ parameter: 'endpoints', label: 'Endpoints' },
	{ parameter: 'apiKeyIds', label: 'API Key IDs' },
	{ parameter: 'clientSurfaces', label: 'Client Surfaces' },
	{ parameter: 'statusClass', label: 'Status Class' },
];

/** Midnight UTC however it is written, and an empty value, because the default window is whole days. */
const wholeDay = (value: string): boolean => {
	if (value.trim() === '') return true;
	const t = Date.parse(value);
	// Unparseable is not ours to judge: the API answers with its own date error.
	return Number.isNaN(t) ? false : t % 86_400_000 === 0;
};

export async function assertSummaryShape(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const param = (name: string): string => String(this.getNodeParameter(name, '') ?? '').trim();
	const set = (name: string): boolean => param(name) !== '';

	const dailyRollup =
		param('bucket') !== '1h' && wholeDay(param('start')) && wholeDay(param('end'));
	if (!dailyRollup) return requestOptions;

	const hourlyOnly = HOURLY_ONLY.filter((f) => set(f.parameter)).map((f) => f.label);
	if (hourlyOnly.length > 0) {
		throw new NodeOperationError(
			this.getNode(),
			`${hourlyOnly.join(' and ')} cannot be used over a window of whole days`,
			{ description: 'Set Bucket to Hour, or start or end the window part way through a day.' },
		);
	}

	const groupBy = (this.getNodeParameter('groupBy', []) as string[]) ?? [];
	if (!groupBy.includes('component')) return requestOptions;

	const alsoGrouped = groupBy.filter((d) => d !== 'component' && !COMPONENT_ALLOWS.includes(d));
	const alsoFiltered = COMPONENT_REFUSES.filter((f) => set(f.parameter)).map((f) => f.label);
	if (alsoGrouped.length > 0 || alsoFiltered.length > 0) {
		const offending = [...alsoGrouped, ...alsoFiltered].join(', ');
		throw new NodeOperationError(
			this.getNode(),
			`Grouping by Component over a window of whole days rules out ${offending}`,
			{
				description:
					'Beside Component the daily totals carry only Day, Product and the Products filter. Set Bucket to Hour for the rest.',
			},
		);
	}
	return requestOptions;
}
