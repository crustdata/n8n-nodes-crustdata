import type { INodeProperties } from 'n8n-workflow';
import { fieldsProperty } from '../../fields';
import { usageProperty } from '../../usage';

const showOnlyForPersonEnrich = {
	operation: ['enrich'],
	resource: ['person'],
};

export const personEnrichDescription: INodeProperties[] = [
	{
		displayName: 'Profile URLs',
		name: 'profileUrls',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://www.linkedin.com/in/example',
		description: 'Profile URLs to enrich, comma-separated. Maximum 25 per call.',
		displayOptions: { show: showOnlyForPersonEnrich },
		routing: {
			send: {
				type: 'body',
				property: 'professional_network_profile_urls',
				// The API takes an array; the UI takes one field. Split here so a single
				// URL and a pasted list behave the same.
				value: '={{ $value.split(",").map(s => s.trim()).filter(Boolean) }}',
			},
		},
	},
	fieldsProperty('person', 'enrich', {
		default: ['basic_profile', 'social_handles'],
		description:
			'Field groups to return. Clearing this sends nothing and the API answers with basic_profile and social_handles. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	}),
	{
		displayName: 'Preview',
		name: 'preview',
		type: 'boolean',
		default: false,
		description: 'Whether to return a preview instead of the billable full record',
		displayOptions: { show: showOnlyForPersonEnrich },
		routing: { send: { type: 'body', property: 'preview' } },
	},
	usageProperty('person', 'enrich'),
];
