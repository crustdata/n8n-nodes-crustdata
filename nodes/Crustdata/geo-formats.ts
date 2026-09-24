import { NodeOperationError } from 'n8n-workflow';
import type { INode } from 'n8n-workflow';
import { nearestValid } from './diagnostics';

/**
 * Inconsistent inside one dataset: `basic_profile.location.country` wants the full name while
 * these want the code. The other valid form is structurally fine, so the API answers ZERO ROWS
 * and no error. The name-wanting columns carry autocomplete and steer themselves; these cannot,
 * because the API's autocomplete endpoint does not offer them.
 *
 * Hand-maintained: `value_format` is published only through the docs, not the spec the generator
 * reads. A test pins each path against the generated filter list, so a rename breaks the build
 * rather than silently disarming the guard.
 */
const ISO3_COLUMNS: readonly string[] = [
	'experience.employment_details.company_headquarters_country',
	'experience.employment_details.current.company_headquarters_country',
	'experience.employment_details.past.company_headquarters_country',
];

/**
 * Names as the deployed API stores them, from the MCP server's live-verified map (ADR-0034):
 * hence `Czechia` over `Czech Republic` and `Türkiye` over `Turkey`. Only the suggestion needs
 * this table, so an unlisted country is still caught by the shape check below.
 */
const NAME_TO_ISO3: Readonly<Record<string, string>> = {
	'united states': 'USA', 'united kingdom': 'GBR', canada: 'CAN', australia: 'AUS',
	germany: 'DEU', france: 'FRA', india: 'IND', china: 'CHN', japan: 'JPN', brazil: 'BRA',
	mexico: 'MEX', spain: 'ESP', italy: 'ITA', netherlands: 'NLD', sweden: 'SWE',
	switzerland: 'CHE', ireland: 'IRL', singapore: 'SGP', israel: 'ISR', poland: 'POL',
	belgium: 'BEL', austria: 'AUT', denmark: 'DNK', norway: 'NOR', finland: 'FIN',
	portugal: 'PRT', greece: 'GRC', czechia: 'CZE', romania: 'ROU', hungary: 'HUN',
	ukraine: 'UKR', russia: 'RUS', 'türkiye': 'TUR', 'united arab emirates': 'ARE',
	'saudi arabia': 'SAU', 'south africa': 'ZAF', nigeria: 'NGA', kenya: 'KEN', egypt: 'EGY',
	argentina: 'ARG', chile: 'CHL', colombia: 'COL', peru: 'PER', 'south korea': 'KOR',
	indonesia: 'IDN', malaysia: 'MYS', thailand: 'THA', vietnam: 'VNM', philippines: 'PHL',
	pakistan: 'PAK', bangladesh: 'BGD', 'new zealand': 'NZL',
};

/**
 * Forms the store does not hold, so a caller reaching for one is provably wrong.
 *
 * Nothing here may be exactly three letters: the shape check passes those through unread, and
 * that is correct, because the API matches them case-insensitively ("usa" finds what "USA" does).
 */
const ALIASES: Readonly<Record<string, string>> = {
	'u.s.': 'USA', 'u.s.a.': 'USA', us: 'USA', america: 'USA',
	uk: 'GBR', 'great britain': 'GBR', england: 'GBR', britain: 'GBR',
	'czech republic': 'CZE', turkey: 'TUR', 'russian federation': 'RUS', korea: 'KOR',
	'republic of korea': 'KOR', 'u.a.e.': 'ARE', 'the netherlands': 'NLD', holland: 'NLD',
};

export const ISO3_FILTER_COLUMNS = ISO3_COLUMNS;

/** ISO 3166-1 alpha-3 is exactly three letters, so anything else is the wrong form. */
const looksIso3 = (value: string): boolean => /^[A-Za-z]{3}$/.test(value);

function iso3For(value: string): string | undefined {
	const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
	return NAME_TO_ISO3[key] ?? ALIASES[key];
}

/**
 * Fires only on a provably-wrong SHAPE, never on an unrecognised three-letter token: the live
 * API stays authoritative over which codes exist, and second-guessing it would reject the tail
 * of countries this table does not carry.
 */
export function assertGeoFormat(node: INode, conditions: Array<{ field?: string; value?: unknown }>): void {
	for (const condition of conditions) {
		if (!condition?.field || !ISO3_COLUMNS.includes(condition.field)) continue;

		const values = Array.isArray(condition.value) ? condition.value : [condition.value];
		for (const raw of values) {
			const value = String(raw ?? '').trim();
			if (!value || looksIso3(value)) continue;

			const code = iso3For(value);
			const near = code ? [] : nearestValid(value, Object.keys(NAME_TO_ISO3), 1);
			const suggestion = code ?? (near.length ? NAME_TO_ISO3[near[0]] : undefined);

			throw new NodeOperationError(
				node,
				`'${condition.field}' wants an ISO-3 country code, not '${value}'`,
				{
					description: suggestion
						? `Use '${suggestion}'. This column is one of the few that takes the code rather than the name, and the wrong form returns zero rows with no error.`
						: 'Use the three-letter code, for example USA or DEU. The wrong form returns zero rows with no error.',
				},
			);
		}
	}
}
