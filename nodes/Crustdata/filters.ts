import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteSingleFunctions, IHttpRequestOptions, INodeProperties } from 'n8n-workflow';
import {
	COMPANY_FILTER_FIELDS,
	FILTER_COMBINATORS,
	FILTER_OPERATORS,
	OPERATOR_TO_API,
	PERSON_FILTER_FIELDS,
} from './filter-fields.generated';
import { assertKnown } from './diagnostics';
import { assertGeoFormat } from './geo-formats';

const FILTERABLE: Record<string, readonly string[]> = {
	person: PERSON_FILTER_FIELDS,
	company: COMPANY_FILTER_FIELDS,
};

export function filtersProperties(resource: string, operation: string): INodeProperties[] {
	const show = { resource: [resource], operation: [operation] };

	return [
		{
			displayName: 'Combine Conditions With',
			name: 'combinator',
			type: 'options',
			default: 'and',
			description:
				'How to join the conditions below. ALL OF matches across elements of a nested array, where AND would require one element to satisfy everything.',
			displayOptions: { show },
			options: FILTER_COMBINATORS,
		},
		{
			displayName: 'Conditions',
			name: 'filters',
			type: 'fixedCollection',
			typeOptions: { multipleValues: true, sortable: true },
			placeholder: 'Add Condition',
			default: {},
			displayOptions: { show },
			options: [
				{
					name: 'condition',
					displayName: 'Condition',
					values: [
						{
							displayName: 'Field Name or ID',
							name: 'field',
							type: 'options',
							default: '',
							description: 'Column to filter on. Only indexed columns are filterable. Loaded for the selected resource. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
							typeOptions: { loadOptionsMethod: 'getFilterFields' },
						},
						{
							displayName: 'Operator',
							name: 'operator',
							type: 'options',
							default: 'eq',
							description: 'Comparison to apply',
							options: FILTER_OPERATORS,
						},
						{
							displayName: 'Value',
							name: 'value',
							type: 'resourceLocator',
							default: { mode: 'text', value: '' },
							description:
								'Value to compare against. For "in" and "has all", give a comma-separated list. Leave empty for the "is empty" operators.',
							modes: [
								{
									displayName: 'From List',
									name: 'list',
									type: 'list',
									placeholder: 'Start typing to see real values',
									typeOptions: {
										searchListMethod: 'searchFilterValues',
										searchable: true,
										// The query is the autocomplete's whole input; without this the
										// dropdown opens by asking for values matching nothing.
										searchFilterRequired: true,
										slowLoadNotice: {
											message:
												'Only some columns carry autocomplete. If nothing arrives, switch to Text and type the value.',
											timeout: 8000,
										},
									},
								},
								{
									displayName: 'Text',
									name: 'text',
									type: 'string',
									placeholder: 'Any value, or an expression',
								},
							],
						},
					],
				},
			],
		},
		{
			displayName: 'Advanced Filter (JSON)',
			name: 'filtersJson',
			type: 'json',
			default: '',
			description:
				'Nested condition groups, which the rows above cannot express. Overrides them when set, and its column names are sent unchecked: the pre-dispatch validation only covers the rows.',
			displayOptions: { show },
		},
	];
}

type ConditionRow = {
	field: string;
	operator: string;
	/** A resourceLocator, or a plain string from an older saved workflow. */
	value: string | { mode?: string; value?: string };
};

const plain = (v: ConditionRow['value']): string =>
	typeof v === 'object' && v !== null ? String(v.value ?? '') : String(v ?? '');

export function buildFilters(combinator: string, rows: ConditionRow[]) {
	const LIST_OPS = new Set(['in', 'not_in', 'has_all']);
	const conditions: Array<{ field: string; type: string; value: string | string[] }> = [];

	for (const r of rows) {
		if (!r?.field) continue;
		// Aliases, not raw tokens: n8n reads a leading `=` as an expression, so `=`,
		// `=>` and `=<` come back empty.
		const type = OPERATOR_TO_API[r.operator] ?? r.operator;
		if (LIST_OPS.has(type)) {
			const value = plain(r.value)
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			// The API rejects an empty list, so an unfilled row is no filter at all.
			if (value.length) conditions.push({ field: r.field, type, value });
			continue;
		}
		conditions.push({ field: r.field, type, value: plain(r.value) });
	}

	if (conditions.length === 0) return undefined;
	// A lone condition is valid on its own; the API takes a condition or a group.
	if (conditions.length === 1 && combinator !== 'all_of') return conditions[0];
	return { op: combinator, conditions };
}

/**
 * `optionalWhen` names a parameter that makes filters optional: company search accepts a
 * natural-language query instead, and the spec marks filters required only when that is absent.
 * `FILTERS_OPTIONAL` means never required, which is job search. Everywhere else an empty build
 * is caught here rather than relayed as a 400 that names nothing.
 */
/** Leaf conditions out of a built filter tree, so a guard sees every nested group too. */
function leaves(filters: unknown): Array<{ field?: string; value?: unknown }> {
	if (!filters || typeof filters !== 'object') return [];
	const node = filters as { conditions?: unknown[]; field?: string; value?: unknown };
	if (Array.isArray(node.conditions)) return node.conditions.flatMap(leaves);
	return node.field ? [node] : [];
}

export const FILTERS_OPTIONAL = true as const;

export function sendFilters(optionalWhen?: string | typeof FILTERS_OPTIONAL) {
	return async function assembleFilters(
		this: IExecuteSingleFunctions,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const raw = this.getNodeParameter('filtersJson', '') as string;
		const rows = (this.getNodeParameter('filters.condition', []) ?? []) as ConditionRow[];
		const combinator = this.getNodeParameter('combinator', 'and') as string;

		let filters: unknown;
		if (raw?.trim()) {
			try {
				filters = JSON.parse(raw);
			} catch (error) {
				throw new NodeOperationError(
					this.getNode(),
					`Advanced Filter (JSON) is not valid JSON: ${(error as Error).message}`,
					{ description: 'Leave it empty to use the Conditions rows instead.' },
				);
			}
		} else {
			const list = Array.isArray(rows) ? rows : [];
			// The picker cannot produce an unknown column, but an expression can, and so can
			// a model driving this node as a tool.
			assertKnown(
				this.getNode(),
				list.map((r) => r?.field).filter(Boolean),
				FILTERABLE[this.getNodeParameter('resource', '') as string] ?? [],
				'Conditions',
			);
			filters = buildFilters(combinator, list);
			assertGeoFormat(this.getNode(), leaves(filters));
		}

		if (filters === undefined || filters === null) {
			// Job search marks nothing required, so a filterless call is a legitimate request
			// rather than a mistake — it is how you count the whole dataset.
			if (optionalWhen === FILTERS_OPTIONAL) return requestOptions;
			const alternative = optionalWhen ? (this.getNodeParameter(optionalWhen, '') as string) : '';
			if (alternative?.trim()) return requestOptions;
			throw new NodeOperationError(this.getNode(), 'This search needs at least one filter', {
				description: optionalWhen
					? 'Add a Condition with a Field selected, supply Advanced Filter (JSON), or describe what you want in Query. A row with no Field is ignored.'
					: 'Add a Condition with a Field selected, or supply Advanced Filter (JSON). A row with no Field is ignored.',
			});
		}

		requestOptions.body = { ...(requestOptions.body as object), filters };
		return requestOptions;
	};
}
