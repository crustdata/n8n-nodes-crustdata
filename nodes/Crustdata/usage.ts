import type {
	IDataObject,
	IExecuteSingleFunctions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

const HEADERS = {
	'x-credits-used': 'creditsUsed',
	'x-ratelimit-limit': 'rateLimit',
	'x-ratelimit-remaining': 'rateLimitRemaining',
	'x-ratelimit-reset': 'rateLimitResetSeconds',
} as const;

export function usageProperty(resource: string, operation: string): INodeProperties {
	return {
		displayName: 'Include Usage',
		name: 'includeUsage',
		type: 'boolean',
		default: true,
		description:
			'Whether to add a usage key to each item holding credits used and the rate-limit headers. On by default because this node bills per result and a caller that cannot see what it spent cannot bound it, which matters most when a model is driving. Turn it off to relay the response untouched. This is the one key the node adds; it overwrites a field of that name if the API ever returns one. One request answers many rows, so the same figures repeat across them.',
		displayOptions: { show: { resource: [resource], operation: [operation] } },
		routing: { output: { postReceive: [attachUsage] } },
	};
}

export async function attachUsage(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	if (!this.getNodeParameter('includeUsage', true)) return items;

	const headers = (response?.headers ?? {}) as Record<string, unknown>;
	const usage: Record<string, number | string> = {};
	for (const [header, key] of Object.entries(HEADERS)) {
		const raw = headers[header];
		if (raw === undefined) continue;
		const value = Array.isArray(raw) ? raw[0] : raw;
		const n = Number(value);
		usage[key] = Number.isFinite(n) ? n : String(value);
	}
	if (Object.keys(usage).length === 0) return items;

	return items.map((item) => {
		// Spreading a non-object json explodes a string into indexed characters.
		const json = item.json;
		if (typeof json !== 'object' || json === null || Array.isArray(json)) return item;
		return { ...item, json: { ...json, usage } as IDataObject };
	});
}
