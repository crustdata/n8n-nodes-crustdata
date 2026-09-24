import { NodeOperationError } from 'n8n-workflow';
import type { INode } from 'n8n-workflow';

/**
 * Suggestions computed from the live valid set, ported from the Crustdata MCP server
 * (ADR-0021), which measured the two failure modes worth catching: a right leaf under the
 * wrong namespace, and a typo.
 *
 * The pickers make both unreachable in the UI. They stay very reachable from an expression or
 * from a model driving the node as a tool, which is who this is for.
 */

/** Longer than any column; scoring an oversized token is cost without a possible match. */
const MAX_TOKEN_LEN = 128;

/** A did-you-mean is a hint, so scoring the first handful of rejects is enough. */
const MAX_REJECTS_SCORED = 25;

/** A vocabulary this small fits in the message; a bigger one is what Discover is for. */
const SMALL_SET = 12;

/**
 * Optimal String Alignment distance. Chosen over plain Levenshtein so a transposition,
 * the commonest typo, costs 1 rather than 2 and stays above the threshold.
 */
export function editDistance(a: string, b: string): number {
	if (a === b) return 0;
	const n = a.length;
	const m = b.length;
	if (n === 0) return m;
	if (m === 0) return n;

	const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = 0; i <= n; i++) d[i][0] = i;
	for (let j = 0; j <= m; j++) d[0][j] = j;

	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
			let best = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
			if (
				i > 1 &&
				j > 1 &&
				a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
				a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
			) {
				best = Math.min(best, d[i - 2][j - 2] + 1);
			}
			d[i][j] = best;
		}
	}
	return d[n][m];
}

const segments = (s: string): string[] => s.split(/[._]/).filter(Boolean);
const lastSegment = (s: string): string => segments(s).pop() ?? s;

/**
 * The strongest of several signals rather than one edit distance: a wrong column is usually a
 * namespace mistake, and a right leaf under the wrong parent scores nowhere near its full path.
 */
export function similarity(input: string, candidate: string): number {
	const a = input.toLowerCase();
	const b = candidate.toLowerCase();
	if (a === b) return 1;

	let score = 0;
	const ta = new Set(segments(a));
	const tb = new Set(segments(b));

	// Every typed segment appears in the candidate: the wrong-namespace case.
	if (ta.size > 0 && [...ta].every((t) => tb.has(t))) {
		score = Math.max(score, 0.75 + 0.2 * (ta.size / tb.size));
	}
	if (b.includes(a) || a.includes(b)) {
		const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
		score = Math.max(score, 0.7 + 0.25 * ratio);
	}
	if (ta.size > 0 && tb.size > 0) {
		let inter = 0;
		for (const t of ta) if (tb.has(t)) inter++;
		score = Math.max(score, 0.9 * (inter / (ta.size + tb.size - inter)));
	}
	const sa = lastSegment(a);
	const sb = lastSegment(b);
	const maxLen = Math.max(sa.length, sb.length);
	if (maxLen > 0) score = Math.max(score, 0.8 * (1 - editDistance(sa, sb) / maxLen));

	return score;
}

export function nearestValid(input: string, candidates: readonly string[], max = 3): string[] {
	if (input.length > MAX_TOKEN_LEN) return [];
	const scored: Array<{ value: string; score: number }> = [];
	for (const c of candidates) {
		if (c === input) continue;
		const score = similarity(input, c);
		if (score >= 0.5) scored.push({ value: c, score });
	}
	// Best first, then shorter, so the suggestion is stable run to run.
	scored.sort(
		(x, y) => y.score - x.score || x.value.length - y.value.length || (x.value < y.value ? -1 : 1),
	);
	return scored.slice(0, max).map((s) => s.value);
}

/**
 * Before the request goes out, so a wrong name costs nothing rather than a round trip and a
 * 400 that names no alternative.
 */
export function assertKnown(
	node: INode,
	values: string[],
	candidates: readonly string[],
	parameter: string,
): void {
	const unknown = values.filter((v) => v && !candidates.includes(v));
	if (unknown.length === 0) return;

	const lines = unknown.slice(0, MAX_REJECTS_SCORED).map((v) => {
		const near = nearestValid(v, candidates);
		return near.length ? `'${v}' — did you mean ${near.map((n) => `'${n}'`).join(', ')}?` : `'${v}'`;
	});
	const more = unknown.length > lines.length ? ` (and ${unknown.length - lines.length} more)` : '';

	// With nothing similar, a pointer to Discover is worse than the answer. A short
	// vocabulary fits in the message; a long one does not, which is what Discover is for.
	const nothingSimilar = !lines.some((l) => l.includes('did you mean'));
	const tail =
		nothingSimilar && candidates.length > 0 && candidates.length <= SMALL_SET
			? ` Valid here: ${candidates.map((c) => `'${c}'`).join(', ')}.`
			: ' Run the Discover operation for the full list; it costs no credits.';

	throw new NodeOperationError(
		node,
		`'${parameter}' names ${unknown.length === 1 ? 'a column' : 'columns'} this operation does not have`,
		{ description: `${lines.join(' ')}${more}${tail}` },
	);
}
