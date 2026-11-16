import type { CourseData } from '../../uma-skill-tools/CourseData';

export type TeamTrialsCategory = 'short' | 'mile' | 'medium' | 'long' | 'dirt';

export const TEAM_TRIAL_CATEGORIES: { value: TeamTrialsCategory; label: string }[] = [
	{ value: 'short', label: 'Sprint' },
	{ value: 'mile', label: 'Mile' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'long', label: 'Long' },
	{ value: 'dirt', label: 'Dirt' },
];

const LONGCHAMP_TRACK_ID = 10201;
const JRA_TRACK_IDS = new Set([10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009, 10010]);

export interface TeamTrialCourse {
	id: string;
	course: CourseData;
	racedef: Record<string, unknown>;
}

export function getTeamTrialCourseIds(
	courses: Record<string, Pick<CourseData, 'raceTrackId' | 'surface' | 'distanceType'>>,
	category: TeamTrialsCategory
): string[] {
	if (category === 'dirt') {
		return Object.entries(courses)
			.filter(([, course]) =>
				JRA_TRACK_IDS.has(course.raceTrackId) &&
				course.surface === 2 &&
				course.distanceType === 2
			)
			.map(([id]) => id)
			.sort((a, b) => Number(a) - Number(b));
	}

	const distanceType = { short: 1, mile: 2, medium: 3, long: 4 }[category];
	return Object.entries(courses)
		.filter(([, course]) =>
			course.raceTrackId !== LONGCHAMP_TRACK_ID &&
			course.surface === 1 &&
			course.distanceType === distanceType
		)
		.map(([id]) => id)
		.sort((a, b) => Number(a) - Number(b));
}

export function getTeamTrialSampleCount(requestedSamples: number, courseCount: number): number {
	if (!Number.isInteger(requestedSamples) || requestedSamples < 1) {
		throw new RangeError(`Requested sample count must be a positive integer; received ${requestedSamples}`);
	}
	if (!Number.isInteger(courseCount) || courseCount < 1) {
		throw new RangeError(`Team Trials course count must be a positive integer; received ${courseCount}`);
	}
	return Math.ceil(requestedSamples / courseCount) * courseCount;
}

export interface SkillConditionMatch {
	variants: {
		overrides: {
			season?: number;
			weather?: number;
			groundCondition?: number;
		};
		probability: number;
		alternativeIndex: number;
	}[];
}

// Race-condition weights used to reduce conditional skill averages.
const CONDITION_PROBABILITIES = {
	season: [0, 0.4, 0.22, 0.12, 0.26],
	weather: [0, 0.58, 0.3, 0.11, 0.01],
	ground_condition: [0, 0.77, 0.11, 0.07, 0.05],
} as const;
const CONDITION_FIELDS = [
	{ condition: 'season', override: 'season' },
	{ condition: 'weather', override: 'weather' },
	{ condition: 'ground_condition', override: 'groundCondition' },
] as const;
type ConditionField = keyof typeof CONDITION_PROBABILITIES;
type SkillConditionVariant = SkillConditionMatch['variants'][number];

function getVariantKey(overrides: SkillConditionVariant['overrides']): string {
	return JSON.stringify(overrides);
}

function mergeEquivalentVariants(variants: SkillConditionVariant[]): SkillConditionVariant[] {
	let merged = variants;
	for (const { override: field } of CONDITION_FIELDS) {
		const groups = new Map<string, SkillConditionVariant[]>();
		for (const variant of merged) {
			const otherOverrides = { ...variant.overrides };
			delete otherOverrides[field];
			const key = JSON.stringify(otherOverrides);
			const group = groups.get(key) ?? [];
			group.push(variant);
			groups.set(key, group);
		}

		merged = [...groups.values()].flatMap(group => {
			const values = new Set(group.map(variant => variant.overrides[field]));
			if (values.size < 2 || values.has(undefined)) return group;
			return [{
				...group[0],
				probability: group.reduce((sum, variant) => sum + variant.probability, 0),
			}];
		});
	}
	return merged;
}

