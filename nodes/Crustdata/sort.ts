import { assertKnown } from './diagnostics';
import { COMPANY_SORTABLE_FIELDS, PERSON_SORTABLE_FIELDS } from './filter-fields.generated';
import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

/**
 * The sortable set is a strict subset of the filterable one and is generated from each
 * endpoint's own `sorts` schema, so a column you can filter on is not necessarily one you
 * can order by. Picking from the wrong list is a 400 the node can prevent.
 */
export function sortProperties(
	resource: string,
	operation: string,
	alsoShowWhen: Record<string, unknown[]> = {},
): INodeProperties {
	return {
		displayName: 'Sort',
		name: 'sorts',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Sort',
		default: {},
		description: 'Order the results. Directives apply in the order listed.',
		displayOptions: { show: { resource: [resource], operation: [operation], ...alsoShowWhen } },
		options: [
			{
				name: 'sort',
				displayName: 'Sort',
				values: [
					{
						displayName: 'Field Name or ID',
						name: 'field',
						type: 'options',
						default: '',
						description:
							'Column to order by. Only sortable columns are listed, which is fewer than the filterable ones. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
						typeOptions: { loadOptionsMethod: 'getSortableFields' },
					},
					{
						displayName: 'Order',
						name: 'order',
						type: 'options',
						default: 'asc',
						description: 'Direction to sort in',
						options: [
							{ name: 'Ascending', value: 'asc' },
							{ name: 'Descending', value: 'desc' },
						],
					},
				],
			},
		],
	};
}

const SORTABLE: Record<string, readonly string[]> = {
	person: PERSON_SORTABLE_FIELDS,
	company: COMPANY_SORTABLE_FIELDS,
};

type SortRow = { field?: string; order?: string };

export function buildSorts(rows: SortRow[]): Array<{ field: string; order: string }> {
	return rows
		.filter((r): r is { field: string; order?: string } => Boolean(r?.field))
		.map((r) => ({ field: r.field, order: r.order ?? 'asc' }));
}

/** Omitted rather than sent empty: the API defaults its own ordering when `sorts` is absent. */
export async function sendSorts(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const rows = (this.getNodeParameter('sorts.sort', []) ?? []) as SortRow[];
	const sorts = buildSorts(Array.isArray(rows) ? rows : []);
	if (sorts.length === 0) return requestOptions;

	// Sortable is a strict subset of filterable, so a column that works in Conditions is
	// not necessarily one the API will order by.
	assertKnown(
		this.getNode(),
		sorts.map((s) => s.field),
		SORTABLE[this.getNodeParameter('resource', '') as string] ?? [],
		'Sort',
	);

	requestOptions.body = { ...((requestOptions.body ?? {}) as IDataObject), sorts };
	return requestOptions;
}
