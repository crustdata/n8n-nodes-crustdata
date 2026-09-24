import { NodeOperationError } from 'n8n-workflow';
import type {
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeProperties,
	INodePropertyOptions,
} from 'n8n-workflow';
import { BATCH_ENDPOINTS } from '../../filter-fields.generated';
import { usageProperty } from '../../usage';

const showOnlyForBatch = { resource: ['batch'] };
const showForSubmit = { ...showOnlyForBatch, operation: ['submit'] };

// The cap is per endpoint and spans 10 to 10,000, so it is named on each option rather than
// stated once: the synchronous operations take 25, and carrying that number over here would
// throw away the reason to use batch at all.
const endpointOptions: INodePropertyOptions[] = BATCH_ENDPOINTS.map(({ path, label, maxItems }) => ({
	name: label.replace(/\b\w/g, (c) => c.toUpperCase()),
	value: path,
	...(maxItems === undefined
		? {}
		: { description: `Up to ${maxItems.toLocaleString('en-US')} identifiers per job` }),
}));

/** Checked at dispatch for the same reason Raw's is: the value becomes the request URL. */
const ALLOWED = new Set(BATCH_ENDPOINTS.map((e) => e.path));

export const batchDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showOnlyForBatch },
		options: [
			{
				name: 'Submit',
				value: 'submit',
				action: 'Submit a batch job',
				description:
					'Send a large list for asynchronous processing. Answers with a batch ID, not records.',
				routing: {
					request: { method: 'POST', url: '/batch/person/enrich' },
					send: { preSend: [sendBatchSubmit] },
				},
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a batch job',
				description: 'Read one job: its status and, once finished, its download URLs',
				routing: {
					request: { method: 'GET', url: '/batch' },
					send: { preSend: [sendBatchGet] },
				},
			},
			{
				name: 'List',
				value: 'list',
				action: 'List batch jobs',
				description: 'Your recent jobs, newest first',
				routing: { request: { method: 'GET', url: '/batch' } },
			},
		],
		default: 'submit',
	},
	{
		displayName: 'Endpoint',
		name: 'endpoint',
		type: 'options',
		default: '/batch/person/enrich',
		description:
			'Which batch endpoint to submit to. The body is the same shape as the synchronous operation of the same name, but the size limit is not: these take hundreds or thousands of identifiers where the synchronous operations take 25. Each option names its own cap.',
		options: endpointOptions,
		displayOptions: { show: showForSubmit },
	},
	{
		displayName: 'Body',
		name: 'body',
		type: 'json',
		default: '{}',
		description:
			'The JSON request body, exactly as the API documents it for this endpoint. Nothing here is validated or reshaped by the node.',
		displayOptions: { show: showForSubmit },
	},
	{
		displayName: 'Call Back When Finished',
		name: 'useCallback',
		type: 'boolean',
		default: true,
		description:
			'Whether to have Crustdata POST to this execution when the job finishes, so a Wait node downstream resumes instead of polling',
		hint: 'Put a Wait node set to "On Webhook Call" straight after this one. Polling a long job burns rate limit for nothing.',
		displayOptions: { show: showForSubmit },
	},
	{
		displayName: 'Batch ID',
		name: 'batchId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. {{ $json.batch_id }}',
		description: 'The batch ID returned by Submit',
		displayOptions: { show: { ...showOnlyForBatch, operation: ['get'] } },
	},
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		default: '',
		description: 'Only return jobs in this state. Leave empty for all.',
		displayOptions: { show: { ...showOnlyForBatch, operation: ['list'] } },
		options: [
			{ name: 'Any', value: '' },
			{ name: 'Completed', value: 'completed' },
			{ name: 'Failed', value: 'failed' },
			{ name: 'Pending', value: 'pending' },
			{ name: 'Processing', value: 'processing' },
		],
		routing: { send: { type: 'query', property: 'status', value: '={{ $value || undefined }}' } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1, maxValue: 100 },
		description: 'Max number of results to return',
		displayOptions: { show: { ...showOnlyForBatch, operation: ['list'] } },
		routing: { send: { type: 'query', property: 'limit' } },
	},
	{
		displayName: 'Cursor',
		name: 'cursor',
		type: 'string',
		default: '',
		placeholder: 'e.g. {{ $json.next_cursor }}',
		description:
			'Read the next page. Feed it the next_cursor from the previous answer; it is null once there are no more. Leave empty for the first page.',
		displayOptions: { show: { ...showOnlyForBatch, operation: ['list'] } },
		routing: { send: { type: 'query', property: 'cursor', value: '={{ $value || undefined }}' } },
	},
	usageProperty('batch', 'submit'),
	usageProperty('batch', 'get'),
];

/** The spec types `batch_id` as a uuid, so anything else is not an ID we can look up. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ID lands in the request path, so it is validated rather than interpolated. An
 * expression can put anything here, and an absolute or traversing value would point the
 * credential at a URL we did not choose.
 */
export async function sendBatchGet(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const batchId = String(this.getNodeParameter('batchId', '') ?? '').trim();
	if (!UUID.test(batchId)) {
		throw new NodeOperationError(this.getNode(), `'Batch ID' is not a batch ID: ${batchId}`, {
			description: 'Use the batch_id Submit returned, for example {{ $json.batch_id }}.',
		});
	}
	requestOptions.url = `/batch/${batchId}`;
	return requestOptions;
}

/**
 * Batch answers with a `batch_id` and a `status_url`, never records, and the results arrive
 * as `download_url`s on the finished job. The node relays both verbatim: fetching a signed
 * URL on someone's behalf is an HTTP Request node's job, not ours.
 *
 * `webhook_url` is why this is worth having over Raw. Pointed at `$execution.resumeUrl`, a
 * Wait node downstream resumes the moment the job finishes, so a job of any length costs
 * one request instead of a polling loop against a per-minute limit.
 */
export async function sendBatchSubmit(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const endpoint = this.getNodeParameter('endpoint', '') as string;
	if (!ALLOWED.has(endpoint)) {
		throw new NodeOperationError(this.getNode(), `Not a Crustdata batch endpoint: ${endpoint}`, {
			description: 'Pick one from the list.',
		});
	}

	const authored = this.getNodeParameter('body', '{}');
	const raw = typeof authored === 'string' ? authored.trim() || '{}' : JSON.stringify(authored ?? {});
	let body: Record<string, unknown>;
	try {
		body = JSON.parse(raw) as Record<string, unknown>;
	} catch (error) {
		throw new NodeOperationError(
			this.getNode(),
			`Body is not valid JSON: ${(error as Error).message}`,
			{ description: 'Leave it as {} to send an empty body.' },
		);
	}

	if (this.getNodeParameter('useCallback', true)) {
		// Only when the author did not set one: an explicit URL in the body is a deliberate
		// choice to route the callback somewhere other than this execution.
		body.webhook_url ??= this.evaluateExpression('{{ $execution.resumeUrl }}', 0);
	}

	requestOptions.method = 'POST';
	requestOptions.url = endpoint;
	requestOptions.body = body;
	return requestOptions;
}
