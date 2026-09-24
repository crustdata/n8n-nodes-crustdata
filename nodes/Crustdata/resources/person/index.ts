import type { INodeProperties } from 'n8n-workflow';
import { validateFields } from '../validate-fields';
import { personEnrichDescription } from './enrich';
import { personContactEnrichDescription } from './contact-enrich';
import { splitArrayRoot } from '../../response';
import { personSearchDescription, sendPostProcessing } from './search';
import { sendSorts } from '../../sort';
import { sendFilters } from '../../filters';

const showOnlyForPerson = {
	resource: ['person'],
};

export const personDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showOnlyForPerson },
		options: [
			{
				name: 'Enrich',
				value: 'enrich',
				action: 'Enrich a person',
				description: 'Look up people by profile URL and return the requested field groups',
				routing: {
					request: {
						method: 'POST',
						url: '/person/enrich',
					},
					send: { preSend: [validateFields] },
					output: { postReceive: [splitArrayRoot] },
				},
			},
			{
				name: 'Contact Enrich',
				value: 'contactEnrich',
				action: 'Enrich a person s contact details',
				description:
					'Emails and phone numbers only, no profile data. Billed per tier returned, so the Fields control is the cost control.',
				routing: {
					request: { method: 'POST', url: '/person/contact/enrich' },
					send: { preSend: [validateFields] },
					output: { postReceive: [splitArrayRoot] },
				},
			},
			{
				name: 'Search',
				value: 'search',
				action: 'Search people',
				description: 'Find people matching a set of conditions',
				routing: {
					request: {
						method: 'POST',
						url: '/person/search',
					},
					send: { preSend: [sendFilters(), sendSorts, sendPostProcessing, validateFields] },
				},
			},
		],
		default: 'search',
	},
	...personSearchDescription,
	...personEnrichDescription,
	...personContactEnrichDescription,
];
