import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteSingleFunctions, IHttpRequestOptions, INodeProperties } from 'n8n-workflow';
import { splitArrayRoot, splitProperty } from '../../response';
import { usageProperty } from '../../usage';

const showOnlyForWeb = { resource: ['web'] };
const showOnlyForWebSearch = { resource: ['web'], operation: ['search'] };
const showOnlyForWebFetch = { resource: ['web'], operation: ['fetch'] };

/** Spec-declared caps. Above either the API answers 400 rather than truncating. */
const MAX_PAGES = 15;
const MAX_URLS = 10;

/**
 * In the spec's `sources` enum but not offered: `social` answers 200 with zero rows for any
 * query, so it would be a control that silently returns nothing, and the two scholar-article
 * values answer 500. A test pins this against the spec's list, so an upstream fix surfaces.
 */
export const EXCLUDED_SOURCES = ['scholar-articles', 'scholar-articles-enriched', 'social'] as const;

export const SOURCE_OPTIONS = [
	{ name: 'AI', value: 'ai' },
	{ name: 'News', value: 'news' },
	{ name: 'Scholar Author', value: 'scholar-author' },
	{ name: 'Web', value: 'web' },
];

export const webDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showOnlyForWeb },
		options: [
			{
				name: 'Fetch',
				value: 'fetch',
				action: 'Fetch webpages',
				description:
					'Retrieve the title and HTML of up to 10 URLs, logged out. One credit per URL, including URLs that fail. Rate limited to 10 requests a minute.',
				routing: {
					request: { method: 'POST', url: '/web/enrich/live' },
					output: { postReceive: [splitArrayRoot] },
				},
			},
			{
				name: 'Search',
				value: 'search',
				action: 'Search the web',
				description:
					'Query web, news, scholar and AI sources. One credit per page that returns results. Rate limited to 10 requests a minute.',
				routing: {
					request: { method: 'POST', url: '/web/search/live' },
					send: { preSend: [assertPageSources] },
				},
			},
		],
		default: 'search',
	},
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. ADAMSBROWN, LLC website',
		description:
			'What to search for. Standard operators such as site: and filetype: work. A company name followed by "website" is the usual way to resolve a name to a domain.',
		displayOptions: { show: showOnlyForWebSearch },
		routing: { send: { type: 'body', property: 'query' } },
	},
	{
		displayName: 'Sources',
		name: 'sources',
		type: 'multiOptions',
		default: [],
		description:
			'Which sources to query. Leave empty to search all of them, which is also the only way to combine sources with Pages above 1.',
		displayOptions: { show: showOnlyForWebSearch },
		options: SOURCE_OPTIONS,
		routing: {
			send: { type: 'body', property: 'sources', value: '={{ $value.length ? $value : undefined }}' },
		},
	},
	{
		displayName: 'Site',
		name: 'site',
		type: 'string',
		default: '',
		placeholder: 'e.g. linkedin.com/company',
		description:
			'Restrict results to one site. linkedin.com/company resolves a company name to its profile URL, and a social site is reached this way rather than through Sources.',
		displayOptions: { show: showOnlyForWebSearch },
		routing: { send: { type: 'body', property: 'site', value: '={{ $value || undefined }}' } },
	},
	{
		displayName: 'Location',
		name: 'location',
		type: 'string',
		default: '',
		placeholder: 'e.g. US',
		description:
			'Country to target results at, as an ISO 3166-1 alpha-2 code. Two letters, unlike the three-letter codes the filter columns take.',
		displayOptions: { show: showOnlyForWebSearch },
		routing: { send: { type: 'body', property: 'location', value: '={{ $value || undefined }}' } },
	},
	{
		displayName: 'Published After',
		name: 'startDate',
		type: 'dateTime',
		default: '',
		description: 'Only return results published after this',
		displayOptions: { show: showOnlyForWebSearch },
		routing: {
			send: {
				type: 'body',
				property: 'start_date',
				// The API takes unix seconds; n8n's date picker hands over an ISO string.
				value: '={{ $value ? Math.floor(new Date($value).getTime() / 1000) : undefined }}',
			},
		},
	},
	{
		displayName: 'Published Before',
		name: 'endDate',
		type: 'dateTime',
		default: '',
		description: 'Only return results published before this',
		displayOptions: { show: showOnlyForWebSearch },
		routing: {
			send: {
				type: 'body',
				property: 'end_date',
				value: '={{ $value ? Math.floor(new Date($value).getTime() / 1000) : undefined }}',
			},
		},
	},
	{
		displayName: 'Pages',
		name: 'pages',
		type: 'number',
		default: 1,
		typeOptions: { minValue: 1, maxValue: MAX_PAGES },
		description: 'How many result pages to aggregate into one response. Each page is a credit.',
		hint: 'Above 1, pick either one source or none at all.',
		displayOptions: { show: showOnlyForWebSearch },
		routing: { send: { type: 'body', property: 'page' } },
	},
	{
		displayName: 'URLs',
		name: 'urls',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com',
		description: `URLs to fetch, comma-separated. Each needs its http:// or https:// prefix. Maximum ${MAX_URLS} per call.`,
		hint: 'A URL that fails comes back with success false and still costs its credit.',
		displayOptions: { show: showOnlyForWebFetch },
		routing: {
			send: {
				type: 'body',
				property: 'urls',
				value: '={{ $value.split(",").map(s => s.trim()).filter(Boolean) }}',
			},
		},
	},
	{
		displayName: 'Human Mode',
		name: 'humanMode',
		type: 'boolean',
		default: false,
		description:
			'Whether to fall back to a browser-like retrieval path when standard access is blocked. Slower, and it is what gets past Cloudflare.',
		displayOptions: { show: showOnlyForWeb },
		routing: { send: { type: 'body', property: 'human_mode' } },
	},
	splitProperty('web', 'search'),
	usageProperty('web', 'search'),
	usageProperty('web', 'fetch'),
];

/**
 * Pages merge within one source only. Sending NONE is accepted and searches them all, which
 * the API's own 400 ("requires exactly one source") denies, so only two or more is refused.
 */
export async function assertPageSources(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const body = (requestOptions.body ?? {}) as { page?: number; sources?: string[] };
	const pages = Number(body.page ?? 1);
	const sources = body.sources ?? [];
	if (pages > 1 && sources.length > 1) {
		throw new NodeOperationError(
			this.getNode(),
			`Pages is ${pages}, which allows at most one source, but ${sources.length} are selected.`,
			{ description: 'Pick a single source, clear Sources to search them all, or set Pages back to 1.' },
		);
	}
	return requestOptions;
}
