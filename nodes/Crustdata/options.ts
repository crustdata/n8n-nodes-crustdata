import type {
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';
import {
	COMPANY_AUTOCOMPLETE_FIELDS,
	COMPANY_FILTER_FIELDS,
	COMPANY_SORTABLE_FIELDS,
	FIELD_VOCABULARY,
	JOB_AGGREGATION_FIELDS,
	JOB_AUTOCOMPLETE_FIELDS,
	JOB_FILTER_FIELDS,
	JOB_SORTABLE_FIELDS,
	PERSON_AUTOCOMPLETE_FIELDS,
	SOCIALPOST_FILTER_FIELDS,
	SOCIALPOST_SORTABLE_FIELDS,
	PERSON_FILTER_FIELDS,
	PERSON_SORTABLE_FIELDS,
} from './filter-fields.generated';

const FILTER_FIELDS: Record<string, string[]> = {
	person: PERSON_FILTER_FIELDS,
	company: COMPANY_FILTER_FIELDS,
	job: JOB_FILTER_FIELDS,
	socialPost: SOCIALPOST_FILTER_FIELDS,
};

const SORTABLE_FIELDS: Record<string, string[]> = {
	person: PERSON_SORTABLE_FIELDS,
	company: COMPANY_SORTABLE_FIELDS,
	job: JOB_SORTABLE_FIELDS,
	socialPost: SOCIALPOST_SORTABLE_FIELDS,
};

const asOptions = (values: string[]): INodePropertyOptions[] =>
	values.map((v) => ({ name: v, value: v }));

export async function getFilterFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const resource = this.getCurrentNodeParameter('resource') as string;
	return asOptions(FILTER_FIELDS[resource] ?? []);
}

/** Keyed `resource.operation`: the four vocabularies are genuinely different sets. */
export async function getFieldOptions(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const resource = this.getCurrentNodeParameter('resource') as string;
	const operation = this.getCurrentNodeParameter('operation') as string;
	return asOptions(FIELD_VOCABULARY[`${resource}.${operation}`] ?? []);
}

export async function getSortableFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const resource = this.getCurrentNodeParameter('resource') as string;
	return asOptions(SORTABLE_FIELDS[resource] ?? []);
}

const AUTOCOMPLETE: Record<string, { url: string; fields: string[] }> = {
	person: { url: '/person/search/autocomplete', fields: PERSON_AUTOCOMPLETE_FIELDS },
	company: { url: '/company/search/autocomplete', fields: COMPANY_AUTOCOMPLETE_FIELDS },
	job: { url: '/job/search/autocomplete', fields: JOB_AUTOCOMPLETE_FIELDS },
};

export async function searchFilterValues(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const resource = this.getCurrentNodeParameter('resource') as string;
	const target = AUTOCOMPLETE[resource];
	// `&` makes the lookup relative to this collection row. Without it the path resolves
	// from the node root, where no `field` exists, and every search returned nothing.
	const field = this.getCurrentNodeParameter('&field', { extractValue: true }) as string;

	if (!target || !field || !target.fields.includes(field)) {
		return { results: [] };
	}

	const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'crustdataApi', {
		method: 'POST',
		baseURL: 'https://api.crustdata.com',
		url: target.url,
		body: { field, query: filter ?? '', limit: 25 },
		json: true,
	})) as { suggestions?: Array<{ value: string }> };

	return {
		results: (response.suggestions ?? [])
			// n8n resolves a stored value beginning with `=` as an expression, and it
			// has no escape for a literal one, so such a suggestion cannot round-trip.
			.filter((s) => typeof s?.value === 'string' && !s.value.startsWith('='))
			.map((s) => ({ name: s.value, value: s.value })),
	};
}

/** Only job search takes aggregations today, so there is one list rather than a map. */
export async function getAggregationFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return asOptions(JOB_AGGREGATION_FIELDS);
}
