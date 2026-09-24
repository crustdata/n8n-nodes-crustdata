import type { INodeProperties } from 'n8n-workflow';
import { usageProperty } from '../../usage';
import { accountUsageDescription, assertSummaryShape, sendUsageEvent } from './usage';

const showOnlyForAccount = {
	resource: ['account'],
};

/** The three usage reports share one limit of 60 requests a minute between them. */
export const accountDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showOnlyForAccount },
		options: [
			{
				name: 'Get Credits',
				value: 'credits',
				action: 'Get the remaining credit balance',
				description: 'Read the balance left on the key. Free.',
				routing: { request: { method: 'GET', url: '/account/credits' } },
			},
			{
				name: 'Get Endpoints',
				value: 'endpoints',
				action: 'Get the entitled endpoints',
				description:
					'List the endpoints this key may call, with its per-minute token limit. Free, and the quickest way to tell an entitlement error from a bad request.',
				routing: { request: { method: 'GET', url: '/account/endpoints' } },
			},
			{
				name: 'Get Usage Errors',
				value: 'usageErrors',
				action: 'Get usage errors',
				description:
					'Group failed requests by endpoint and masked error message, most frequent first. Free. Successes and 429s never appear.',
				routing: { request: { method: 'GET', url: '/account/usage/errors' } },
			},
			{
				name: 'Get Usage Event',
				value: 'usageEvent',
				action: 'Get one usage event',
				description:
					'One request by its ID, with the body, query and headers it was sent with and the error body it got back. Free.',
				routing: {
					// A routing block must declare something to dispatch at all; preSend replaces it.
					request: { method: 'GET', url: '/account/usage/events' },
					send: { preSend: [sendUsageEvent] },
				},
			},
			{
				name: 'Get Usage Events',
				value: 'usageEvents',
				action: 'Get usage events',
				description:
					'Every request one by one, newest first, with what each was charged. Free. A request appears about ten seconds after its response.',
				routing: { request: { method: 'GET', url: '/account/usage/events' } },
			},
			{
				name: 'Get Usage Summary',
				value: 'usageSummary',
				action: 'Get a usage summary',
				description:
					'Add up requests, credits, errors and results over a window, optionally split by day, product, endpoint or charge component. Free.',
				routing: {
					request: { method: 'GET', url: '/account/usage/summary' },
					send: { preSend: [assertSummaryShape] },
				},
			},
		],
		default: 'credits',
	},
	usageProperty('account', 'credits'),
	usageProperty('account', 'endpoints'),
	...accountUsageDescription,
];
