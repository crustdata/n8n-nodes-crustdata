import { NodeOperationError } from 'n8n-workflow';
import type { INode, INodePropertyOptions } from 'n8n-workflow';

/** Both nodes address these, and a second copy would drift where a wrong path is a silent 404. */

/** Entity watches live under /watch/{dataset}; discovery watches under /watch/{dataset}/search. */
export const watchPath = (kind: string, dataset: string, watchId?: string | number): string => {
	const root = kind === 'discovery' ? `/watch/${dataset}/search` : `/watch/${dataset}`;
	return watchId === undefined || watchId === '' ? root : `${root}/${watchId}`;
};

/**
 * These land in the request path and the controls take expressions, so a value with a slash
 * in it would point the credential at a URL we did not choose.
 */
export function assertWatchId(node: INode, value: unknown, parameter: string): string {
	const id = String(value ?? '').trim();
	if (!/^\d+$/.test(id)) {
		throw new NodeOperationError(node, `'${parameter}' is not a numeric id: ${id}`, {
			description: 'Crustdata watch and run IDs are integers. List returns them as `id`.',
		});
	}
	return id;
}

/**
 * Checked against the KIND's own list, not one shared list: `job` and `social_post` exist
 * only as discovery watches, so accepting one on the entity tree is a 404 that reads as an
 * empty result.
 */
export function assertDataset(node: INode, kind: string, value: unknown): string {
	const allowed = (kind === 'discovery' ? DISCOVERY_DATASETS : ENTITY_DATASETS).map((o) =>
		String(o.value),
	);
	const dataset = String(value ?? '').trim();
	if (!allowed.includes(dataset)) {
		throw new NodeOperationError(node, `'Dataset' is not a dataset for ${kind} watches: ${dataset}`, {
			description: `Pick one of: ${allowed.join(', ')}.`,
		});
	}
	return dataset;
}

/** Entity watches cover people and companies only. Alphabetical: n8n lints option order. */
export const ENTITY_DATASETS: INodePropertyOptions[] = [
	{ name: 'Company', value: 'company' },
	{ name: 'Person', value: 'person' },
];

/** Discovery watches additionally cover jobs and social posts. */
export const DISCOVERY_DATASETS: INodePropertyOptions[] = [
	{ name: 'Company', value: 'company' },
	{ name: 'Job', value: 'job' },
	{ name: 'Person', value: 'person' },
	{ name: 'Social Post', value: 'social_post' },
];
