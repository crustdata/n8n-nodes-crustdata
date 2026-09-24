import type { INodeProperties } from 'n8n-workflow';
import { fieldsProperty } from '../../fields';
import { usageProperty } from '../../usage';

const showOnlyForCompanyIdentify = {
	operation: ['identify'],
	resource: ['company'],
};

const showFor = (identifier: string) => ({
	show: { ...showOnlyForCompanyIdentify, identifyBy: [identifier] },
});

export const companyIdentifyDescription: INodeProperties[] = [
	{
		displayName: 'Identify By',
		name: 'identifyBy',
		type: 'options',
		default: 'names',
		description: 'Which identifier to resolve from',
		displayOptions: { show: showOnlyForCompanyIdentify },
		options: [
			{ name: 'Company Name', value: 'names' },
			{ name: 'Domain', value: 'domains' },
			{ name: 'Crustdata Company ID', value: 'crustdataCompanyIds' },
			{ name: 'Profile URL', value: 'profileUrls' },
		],
	},
	{
		displayName: 'Company Names',
		name: 'names',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 3 },
		placeholder: 'e.g. Stripe\nProcter & Gamble, Inc.',
		description:
			'Company names, one per line. Not comma-separated: a company name may itself contain a comma. Resolving a messy name to an identity is what this operation is for.',
		displayOptions: showFor('names'),
		routing: {
			send: {
				type: 'body',
				property: 'names',
				value: '={{ $value.split("\\n").map(s => s.trim()).filter(Boolean) }}',
			},
		},
	},
	{
		displayName: 'Domains',
		name: 'domains',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. stripe.com, figma.com',
		description: 'Company domains, comma-separated. Bare domains, no scheme. Maximum 25 per call.',
		displayOptions: showFor('domains'),
		routing: {
			send: {
				type: 'body',
				property: 'domains',
				value: '={{ $value.split(",").map(s => s.trim()).filter(Boolean) }}',
			},
		},
	},
	{
		displayName: 'Crustdata Company IDs',
		name: 'crustdataCompanyIds',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 12345, 67890',
		description: 'Crustdata company IDs, comma-separated. Maximum 25 per call.',
		displayOptions: showFor('crustdataCompanyIds'),
		routing: {
			send: {
				type: 'body',
				property: 'crustdata_company_ids',
				value:
					'={{ $value.split(",").map(s => s.trim()).filter(Boolean).map(Number).filter(n => !isNaN(n)) }}',
			},
		},
	},
	{
		displayName: 'Profile URLs',
		name: 'profileUrls',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://www.linkedin.com/company/stripe',
		description: 'Company profile URLs, comma-separated. Maximum 25 per call.',
		displayOptions: showFor('profileUrls'),
		routing: {
			send: {
				type: 'body',
				property: 'professional_network_profile_urls',
				value: '={{ $value.split(",").map(s => s.trim()).filter(Boolean) }}',
			},
		},
	},
	fieldsProperty('company', 'identify', {
		description:
			'Identify resolves identity and basic profile only, so the list is the three groups it can return. Headcount, funding, people and the rest are Company → Enrich. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	}),
	{
		displayName: 'Matching',
		name: 'matching',
		type: 'options',
		default: 'auto',
		description:
			'How strictly to match the identifier. Auto-detect is the API default; a boolean here overrides it.',
		displayOptions: { show: showOnlyForCompanyIdentify },
		options: [
			{ name: 'Auto-Detect', value: 'auto' },
			{ name: 'Exact', value: 'exact' },
			{ name: 'Fuzzy', value: 'fuzzy' },
		],
		routing: {
			send: {
				type: 'body',
				property: 'exact_match',
				value: '={{ $value === "auto" ? null : $value === "exact" }}',
			},
		},
	},
	usageProperty('company', 'identify'),
];
