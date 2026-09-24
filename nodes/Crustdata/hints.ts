import type { NodeHint } from 'n8n-workflow';

export const NEXT_STEP_HINTS: NodeHint[] = [
	{
		message:
			'Got profile URLs. A second Crustdata node with <b>Person → Enrich</b> returns the full record for each one.',
		type: 'info',
		location: 'outputPane',
		whenToDisplay: 'afterExecution',
		displayCondition:
			'={{ $parameter["resource"] === "person" && $parameter["operation"] === "search" }}',
	},
	{
		message:
			'Have the company. <b>Person → Search</b> filtered on <code>experience.employment_details.company_website_domain</code> finds people who work there.',
		type: 'info',
		location: 'outputPane',
		whenToDisplay: 'afterExecution',
		displayCondition:
			'={{ $parameter["resource"] === "company" && $parameter["operation"] === "enrich" }}',
	},
	{
		// The cap is 25 on every identifier endpoint; the spec declares it for company
		// identify alone, so it cannot be generated.
		message:
			'Enriching a list? Put an <b>Aggregate</b> node before this one and join the values: one call instead of one per row, and the rate limit is per request, not per record. Over 25 rows, wrap both in <b>Loop Over Items</b> with batch size 25, because a single call takes at most 25 values.',
		type: 'info',
		location: 'ndv',
		whenToDisplay: 'beforeExecution',
		displayCondition:
			'={{ $parameter["operation"] === "enrich" || $parameter["operation"] === "contactEnrich" || $parameter["operation"] === "identify" }}',
	},
	{
		// Premium rates are per account, so this must point at Discover and never name a number.
		message:
			'A search bills per row returned, so <b>Max Results</b> is your spend ceiling as much as your size one. Some columns also cost extra to filter on, not only to return. <b>Discover</b> lists your own account\'s rates, free.',
		type: 'info',
		location: 'ndv',
		whenToDisplay: 'beforeExecution',
		displayCondition: '={{ $parameter["returnAll"] === true }}',
	},
];
