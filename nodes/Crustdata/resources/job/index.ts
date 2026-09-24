import { NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';
import { assertKnown } from '../../diagnostics';
import { fieldsProperty } from '../../fields';
import { JOB_AGGREGATION_FIELDS } from '../../filter-fields.generated';
import { FILTERS_OPTIONAL, filtersProperties, sendFilters } from '../../filters';
import { paginationProperties } from '../../pagination';
import { splitProperty } from '../../response';
import { sendSorts, sortProperties } from '../../sort';
import { usageProperty } from '../../usage';
import { validateFields } from '../validate-fields';

const showOnlyForJobSearch = { operation: ['search'], resource: ['job'] };

/** Sorting and paging are meaningless with no rows, and Return All would undo the limit. */
const withRows = { aggregationsOnly: [false] };

export const jobDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['job'] } },
		options: [
			{
				name: 'Search',
				value: 'search',
				action: 'Search job postings',
				description:
					'Find job postings matching a set of conditions, and count them by company, title, industry or location',
				routing: {
					request: { method: 'POST', url: '/job/search' },
					// Filters are never required here: the endpoint marks nothing required, and a
					// filterless call is how you count the whole dataset.
					send: { preSend: [sendFilters(FILTERS_OPTIONAL), sendSorts, sendAggregations, validateFields] },
				},
			},
		],
		default: 'search',
	},
	...filtersProperties('job', 'search'),
	sortProperties('job', 'search', withRows),
	...paginationProperties('job', 'search', withRows),
	fieldsProperty('job', 'search'),
	{
		displayName: 'Aggregations',
		name: 'aggregations',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Aggregation',
		default: {},
		description:
			'Counts computed over everything the filters match, not just the page you asked for. Group By buckets them by a column; Count is the plain total.',
		displayOptions: { show: showOnlyForJobSearch },
		options: [
			{
				name: 'aggregation',
				displayName: 'Aggregation',
				values: [
					{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						default: 'group_by',
						description: 'What to compute',
						options: [
							{ name: 'Count', value: 'count', description: 'How many postings match in total' },
							{
								name: 'Group By',
								value: 'group_by',
								description: 'How many match in each bucket of a column',
							},
						],
					},
					{
						displayName: 'Field Name or ID',
						name: 'field',
						type: 'options',
						default: '',
						description:
							'Column to bucket by. Required for Group By and ignored by Count. Far fewer columns can be grouped than filtered. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
						typeOptions: { loadOptionsMethod: 'getAggregationFields' },
					},
					{
						displayName: 'Size',
						name: 'size',
						type: 'number',
						default: 100,
						typeOptions: { minValue: 1, maxValue: 1000 },
						description: 'Maximum number of buckets to return. Group By only.',
					},
				],
			},
		],
	},
	{
		displayName: 'Aggregations Only',
		name: 'aggregationsOnly',
		type: 'boolean',
		default: false,
		description:
			'Whether to return the counts alone, with no job rows. Sends limit 0, and this endpoint bills per result, so a count with no rows is the cheap way to size a market before paying to read it.',
		displayOptions: { show: showOnlyForJobSearch },
	},
	splitProperty('job', 'search', { returnAll: [true] }),
	usageProperty('job', 'search'),
];

type AggregationRow = { type?: string; field?: string; size?: number };

/**
 * `aggregations` runs over the whole match rather than the page, so it answers "how many"
 * without paying to read the rows. `agg` is set here rather than offered: the schema requires
 * it for `group_by` and `count` is the only value the API accepts, so a dropdown would have
 * exactly one option.
 */
export async function sendAggregations(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const rows = (this.getNodeParameter('aggregations.aggregation', []) ?? []) as AggregationRow[];
	const body: IDataObject = { ...((requestOptions.body ?? {}) as IDataObject) };
	const aggregations: IDataObject[] = [];

	for (const row of Array.isArray(rows) ? rows : []) {
		if (!row?.type) continue;
		if (row.type === 'count') {
			// `field` is not just unused for count, it is refused, so an inherited row value
			// must not be carried over.
			aggregations.push({ type: 'count' });
			continue;
		}
		if (!row.field) {
			throw new NodeOperationError(this.getNode(), 'A Group By aggregation needs a Field', {
				description: 'Pick the column to bucket by, or switch the Type to Count for a plain total.',
			});
		}
		aggregations.push({ type: 'group_by', field: row.field, agg: 'count', size: row.size ?? 100 });
	}

	if (aggregations.length) {
		// Groupable is a much smaller set than filterable, so a column that works in Conditions
		// is usually not one the API will bucket by.
		assertKnown(
			this.getNode(),
			aggregations.map((a) => a.field).filter(Boolean) as string[],
			JOB_AGGREGATION_FIELDS,
			'Aggregations',
		);
		body.aggregations = aggregations;
	}

	if (this.getNodeParameter('aggregationsOnly', false)) {
		if (aggregations.length === 0) {
			throw new NodeOperationError(
				this.getNode(),
				'Aggregations Only is on, but no aggregation is defined',
				{ description: 'Add an Aggregation, or turn this off to return job rows instead.' },
			);
		}
		// After the declarative Limit, which n8n applies before any preSend.
		body.limit = 0;
	}

	requestOptions.body = body;
	return requestOptions;
}