export function getViableSkillConditionMatches(
	skills: string[],
	matches: Record<string, SkillConditionMatch> | undefined,
	isViable: (skillId: string, overrides: SkillConditionVariant['overrides']) => boolean,
): { skills: string[]; conditions: Record<string, SkillConditionMatch> } {
	const viableSkills: string[] = [];
	const viableConditions: Record<string, SkillConditionMatch> = {};

	for (const skillId of skills) {
		const condition = matches?.[skillId];
		const candidates = condition?.variants ?? [{
			overrides: {},
			probability: 1,
			alternativeIndex: -1,
		}];
		const viable = candidates.filter(variant => isViable(skillId, variant.overrides));
		if (viable.length === 0) continue;

		viableSkills.push(skillId);
		if (!condition) continue;

		const byAlternative = new Map<number, SkillConditionVariant[]>();
		for (const variant of viable) {
			const group = byAlternative.get(variant.alternativeIndex) ?? [];
			group.push(variant);
			byAlternative.set(variant.alternativeIndex, group);
		}

		const combined = [...byAlternative.values()].flatMap(mergeEquivalentVariants);
		const deduplicated = new Map<string, SkillConditionVariant>();
		for (const variant of combined) {
			const key = getVariantKey(variant.overrides);
			const existing = deduplicated.get(key);
			if (!existing || variant.probability > existing.probability) {
				deduplicated.set(key, variant);
			}
		}

		const totalProbability = [...deduplicated.values()].reduce((sum, variant) => sum + variant.probability, 0);
		const scale = totalProbability > 1 ? 1 / totalProbability : 1;
		viableConditions[skillId] = {
			variants: [...deduplicated.values()].map(variant => ({
				overrides: variant.overrides,
				probability: variant.probability * scale,
				alternativeIndex: variant.alternativeIndex,
			})),
		};
	}

	return { skills: viableSkills, conditions: viableConditions };
}

export function getSkillConditionMatches(
	skills: Record<string, { alternatives?: { condition?: string; precondition?: string }[] }>
): Record<string, SkillConditionMatch> {
	const matches: Record<string, SkillConditionMatch> = {};

	for (const [skillId, skill] of Object.entries(skills)) {
		const variants: SkillConditionVariant[] = [];
		let hasUnconditionalBranch = false;
		let hasInvalidWeightedBranch = false;

		for (const [alternativeIndex, alternative] of (skill.alternatives ?? []).entries()) {
			let branches = [''];
			for (const expression of [alternative.precondition, alternative.condition]) {
				if (!expression?.trim()) continue;
				branches = branches.flatMap(prefix =>
					expression.split('@').map(branch => [prefix, branch].filter(Boolean).join('&'))
				);
			}

			const alternativeVariants = new Map<string, SkillConditionVariant>();
			for (const branch of branches) {
				const overrides: SkillConditionVariant['overrides'] = {};
				let probability = 1;
				let hasRelevantCondition = false;
				let invalidBranch = false;

				for (const { condition: field, override } of CONDITION_FIELDS) {
					const values = new Set<number>();
					const pattern = new RegExp(`(?:^|[^a-z_])${field}==([0-9]+)`, 'g');
					let match: RegExpExecArray | null;
					while ((match = pattern.exec(branch)) !== null) {
						const value = Number(match[1]);
						values.add(value);
					}
					if (values.size === 0) continue;
					if (values.size > 1) {
						invalidBranch = true;
						break;
					}

					const value = [...values][0];
					const fieldProbabilities = CONDITION_PROBABILITIES[field as ConditionField];
					if (value < 1 || value >= fieldProbabilities.length) {
						invalidBranch = true;
						break;
					}
					hasRelevantCondition = true;
					overrides[override] = value;
					probability *= fieldProbabilities[value];
				}

				if (invalidBranch) {
					hasInvalidWeightedBranch = true;
					continue;
				}
				if (!hasRelevantCondition) {
					hasUnconditionalBranch = true;
					break;
				}

				const key = getVariantKey(overrides);
				const existing = alternativeVariants.get(key);
				alternativeVariants.set(key, {
					overrides,
					probability: Math.max(existing?.probability ?? 0, probability),
					alternativeIndex,
				});
			}
			if (hasUnconditionalBranch) break;
			variants.push(...alternativeVariants.values());
		}

		if (hasUnconditionalBranch) continue;
		if (variants.length > 0) {
			matches[skillId] = { variants };
		} else if (hasInvalidWeightedBranch) {
			matches[skillId] = { variants: [] };
		}
	}

	return matches;
}

export function applyConditionProbability(mean: number, median: number, probability: number) {
	if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
		throw new RangeError(`Condition probability must be between 0 and 1; received ${probability}`);
	}
	return {
		mean: mean * probability,
		median: probability < 0.5 ? 0 : median,
	};
}
