import { NodeOperationError } from 'n8n-workflow';
import type {
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeProperties,
	INodePropertyOptions,
} from 'n8n-workflow';
import { SYNC_ENDPOINTS } from '../../filter-fields.generated';
import { splitArrayRoot } from '../../response';
import { usageProperty } from '../../usage';

const showOnlyForRaw = { resource: ['raw'], operation: ['request'] };

/** `METHOD path`, so one control carries both and they cannot disagree. */
const endpointOptions: INodePropertyOptions[] = SYNC_ENDPOINTS.map(({ method, path }) => ({
	name: `${method} ${path}`,
	value: `${method} ${path}`,
}));

/**
 * The closed set this operation may call.
 *
 * Checked at dispatch, not just offered in the dropdown. The control takes an expression,
 * so its value can come from upstream data or from a model via `usableAsTool`, and the
 * value becomes the request URL: an absolute or protocol-relative one replaces `baseURL`
 * entirely and the credential header is attached to whatever host it names. n8n's
 * per-credential domain allowlist is off by default, so nothing downstream stops it.
 */
const ALLOWED = new Set(SYNC_ENDPOINTS.map((e) => `${e.method} ${e.path}`));

export const rawDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['raw'] } },
		options: [
			{
				name: 'Request',
				value: 'request',
				action: 'Send a raw request',
				description: 'Call any synchronous endpoint with a body you write yourself',
				routing: {
					// Replaced in preSend from the chosen endpoint; a routing block must
					// declare something for the operation to dispatch at all.
					request: { method: 'POST', url: '/account/credits' },
					send: { preSend: [sendRawRequest] },
					output: { postReceive: [splitArrayRoot] },
				},
			},
		],
		default: 'request',
	},
	{
		displayName: 'Endpoint',
		name: 'endpoint',
		type: 'options',
		default: 'POST /person/search',
		description:
			'Which endpoint to call. Synchronous endpoints only, and the value is checked against that list before the request goes out.',
		hint: 'Batch and watch are absent on purpose: each answers with a handle a one-shot request cannot redeem. One included endpoint can too: /person/professional_network/search/live returns a job_id when you send background_job true, and you post that job_id back to the same endpoint to collect it.',
		options: endpointOptions,
		displayOptions: { show: showOnlyForRaw },
	},
	{
		displayName: 'Body',
		name: 'body',
		type: 'json',
		default: '{}',
		description:
			'The JSON request body, exactly as the API documents it. Nothing here is validated or reshaped by the node.',
		displayOptions: { show: showOnlyForRaw },
	},
	usageProperty('raw', 'request'),
];

/**
 * The escape hatch for the endpoints the node does not model. It sends what you typed and
 * relays what came back, so an error here is the API's own, worded by the API.
 */
export async function sendRawRequest(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const endpoint = this.getNodeParameter('endpoint', '') as string;
	if (!ALLOWED.has(endpoint)) {
		throw new NodeOperationError(this.getNode(), `Not a Crustdata endpoint: ${endpoint}`, {
			description:
				'Pick one from the list. For an endpoint this node does not carry, use n8n\'s HTTP Request node with the Crustdata credential.',
		});
	}
	const [method, path] = endpoint.split(' ');

	// Validated before the method branch, so a malformed body is reported on every path
	// rather than only the one that happens to read it.
	const authored = this.getNodeParameter('body', '{}');
	const raw = typeof authored === 'string' ? authored.trim() || '{}' : JSON.stringify(authored ?? {});
	let body: IHttpRequestOptions['body'];
	try {
		body = JSON.parse(raw) as IHttpRequestOptions['body'];
	} catch (error) {
		throw new NodeOperationError(
			this.getNode(),
			`Body is not valid JSON: ${(error as Error).message}`,
			{ description: 'Leave it as {} to send an empty body.' },
		);
	}

	requestOptions.method = method as IHttpRequestOptions['method'];
	requestOptions.url = path;

	// Keyed on the method, not the path: a path can carry both verbs.
	if (method !== 'POST') {
		delete requestOptions.body;
		return requestOptions;
	}

	requestOptions.body = body;
	return requestOptions;
}
