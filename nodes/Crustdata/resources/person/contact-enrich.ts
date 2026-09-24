import type { INodeProperties } from 'n8n-workflow';
import { fieldsProperty } from '../../fields';
import { usageProperty } from '../../usage';

const showOnlyForContactEnrich = {
	operation: ['contactEnrich'],
	resource: ['person'],
};

const showFor = (identifier: string) => ({
	show: { ...showOnlyForContactEnrich, identifyBy: [identifier] },
});

export const personContactEnrichDescription: INodeProperties[] = [
	{
		displayName: 'Identify By',
		name: 'identifyBy',
		type: 'options',
		default: 'profileUrls',
		description: 'Which identifier to look the people up by',
		displayOptions: { show: showOnlyForContactEnrich },
		options: [
			{ name: 'Profile URL', value: 'profileUrls' },
			{ name: 'Business Email', value: 'businessEmails' },
		],
	},
	{
		displayName: 'Profile URLs',
		name: 'profileUrls',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://www.linkedin.com/in/example',
		description: 'Profile URLs to enrich, comma-separated. Maximum 25 per call.',
		displayOptions: showFor('profileUrls'),
		routing: {
			send: {
				type: 'body',
				property: 'professional_network_profile_urls',
				value: '={{ $value.split(",").map(s => s.trim()).filter(Boolean) }}',
			},
		},
	},
	{
		displayName: 'Business Emails',
		name: 'businessEmails',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. someone@stripe.com, someone@figma.com',
		description:
			'Business emails to look up, comma-separated. Maximum 25 per call. This is the reverse direction: an address in, the person behind it out.',
		displayOptions: showFor('businessEmails'),
		routing: {
			send: {
				type: 'body',
				property: 'business_emails',
				value: '={{ $value.split(",").map(s => s.trim()).filter(Boolean) }}',
			},
		},
	},
	// Business email only, explicitly. Omitting `fields` requests all three tiers, so the
	// API default is the dearest request the endpoint accepts.
	fieldsProperty('person', 'contactEnrich', {
		default: ['contact.business_emails'],
		description:
			'Contact tiers to enrich. <b>Billed per tier actually returned, per matched person:</b> business emails 1 credit, personal emails 2, phone numbers 2, capped at 5. A tier with nothing on file costs nothing, so this control sets the worst case rather than the price. Clearing it does not make the call cheaper: the API then requests all three. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	}),
	{
		displayName: 'Verified Business Emails Only',
		name: 'verified',
		type: 'boolean',
		default: false,
		description:
			'Whether to re-check every business email for deliverability at request time and return only the addresses that pass. <b>Adds 0.5 credits per matched person who receives at least one.</b> Affects business emails alone; when nothing survives the check the list comes back empty with contact.business_emails_message set.',
		// Not gated on the Fields picker holding business emails: clearing Fields requests
		// all three tiers, so the gate would hide this exactly where it still applies.
		displayOptions: { show: showOnlyForContactEnrich },
		routing: { send: { type: 'body', property: 'verified' } },
	},
	usageProperty('person', 'contactEnrich'),
];
