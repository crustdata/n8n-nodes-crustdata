import { createHmac, timingSafeEqual } from 'node:crypto';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { DISCOVERY_DATASETS, ENTITY_DATASETS, watchPath } from '../Crustdata/watch';

const BASE = 'https://api.crustdata.com';

/** `t=<unix>,v1=<hex>`: HMAC-SHA256 over `<t>.<raw body>`, keyed by the API key. */
const SIGNATURE_HEADER = 'x-crustdata-signature';

/** A delivery older than this is a replay, not a retry. */
const MAX_SKEW_SECONDS = 300;


type StaticData = { watchId?: string; watchPath?: string };

/**
 * A watch that is not there is the outcome both lifecycle methods want; anything else is a
 * real failure and must not be mistaken for it. A transient error swallowed here would
 * either duplicate a subscription on the next activation or leave one billing forever.
 */
const isNotFound = (error: unknown): boolean => {
	const e = error as { httpCode?: string | number; statusCode?: number; status?: number };
	return String(e?.httpCode ?? e?.statusCode ?? e?.status) === '404';
};

const kindOf = (ctx: IHookFunctions): string =>
	ctx.getNodeParameter('watchKind', 'entity') as string;

const datasetOf = (ctx: IHookFunctions): string =>
	ctx.getNodeParameter(
		kindOf(ctx) === 'discovery' ? 'discoveryDataset' : 'entityDataset',
		'person',
	) as string;

function equal(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	// Length first: timingSafeEqual throws on a mismatch, and a length is not a secret.
	return x.length === y.length && timingSafeEqual(x, y);
}

/** `t=1700000000,v1=abc…` in either order, tolerating spaces. */
function parseSignature(header: unknown): { t: string; v1: string } | undefined {
	if (typeof header !== 'string') return undefined;
	const parts = Object.fromEntries(
		header.split(',').map((p) => {
			const i = p.indexOf('=');
			return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
		}),
	);
	return parts.t && parts.v1 ? { t: parts.t, v1: parts.v1 } : undefined;
}

/** Teardown must address the watch that exists, not the one today's parameters describe. */
const pathFor = (ctx: IHookFunctions, data: StaticData): string =>
	data.watchPath ?? watchPath(kindOf(ctx), datasetOf(ctx), data.watchId as string);

/** Each kind keeps its own parameters, so switching cannot carry a value across. */
const forKind = (kind: string) => ({ show: { watchKind: [kind] } });

