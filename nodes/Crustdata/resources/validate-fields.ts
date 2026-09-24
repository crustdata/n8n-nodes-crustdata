import type { IExecuteSingleFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { assertKnown } from '../diagnostics';
import { FIELD_VOCABULARY } from '../filter-fields.generated';

/**
 * `fields` is a response whitelist, so a name the endpoint does not know is a 400 that
 * lists every valid field and nothing about which one you meant. Each operation accepts a
 * different vocabulary, hence the `resource.operation` key.
 */
export async function validateFields(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const key = `${this.getNodeParameter('resource', '') as string}.${this.getNodeParameter('operation', '') as string}`;
	const chosen = this.getNodeParameter('fields', []) as string[];
	if (Array.isArray(chosen) && chosen.length) {
		assertKnown(this.getNode(), chosen, FIELD_VOCABULARY[key] ?? [], 'Field Names or IDs');
	}
	return requestOptions;
}
