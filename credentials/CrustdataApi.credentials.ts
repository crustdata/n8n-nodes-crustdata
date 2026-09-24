import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/** Pinned: a version bump changes field shapes, so it is a node release. */
export const API_VERSION = '2025-11-01';

export class CrustdataApi implements ICredentialType {
	name = 'crustdataApi';

	displayName = 'Crustdata API';

	// The mark is brand indigo with no white or black, so one file reads on both
	// canvases; a themed pair would be two copies of the same artwork.
	// eslint-disable-next-line @n8n/community-nodes/icon-prefer-themed-variants
	icon: Icon = 'file:crustdata.svg';

	documentationUrl = 'https://github.com/crustdata/n8n-nodes-crustdata?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Your Crustdata API key, from crustdata.com',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
				// Required on every request; absent from the spec's securitySchemes.
				// Without it: 400 after auth passes.
				'x-api-version': API_VERSION,
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.crustdata.com',
			url: '/account/credits',
		},
	};
}
