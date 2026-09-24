import type {
	IDataObject,
	IDisplayOptions,
	IExecuteSingleFunctions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

/**
 * The response is relayed as the API returned it. Splitting an envelope is opt-in because it
 * carries what the rows do not — `total_count`, `next_cursor`, `remarks` — and unwrapping by
 * default costs a caller both the cursor and five-of-five versus five-of-seven-thousand.
 */
export function splitProperty(
	resource: string,
	operation: string,
	hideWhen: IDisplayOptions['hide'] = {},
): INodeProperties {
	return {
		displayName: 'Split Results Into Items',
		name: 'splitIntoItems',
		type: 'boolean',
		default: false,
		description:
			'Whether to emit one item per result instead of the whole response. The envelope, including total_count and next_cursor, is dropped when on.',
		// `hide`, not `show`: a mode that drops Return All entirely leaves it undisplayed,
		// and a `show` on an absent parameter matches nothing, taking this toggle with it.
		displayOptions: { show: { resource: [resource], operation: [operation] }, hide: hideWhen },
		routing: { output: { postReceive: [splitIntoItems] } },
	};
}

/** Envelope keys that hold the result array, in the order the API uses them. */
const RESULT_KEYS = [
	'profiles',
	'companies',
	'job_listings',
	'posts',
	'results',
	'suggestions',
	'buckets',
	'events',
	'groups',
] as const;

const isPlainObject = (v: unknown): v is IDataObject =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** The envelope's result array, wherever it sits. Shared with the pagination loop, which
 *  counts what a page returned to keep its own budget. */
export function resultArray(json: unknown): unknown[] | undefined {
	if (!isPlainObject(json)) return undefined;
	const key = RESULT_KEYS.find((k) => Array.isArray(json[k]));
	return key ? (json[key] as unknown[]) : undefined;
}

/**
 * No envelope to lose, so splitting is unconditional and there is no toggle. Kept whole, n8n
 * renders the array keyed "0", "1" — a JS artifact rather than what the API sent.
 */
export async function splitArrayRoot(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const body = response?.body;
	// An empty array is the API's "no match". Returning [] here would delete the
	// row from the run instead of reporting it, and take its usage with it.
	if (!Array.isArray(body) || body.length === 0) return items;

	const base = items[0] ?? { json: {} };
	return body.map((entry) => ({ ...base, json: entry as IDataObject }));
}

export async function splitIntoItems(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	if (!this.getNodeParameter('splitIntoItems', false)) return items;

	const out: INodeExecutionData[] = [];
	for (const item of items) {
		const results = resultArray(item.json);
		if (!results?.length) {
			out.push(item);
			continue;
		}
		for (const entry of results) {
			out.push({ ...item, json: entry as IDataObject });
		}
	}
	return out;
}
