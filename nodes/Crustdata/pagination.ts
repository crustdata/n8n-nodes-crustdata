import type {
	DeclarativeRestApiSettings,
	IDataObject,
	IExecutePaginationFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { resultArray } from './response';

/** Envelope key carrying the cursor for the next page, across every paged endpoint. */
const CURSOR_KEY = 'next_cursor';

/**
 * One map rather than an argument at the node, so a new paged operation cannot silently
 * inherit another's cap.
 */
const PAGE_LIMIT_MAX: Record<string, number> = {
	'person.search': 1000,
	'company.search': 1000,
	'job.search': 1000,
	'socialPost.search': 1000,
};

function pageLimitFor(resource: string, operation: string): number {
	const max = PAGE_LIMIT_MAX[`${resource}.${operation}`];
	if (max === undefined) {
		throw new Error(`pagination: no PAGE_LIMIT_MAX entry for ${resource}.${operation}`);
	}
	return max;
}

/**
 * Emits one item per page, each the whole envelope, so `total_count` and the cursor survive
 * paging; flattening is Split Out's job. Split Results Into Items is therefore hidden while
 * this is on, because it would strip the key the loop reads to find the next page and paging
 * would stop after page one with no error.
 *
 * **The budget is results, not pages, because search bills per result.** A page cap lets one
 * toggle spend an amount the operator cannot read off the form.
 */
export function paginationProperties(
	resource: string,
	operation: string,
	alsoShowWhen: Record<string, unknown[]> = {},
): INodeProperties[] {
	const pageLimitMax = pageLimitFor(resource, operation);
	const show = { resource: [resource], operation: [operation], ...alsoShowWhen };
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			hint: 'Each page arrives as its own item carrying the full envelope. Use a Split Out node on the results array to flatten them.',
			displayOptions: { show },
			routing: { send: { paginate: '={{ $value }}' } },
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: { minValue: 1, maxValue: pageLimitMax },
			description: 'Max number of results to return',
			displayOptions: { show: { ...show, returnAll: [false] } },
			routing: { send: { type: 'body', property: 'limit' } },
		},
		{
			displayName: 'Max Results',
			name: 'maxResults',
			type: 'number',
			default: 1000,
			typeOptions: { minValue: 1 },
			description:
				'Stop once this many results have been collected. This endpoint bills per result, so this is the spend ceiling as well as the size one.',
			displayOptions: { show: { ...show, returnAll: [true] } },
		},
		{
			displayName: 'Page Size',
			name: 'pageSize',
			type: 'number',
			default: pageLimitMax,
			typeOptions: { minValue: 1, maxValue: pageLimitMax },
			description:
				'Results per request. The endpoint maximum means the fewest round trips; lowering it costs no extra credits, only more calls against the rate limit.',
			displayOptions: { show: { ...show, returnAll: [true] } },
		},
	];
}

const cursorOf = (page: INodeExecutionData[]): string | undefined => {
	const json = page[page.length - 1]?.json as IDataObject | undefined;
	const cursor = json?.[CURSOR_KEY];
	return typeof cursor === 'string' && cursor !== '' ? cursor : undefined;
};

const countOf = (page: INodeExecutionData[]): number =>
	page.reduce((n, item) => n + (resultArray(item.json)?.length ?? 0), 0);

/**
 * Dataset-agnostic: `cursor` in, `next_cursor` out, which every paged Crustdata search shares.
 * Registered once on the node, and runs only where a Return All property set `paginate`.
 */
export function cursorPagination() {
	return async function paginate(
		this: IExecutePaginationFunctions,
		requestData: DeclarativeRestApiSettings.ResultOptions,
	): Promise<INodeExecutionData[]> {
		const pageLimitMax = pageLimitFor(
			this.getNodeParameter('resource', '') as string,
			this.getNodeParameter('operation', '') as string,
		);
		const maxResults = this.getNodeParameter('maxResults', 1000) as number;
		const pageSize = Math.min(this.getNodeParameter('pageSize', pageLimitMax) as number, pageLimitMax);
		const body = (requestData.options.body ?? {}) as IDataObject;
		requestData.options.body = body;

		const items: INodeExecutionData[] = [];
		const seen = new Set<string>();
		let collected = 0;

		while (collected < maxResults) {
			// Never overshoot the budget on the last page: an extra result is an extra charge.
			body.limit = Math.min(pageSize, maxResults - collected);

			const received = await this.makeRoutingRequest(requestData);
			items.push(...received);

			// No rows means the budget cannot advance, so it cannot bind either: the next
			// page would ask for the full size again, forever.
			const rows = countOf(received);
			if (rows === 0) break;
			collected += rows;

			const cursor = cursorOf(received);
			// A cursor that repeats would loop forever; the API echoing one is likelier
			// than it being a real next page.
			if (!cursor || seen.has(cursor)) break;
			seen.add(cursor);
			body.cursor = cursor;
		}

		return items;
	};
}
