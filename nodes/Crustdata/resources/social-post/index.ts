import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';
import { fieldsProperty } from '../../fields';
import { FILTERS_OPTIONAL, filtersProperties, sendFilters } from '../../filters';
import { paginationProperties } from '../../pagination';
import { splitProperty } from '../../response';
import { sendSorts, sortProperties } from '../../sort';
import { usageProperty } from '../../usage';
import { validateFields } from '../validate-fields';

const showOnlyForSocialPostSearch = { operation: ['search'], resource: ['socialPost'] };

/** Sorting and paging have nothing to act on when the request asks for no rows. */
const withRows = { countOnly: [false] };

export const socialPostDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['socialPost'] } },
		options: [
			{
				name: 'Search',
				value: 'search',
				action: 'Search social posts',
				description:
					'Search the indexed post dataset by the post, its author, engagement, reactors, commenters, mentions and attachments',
				routing: {
					request: { method: 'POST', url: '/social_post/search' },
					// Nothing is required here, so a filterless call is legitimate — with Count
					// Only it is how you size the whole dataset for free.
					send: { preSend: [sendFilters(FILTERS_OPTIONAL), sendSorts, sendCountOnly, validateFields] },
				},
			},
		],
		default: 'search',
	},
	{
		displayName:
			'This dataset is enabled per account. A 403 here is an entitlement rather than a bad request — ask for access rather than reshaping the query.',
		name: 'entitlementNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: showOnlyForSocialPostSearch },
	},
	...filtersProperties('socialPost', 'search'),
	sortProperties('socialPost', 'search', withRows),
	...paginationProperties('socialPost', 'search', withRows),
	fieldsProperty('socialPost', 'search'),
	{
		displayName: 'Count Only',
		name: 'countOnly',
		type: 'boolean',
		default: false,
		description:
			'Whether to return total_count alone, with no posts. Sends limit 0, which this endpoint serves for free — so counting how many posts match costs nothing, while reading them is billed per post.',
		displayOptions: { show: showOnlyForSocialPostSearch },
	},
	// Nothing to split when the answer is a count, and nothing to split per page under
	// Return All either.
	splitProperty('socialPost', 'search', { returnAll: [true], countOnly: [true] }),
	usageProperty('socialPost', 'search'),
];

/**
 * `limit: 0` is the API's own "count, do not return rows", and it is free where every
 * returned post is billed. Sent from a preSend because n8n applies the declarative Limit
 * first and this has to win.
 */
export async function sendCountOnly(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	if (!this.getNodeParameter('countOnly', false)) return requestOptions;
	requestOptions.body = { ...((requestOptions.body ?? {}) as IDataObject), limit: 0 };
	return requestOptions;
}
