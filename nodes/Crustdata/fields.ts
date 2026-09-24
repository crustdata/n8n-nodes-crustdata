import type { INodeProperties } from 'n8n-workflow';

type FieldsOptions = {
	/** Sent when the user clears the control; omit to send nothing. */
	default?: string[];
	description?: string;
};

/**
 * For search the vocabulary is walked out of the 200-response record, so a filter-only column
 * cannot appear: it is filterable but never returned, and asking for one is a 400 whose
 * `metadata.available_fields` is the only hint you get. A family name selects the whole family,
 * which is why branch nodes sit beside their leaves.
 */
export function fieldsProperty(
	resource: string,
	operation: string,
	options: FieldsOptions = {},
): INodeProperties {
	const property: INodeProperties = {
		displayName: 'Field Names or IDs',
		name: 'fields',
		type: 'multiOptions',
		default: [],
		description:
			'Paths to include in each result. Leave empty for the API default set. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		typeOptions: { loadOptionsMethod: 'getFieldOptions' },
		displayOptions: { show: { resource: [resource], operation: [operation] } },
		routing: {
			send: {
				type: 'body',
				property: 'fields',
				value: '={{ $value.length ? $value : undefined }}',
			},
		},
	};
	if (options.default) property.default = options.default;
	if (options.description) property.description = options.description;
	return property;
}
