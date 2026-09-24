import type { INodeProperties } from 'n8n-workflow';
import { fieldsProperty } from '../../fields';
import { usageProperty } from '../../usage';

const showOnlyForCompanyEnrich = {
	operation: ['enrich'],
	resource: ['company'],
};

const showFor = (identifier: string) => ({
	show: { ...showOnlyForCompanyEnrich, identifyBy: [identifier] },
});

/** The API takes arrays; the UI takes one field per identifier. */
const splitToStrings = '={{ $value.split(",").map(s => s.trim()).filter(Boolean) }}';

export const companyEnrichDescription: INodeProperties[] = [
	{
		displayName: 'Identify By',
		name: 'identifyBy',
		type: 'options',
		default: 'domains',
		description: 'Which identifier to look the companies up by',
		displayOptions: { show: showOnlyForCompanyEnrich },
		options: [
			{ name: 'Domain', value: 'domains' },
			{ name: 'Company Name', value: 'names' },
			{ name: 'Crustdata Company ID', value: 'crustdataCompanyIds' },
			{ name: 'Profile URL', value: 'profileUrls' },
		],
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
		routing: { send: { type: 'body', property: 'domains', value: splitToStrings } },
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
			'Company names, one per line. Not comma-separated: a company name may itself contain a comma. A name is ambiguous where a domain is not, so prefer Domain when you have one.',
		displayOptions: showFor('names'),
		routing: {
			send: {
				type: 'body',
				property: 'names',
				value: '={{ $value.split("\n").map(s => s.trim()).filter(Boolean) }}',
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
				value: splitToStrings,
			},
		},
	},
	fieldsProperty('company', 'enrich', {
		default: ['basic_info'],
		description:
			'Field groups to return. Clearing this sends nothing and the API answers with crustdata_company_id and basic_info only, so headcount, funding and the rest must be asked for. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	}),
	{
		displayName: 'Matching',
		name: 'matching',
		type: 'options',
		default: 'auto',
		description:
			'How strictly to match the identifier. Auto-detect is the API default; a boolean here overrides it.',
		displayOptions: { show: showOnlyForCompanyEnrich },
		options: [
			{ name: 'Auto-Detect', value: 'auto' },
			{ name: 'Exact', value: 'exact' },
			{ name: 'Fuzzy', value: 'fuzzy' },
		],
		routing: {
			send: {
				type: 'body',
				property: 'exact_match',
				// The field is nullable and null means auto-detect, so a plain boolean with
				// a default would silently pin matching to one mode and change what comes
				// back.
				value: '={{ $value === "auto" ? null : $value === "exact" }}',
			},
		},
	},
	usageProperty('company', 'enrich'),
];
