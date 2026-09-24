import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';
import { NEXT_STEP_HINTS } from './hints';
import {
	getAggregationFields,
	getFieldOptions,
	getFilterFields,
	getSortableFields,
	searchFilterValues,
} from './options';
import { cursorPagination } from './pagination';
import { accountDescription } from './resources/account';
import { batchDescription } from './resources/batch';
import { discoverDescription } from './resources/discover';
import { jobDescription } from './resources/job';
import { socialPostDescription } from './resources/social-post';
import { rawDescription } from './resources/raw';
import { companyDescription } from './resources/company';
import { personDescription } from './resources/person';
import { watchDescription } from './resources/watch';
import { webDescription } from './resources/web';

export class Crustdata implements INodeType {
	// Long lists load on demand so they stay out of the description an agent
	// reads.
	methods = {
		loadOptions: { getFilterFields, getFieldOptions, getSortableFields, getAggregationFields },
		listSearch: { searchFilterValues },
	};

	description: INodeTypeDescription = {
		displayName: 'Crustdata',
		name: 'crustdata',
		// The mark is brand indigo with no white or black, so one file reads on both
		// canvases; a themed pair would be two copies of the same artwork.
		// eslint-disable-next-line @n8n/community-nodes/icon-prefer-themed-variants
		icon: 'file:crustdata.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Search and enrich 800M+ people and 200M+ companies, and search or fetch the live web. Start with Discover, which lists every filterable column and costs nothing.',
		defaults: {
			name: 'Crustdata',
		},
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Use for people and company data: find them by attribute, resolve a messy name or domain to a record, or add emails and phone numbers. Web Search and Web Fetch cover what the datasets do not. Discover lists the filterable columns for free.',
			relatedNodes: [
				{
					nodeType: 'n8n-nodes-base.aggregate',
					relationHint:
						'Every identifier operation takes up to 25 per call, so aggregating rows first spends one call instead of one per row',
				},
				{
					nodeType: 'n8n-nodes-base.splitInBatches',
					relationHint:
						'Past 25 rows, batch them at 25 and aggregate inside the loop; one call takes at most 25 values',
				},
				{
					nodeType: 'n8n-nodes-base.splitOut',
					relationHint:
						'Search returns one item holding the results array plus total_count and next_cursor; split it to get one item per result',
				},
			],
		},
		hints: NEXT_STEP_HINTS,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'crustdataApi',
				required: true,
			},
		],
		// Runs only where a Return All property set `paginate`, so it is inert elsewhere.
		requestOperations: { pagination: cursorPagination() },
		requestDefaults: {
			baseURL: 'https://api.crustdata.com',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Account',
						value: 'account',
					},
					{
						name: 'Batch',
						value: 'batch',
					},
					{
						name: 'Company',
						value: 'company',
					},
					{
						name: 'Discover',
						value: 'discover',
					},
					{
						name: 'Job',
						value: 'job',
					},
					{
						name: 'Person',
						value: 'person',
					},
					{
						name: 'Raw',
						value: 'raw',
					},
					{
						name: 'Social Post',
						value: 'socialPost',
					},
					{
						name: 'Watch',
						value: 'watch',
					},
					{
						name: 'Web',
						value: 'web',
					},
				],
				default: 'person',
			},
			...accountDescription,
			...batchDescription,
			...discoverDescription,
			...jobDescription,
			...companyDescription,
			...personDescription,
			...rawDescription,
			...socialPostDescription,
			...watchDescription,
			...webDescription,
		],
	};
}