export class CrustdataTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Crustdata Trigger',
		name: 'crustdataTrigger',
		// The mark is brand indigo with no white or black, so one file reads on both
		// canvases; a themed pair would be two copies of the same artwork.
		// eslint-disable-next-line @n8n/community-nodes/icon-prefer-themed-variants
		icon: 'file:crustdata.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["watchKind"]}}',
		description: 'Starts a workflow when Crustdata data changes',
		defaults: { name: 'Crustdata Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'crustdataApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		hints: [
			{
				// A failed delivery is never replayed into the workflow; the watch's own run list is
				// the only place a missed notification is still recoverable.
				message:
					'Every run is recorded on the watch itself. <b>Watch → Get Runs</b> on the Crustdata node lists them, including runs whose delivery to n8n never arrived.',
				type: 'info',
				location: 'outputPane',
				whenToDisplay: 'afterExecution',
			},
		],
		properties: [
			{
				displayName: 'Watch Kind',
				name: 'watchKind',
				type: 'options',
				default: 'entity',
				description: 'What to watch',
				options: [
					{
						name: 'Discovery',
						value: 'discovery',
						description: 'Re-run a search on a schedule, and fire when a record newly matches',
					},
					{
						name: 'Entities',
						value: 'entity',
						description: 'Track a list of people or companies you name, and fire when one changes',
					},
				],
			},
			{
				displayName: 'Dataset',
				name: 'entityDataset',
				type: 'options',
				default: 'person',
				description: 'Which dataset to watch. Entity watches cover people and companies.',
				options: ENTITY_DATASETS,
				displayOptions: forKind('entity'),
			},
			{
				displayName: 'Dataset',
				name: 'discoveryDataset',
				type: 'options',
				default: 'person',
				description: 'Which dataset to watch',
				options: DISCOVERY_DATASETS,
				displayOptions: forKind('discovery'),
			},
			{
				displayName: 'Watch Definition (JSON)',
				name: 'entityDefinition',
				type: 'json',
				required: true,
				default: '{\n  "entities": {},\n  "track": {},\n  "config": {}\n}',
				description:
					'The watch body, exactly as the API documents it: entities, track and config. The node adds its own notification channel; everything else here is yours.',
				displayOptions: forKind('entity'),
			},
			{
				displayName:
					'Track is immutable once this watch exists, and a wrong rule fails by never firing rather than by erroring. Dry-run it first with the Crustdata node\'s <b>Watch \u2192 Preview</b> operation, which costs nothing and creates nothing.',
				name: 'previewNotice',
				type: 'notice',
				default: '',
				displayOptions: forKind('entity'),
			},
			{
				displayName: 'Watch Definition (JSON)',
				name: 'discoveryDefinition',
				type: 'json',
				required: true,
				default: '{\n  "filters": {},\n  "on": ["added"],\n  "config": {}\n}',
				description:
					'The watch body, exactly as the API documents it: filters, on and config. The node adds its own notification channel; everything else here is yours.',
				displayOptions: forKind('discovery'),
			},
			{
				displayName:
					'Every delivery is checked against Crustdata\'s HMAC signature and rejected with a 401 if it does not match or is more than five minutes old. Redeliveries are not de-duplicated: key on the delivery event ID header downstream if a repeat would cause harm.',
				name: 'deliveryNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	webhookMethods = {
		default: {
			/**
			 * n8n asks this before creating, and again to decide whether a deactivate has
			 * anything to undo. A watch we no longer hold an id for is not ours to reuse.
			 */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node') as StaticData;
				// Both fields, not just the id. A watch registered by an older version of
				// this node carries no path, and confirming it here would skip the create
				// that records one, leaving teardown guessing forever.
				if (!data.watchId || !data.watchPath) return false;

				try {
					await this.helpers.httpRequestWithAuthentication.call(this, 'crustdataApi', {
						method: 'GET',
						baseURL: BASE,
						url: pathFor(this, data),
						json: true,
					});
					return true;
				} catch (error) {
					if (!isNotFound(error)) throw new NodeApiError(this.getNode(), error as JsonObject);
					// Gone upstream. Keeping either field would make the next activation skip
					// creating a live one.
					delete data.watchId;
					delete data.watchPath;
					return false;
				}
			},

			/** Activation creates the subscription and points it at this workflow. */
			async create(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				if (!url) {
					throw new NodeOperationError(this.getNode(), 'n8n did not provide a webhook URL');
				}

				const kind = kindOf(this);
				const authored = this.getNodeParameter(
					kind === 'discovery' ? 'discoveryDefinition' : 'entityDefinition',
					'{}',
				);
				const raw =
					typeof authored === 'string' ? authored.trim() || '{}' : JSON.stringify(authored ?? {});

				let body: IDataObject;
				try {
					body = JSON.parse(raw) as IDataObject;
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Watch Definition (JSON) is not valid JSON: ${(error as Error).message}`,
					);
				}

				const data = this.getWorkflowStaticData('node') as StaticData;

				// The one thing the node owns. An author who declared their own channels meant
				// them, so this appends rather than replaces.
				const channels = Array.isArray(body.notifications) ? body.notifications : [];
				body.notifications = [...channels, { type: 'webhook', url }];

				const created = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'crustdataApi',
					{
						method: 'POST',
						baseURL: BASE,
						url: watchPath(kind, datasetOf(this)),
						body,
						json: true,
					},
				)) as IDataObject;

				// Do NOT require `watch_id`: the response carries only `id`, so demanding it threw
				// after the watch was already made and left it billing with nobody holding its handle.
				const id = created?.id ?? created?.watch_id;
				if (id === undefined || id === null || id === '') {
					throw new NodeOperationError(
						this.getNode(),
						'Crustdata created the watch but returned no id, so this workflow cannot delete it later',
						{
							// Keys only: the body echoes `notifications`, which carries delivery
							// headers, and an activation error lands in the UI and the logs.
						description: `Cancel it by hand or it keeps billing. Response keys: ${Object.keys(created ?? {}).join(', ')}`,
						},
					);
				}

				if (!/^\d+$/.test(String(id))) {
					throw new NodeOperationError(this.getNode(), `Crustdata returned a watch id this node cannot address: ${String(id)}`);
				}

				data.watchId = String(id);
				// The path, not just the id. Recomputing it at teardown from whatever the
				// parameters say THEN deletes a path the watch never lived at, 404s, and the
				// real watch stays live with nobody holding its handle.
				data.watchPath = watchPath(kind, datasetOf(this), data.watchId);
				return true;
			},

			/** Deactivation cancels it. A watch left behind bills and delivers to nothing. */
			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node') as StaticData;
				if (!data.watchId) return true;

				try {
					await this.helpers.httpRequestWithAuthentication.call(this, 'crustdataApi', {
						method: 'DELETE',
						baseURL: BASE,
						url: pathFor(this, data),
						json: true,
					});
				} catch (error) {
					if (!isNotFound(error)) throw new NodeApiError(this.getNode(), error as JsonObject);
				}
				delete data.watchId;
				delete data.watchPath;
				return true;
			},
		},
	};

	/**
	 * Checked against the RAW bytes: the signature is HMAC-SHA256 over `<t>.<raw body>` keyed
	 * by the API key, and a re-serialised body differs over whitespace alone.
	 */
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const signature = parseSignature(this.getHeaderData()[SIGNATURE_HEADER]);
		const { apiKey } = (await this.getCredentials('crustdataApi')) as { apiKey: string };
		// Typed as always present, but n8n fills it only on the content types it parses for a
		// body: a multipart POST reaches the node with nothing here, and an unsigned caller
		// controls the content type.
		const raw = this.getRequestObject().rawBody as Buffer | undefined;

		const fresh =
			signature !== undefined &&
			raw !== undefined &&
			Math.abs(Date.now() / 1000 - Number(signature.t)) <= MAX_SKEW_SECONDS;
		const genuine =
			fresh &&
			equal(
				signature.v1,
				createHmac('sha256', apiKey).update(`${signature.t}.${raw.toString()}`).digest('hex'),
			);

		if (!genuine) {
			// The response has to be written here. `noWebhookResponse` tells n8n the node
			// already answered; returning it without writing leaves the socket open, which
			// on an unauthenticated path is a way to exhaust the instance.
			this.getResponseObject().status(401).send('Unauthorized').end();
			return { noWebhookResponse: true };
		}

		return { workflowData: [this.helpers.returnJsonArray(this.getBodyData())] };
	}
}
