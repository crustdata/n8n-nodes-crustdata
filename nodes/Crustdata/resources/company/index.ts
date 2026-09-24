import type { INodeProperties } from 'n8n-workflow';
import { validateFields } from '../validate-fields';
import { companyEnrichDescription } from './enrich';
import { companyIdentifyDescription } from './identify';
import { companySearchDescription, sendSemanticSearch } from './search';
import { sendFilters } from '../../filters';
import { splitArrayRoot } from '../../response';
import { sendSorts } from '../../sort';

const showOnlyForCompany = {
	resource: ['company'],
};

export const companyDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showOnlyForCompany },
		options: [
			{
				name: 'Enrich',
				value: 'enrich',
				action: 'Enrich a company',
				description: 'Look up companies and return the requested field groups',
				routing: {
					request: { method: 'POST', url: '/company/enrich' },
					send: { preSend: [validateFields] },
					output: { postReceive: [splitArrayRoot] },
				},
			},
			{
				name: 'Identify',
				value: 'identify',
				action: 'Identify a company',
				description:
					'Resolve a messy name, domain or URL to a Crustdata company. Free, and one identifier type per call.',
				routing: {
					request: { method: 'POST', url: '/company/identify' },
					send: { preSend: [validateFields] },
					output: { postReceive: [splitArrayRoot] },
				},
			},
			{
				name: 'Search',
				value: 'search',
				action: 'Search companies',
				description: 'Find companies by filters, by a plain-language query, or by both',
				routing: {
					request: { method: 'POST', url: '/company/search' },
					// `query` makes filters optional: the spec requires them only when it is absent.
					send: { preSend: [sendFilters('query'), sendSorts, sendSemanticSearch, validateFields] },
				},
			},
		],
		default: 'enrich',
	},
	...companyEnrichDescription,
	...companyIdentifyDescription,
	...companySearchDescription,
];
