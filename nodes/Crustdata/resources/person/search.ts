import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';
import { splitProperty } from '../../response';
import { usageProperty } from '../../usage';
import { filtersProperties } from '../../filters';
import { fieldsProperty } from '../../fields';
import { paginationProperties } from '../../pagination';
import { sortProperties } from '../../sort';


const showOnlyForPersonSearch = {
	operation: ['search'],
	resource: ['person'],
};

export const personSearchDescription: INodeProperties[] = [
	...filtersProperties('person', 'search'),
	sortProperties('person', 'search'),
	...paginationProperties('person', 'search'),
	fieldsProperty('person', 'search'),
	{
		displayName: 'Preview',
		name: 'preview',
		type: 'boolean',
		default: false,
		description: 'Whether to return only basic fields, for a faster and cheaper response',
		displayOptions: { show: showOnlyForPersonSearch },
		routing: { send: { type: 'body', property: 'preview' } },
	},
	{
		displayName: 'Explain Empty Results',
		name: 'explain',
		type: 'boolean',
		default: false,
		description:
			'Whether to name the condition responsible when a filters-only search matches nothing. The answer arrives in the response\'s remarks. Not the per-hit scoring flag on semantic search.',
		displayOptions: { show: showOnlyForPersonSearch },
		routing: { send: { type: 'body', property: 'explain' } },
	},
	{
		displayName: 'Exclude Profile URLs',
		name: 'excludeProfiles',
		type: 'string',
		default: '',
		placeholder: 'e.g. https://www.linkedin.com/in/example',
		description:
			'Profile URLs to drop from the results, comma-separated. Point it at the people you already have and the search stops returning them. Up to 50,000.',
		displayOptions: { show: showOnlyForPersonSearch },
	},
	{
		displayName: 'Exclude Names',
		name: 'excludeNames',
		type: 'string',
		default: '',
		typeOptions: { rows: 3 },
		placeholder: 'e.g. Jane Doe\nJohn Smith, Jr.',
		description:
			'Names to drop from the results, one per line. Not comma-separated: a person name may itself contain a comma.',
		displayOptions: { show: showOnlyForPersonSearch },
	},
	splitProperty('person', 'search', { returnAll: [true] }),
	usageProperty('person', 'search'),
];

const listFrom = (value: unknown, separator: string): string[] =>
	String(value ?? '')
		.split(separator)
		.map((s) => s.trim())
		.filter(Boolean);

/**
 * `post_processing` is sent whole or not at all, for the same reason `search` is on company
 * search: a key present but empty is a shape the API did not ask for, and exclusions are
 * applied AFTER the page is drawn, so an empty one would be a no-op that still changes the
 * request.
 *
 * Exclusion is post-processing, not filtering: the rows are removed after they are
 * selected, so a page can come back shorter than Limit without that meaning the search ran
 * out. Return All budgets on what arrives, so it pages past the gap on its own.
 */
export async function sendPostProcessing(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const exclude_profiles = listFrom(this.getNodeParameter('excludeProfiles', ''), ',');
	const exclude_names = listFrom(this.getNodeParameter('excludeNames', ''), '\n');

	const post_processing: IDataObject = {};
	if (exclude_profiles.length) post_processing.exclude_profiles = exclude_profiles;
	if (exclude_names.length) post_processing.exclude_names = exclude_names;
	if (Object.keys(post_processing).length === 0) return requestOptions;

	requestOptions.body = { ...((requestOptions.body ?? {}) as IDataObject), post_processing };
	return requestOptions;
}
