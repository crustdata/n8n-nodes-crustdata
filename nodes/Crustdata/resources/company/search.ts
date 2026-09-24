import type { IDataObject, IExecuteSingleFunctions, IHttpRequestOptions, INodeProperties } from 'n8n-workflow';
import { fieldsProperty } from '../../fields';
import { filtersProperties } from '../../filters';
import { paginationProperties } from '../../pagination';
import { splitProperty } from '../../response';
import { sortProperties } from '../../sort';
import { usageProperty } from '../../usage';

const showOnlyForCompanySearch = {
	operation: ['search'],
	resource: ['company'],
};

/**
 * Company search is two endpoints wearing one name, and the second is narrower in ways
 * that are rejections rather than preferences: with `search` set, `sorts` and `cursor`
 * are REFUSED and `limit` caps at 100, and the response's `total_count` and `next_cursor`
 * come back null. So ranked results are one relevance-ordered window; you narrow with
 * filters instead of paging.
 *
 * Hence the split below. Offering Sort or Return All beside a query would be offering a
 * guaranteed 400.
 */
const rankedMode = { ...showOnlyForCompanySearch, query: [{ _cnd: { not: '' } }] };

/** The cap once `search` is set. */
const RANKED_MAX = 100;

export const companySearchDescription: INodeProperties[] = [
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		default: '',
		placeholder: 'e.g. AI infrastructure companies building tools for model deployment',
		description:
			'Rank companies by what they do, for criteria no filter column expresses. Leave empty to search on filters alone. Ranked search is enabled per account, so a 403 here is an entitlement rather than a bad request.',
		hint: 'With a query set, results are one relevance-ordered window: sorting and paging are refused by the API, and Limit caps at 100.',
		displayOptions: { show: showOnlyForCompanySearch },
	},
	{
		displayName: 'Retrieval Mode',
		name: 'searchMode',
		type: 'options',
		default: 'hybrid',
		description: 'How to match the query',
		displayOptions: { show: rankedMode },
		options: [
			{ name: 'Hybrid (Keyword + Embedding)', value: 'hybrid' },
			{ name: 'Lexical (Keyword Only)', value: 'lexical' },
			{ name: 'Semantic (Embedding Only)', value: 'semantic' },
		],
	},
	...filtersProperties('company', 'search'),
	sortProperties('company', 'search', { query: [''] }),
	...paginationProperties('company', 'search', { query: [''] }),
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1, maxValue: RANKED_MAX },
		description: 'Max number of results to return',
		displayOptions: { show: rankedMode },
		routing: { send: { type: 'body', property: 'limit' } },
	},
	fieldsProperty('company', 'search'),
	splitProperty('company', 'search', { returnAll: [true] }),
	usageProperty('company', 'search'),
];

/**
 * `search` is sent whole or not at all. Routing the query straight to `search.query` put
 * an empty string there on a filter-only search, and the API refuses both that and a bare
 * `search: {}` — the schema requires a non-empty query.
 */
export async function sendSemanticSearch(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const query = (this.getNodeParameter('query', '') as string)?.trim();
	if (!query) return requestOptions;

	const mode = this.getNodeParameter('searchMode', 'hybrid') as string;
	const body: IDataObject = { ...((requestOptions.body ?? {}) as IDataObject), search: { query, mode } };

	// Both Limit properties are named `limit` and share one stored value, and `maxValue` is
	// an editor affordance the execution never enforces, so a 1000 set in filter mode (or
	// any expression) reaches here intact and the API refuses it.
	if (typeof body.limit === 'number' && body.limit > RANKED_MAX) body.limit = RANKED_MAX;

	requestOptions.body = body;
	return requestOptions;
}
