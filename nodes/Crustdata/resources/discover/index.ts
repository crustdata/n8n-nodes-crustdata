import type {
	IDataObject,
	IExecuteSingleFunctions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import {
	COMPANY_FILTER_FIELDS,
	COMPANY_SORTABLE_FIELDS,
	JOB_FILTER_FIELDS,
	JOB_SORTABLE_FIELDS,
	SOCIALPOST_FILTER_FIELDS,
	SOCIALPOST_SORTABLE_FIELDS,
	FILTER_COMBINATORS,
	FILTER_OPERATORS,
	FIELD_VOCABULARY,
	OPERATOR_TO_API,
	PERSON_FILTER_FIELDS,
	PERSON_SORTABLE_FIELDS,
	SYNC_ENDPOINTS,
} from '../../filter-fields.generated';

const showOnlyForDiscover = { resource: ['discover'], operation: ['describe'] };

const FILTERABLE: Record<string, string[]> = {
	person: PERSON_FILTER_FIELDS,
	company: COMPANY_FILTER_FIELDS,
	job: JOB_FILTER_FIELDS,
	socialPost: SOCIALPOST_FILTER_FIELDS,
};

const SORTABLE: Record<string, string[]> = {
	person: PERSON_SORTABLE_FIELDS,
	company: COMPANY_SORTABLE_FIELDS,
	job: JOB_SORTABLE_FIELDS,
	socialPost: SOCIALPOST_SORTABLE_FIELDS,
};

export const discoverDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['discover'] } },
		options: [
			{
				name: 'Describe',
				value: 'describe',
				// n8n builds a tool description from the ACTION, not this operation's
				// description, so the free-of-charge part has to be in here to reach a model.
				action: 'Describe what this node can do for free',
				description:
					'List the operations, and the columns each one can filter, sort and return. Costs no credits.',
				routing: {
					// A declarative operation must dispatch something, so it dispatches the call
					// that answers the other half of the question: /account/endpoints is free and
					// carries this account's own prices, which are per account and not in the spec.
					request: { method: 'GET', url: '/account/endpoints' },
					output: { postReceive: [describe] },
				},
			},
		],
		default: 'describe',
	},
	{
		displayName: 'Detail',
		name: 'detail',
		type: 'options',
		default: 'summary',
		description: 'How much to return. Detailed needs a resource and lists every column.',
		displayOptions: { show: showOnlyForDiscover },
		options: [
			{ name: 'Summary', value: 'summary' },
			{ name: 'Detailed', value: 'detailed' },
		],
	},
	{
		displayName: 'For Resource',
		name: 'forResource',
		type: 'options',
		default: 'person',
		description: 'Which resource to describe in full',
		displayOptions: { show: { ...showOnlyForDiscover, detail: ['detailed'] } },
		options: [
			{ name: 'Company', value: 'company' },
			{ name: 'Job', value: 'job' },
			{ name: 'Person', value: 'person' },
			{ name: 'Social Post', value: 'socialPost' },
		],
	},
];

/**
 * Reads the same constants the pickers do, so it cannot drift from what they offer. It exists
 * for the agent case: a model can read the exact column names instead of guessing one and
 * paying for the 400 that follows.
 */
export async function describe(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const detail = this.getNodeParameter('detail', 'summary') as string;

	const operations = Object.keys(FIELD_VOCABULARY)
		// The operations that carry no `fields` vocabulary, so FIELD_VOCABULARY misses them.
		// The drift test compares this whole list against what the node registers.
		.concat([
			'account.credits',
			'account.endpoints',
			'account.usageSummary',
			'account.usageEvents',
			'account.usageErrors',
			'account.usageEvent',
			'batch.submit',
			'batch.get',
			'batch.list',
			'raw.request',
			'discover.describe',
			'watch.list',
			'watch.get',
			'watch.update',
			'watch.cancel',
			'watch.preview',
			'watch.test',
			'watch.getRuns',
			'watch.getRun',
			'web.search',
			'web.fetch',
		])
		.sort();

	const discover: IDataObject =
		detail === 'detailed'
			? detailed(this.getNodeParameter('forResource', 'person') as string)
			: {
					operations,
					filterable_columns: countsOf(FILTERABLE),
					sortable_columns: countsOf(SORTABLE),
					returnable_paths: Object.fromEntries(
						Object.entries(FIELD_VOCABULARY).map(([k, v]) => [k, v.length]),
					),
					raw_endpoints: SYNC_ENDPOINTS.length,
					hint: 'Set Detail to Detailed for the column names and this resource\u2019s prices.',
				};

	const resource = detail === 'detailed' ? (this.getNodeParameter('forResource', 'person') as string) : undefined;
	return [{ ...items[0], json: { discover, pricing: pricing(response?.body as IDataObject, resource) } }];
}

/** The path a resource's endpoints start with; only socialPost differs from its own name. */
const pathPrefix = (resource: string): string => `/${resource === 'socialPost' ? 'social_post' : resource}`;

/**
 * This account's prices and limits, from the carrier call. Only the premium entries that
 * actually charge: most are zero, and listing them all buries the few that cost something.
 */
function pricing(body: IDataObject | undefined, resource?: string): IDataObject {
	const endpoints = Array.isArray(body?.endpoints) ? (body.endpoints as IDataObject[]) : [];
	const charged = (list: unknown): IDataObject[] =>
		(Array.isArray(list) ? (list as IDataObject[]) : []).filter((f) => Number(f.credits) > 0);

	const out: IDataObject = {};
	for (const endpoint of endpoints) {
		const path = String(endpoint.path ?? '');
		if (resource && !path.startsWith(pathPrefix(resource))) continue;
		const filters = charged(endpoint.premium_filters);
		const fields = charged(endpoint.premium_fields);
		out[path] = {
			base_credits: endpoint.base_credits,
			rate_limit_rpm: endpoint.effective_rate_limit_rpm,
			...(filters.length ? { premium_filters: filters } : {}),
			...(fields.length ? { premium_fields: fields } : {}),
		};
	}
	return out;
}

const own = (m: Record<string, string[]>, key: string): string[] =>
	Object.prototype.hasOwnProperty.call(m, key) ? m[key] : [];

const countsOf = (m: Record<string, string[]>): IDataObject =>
	Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.length]));

function detailed(resource: string): IDataObject {
	return {
		resource,
		// An own-property check, not `??`: an inherited member (constructor, toString) is
		// not nullish, so `??` handed it straight back as the column list.
		filterable_columns: own(FILTERABLE, resource),
		sortable_columns: own(SORTABLE, resource),
		returnable_by_operation: Object.fromEntries(
			Object.entries(FIELD_VOCABULARY).filter(([k]) => k.startsWith(`${resource}.`)),
		),
		operators: FILTER_OPERATORS.map((o) => ({ label: o.name, value: o.value, sends: OPERATOR_TO_API[o.value as string] })),
		combinators: FILTER_COMBINATORS.map((c) => c.value),
	};
}
