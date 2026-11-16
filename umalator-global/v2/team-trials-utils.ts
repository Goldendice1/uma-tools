import type { CourseData } from '../../uma-skill-tools/CourseData';

export type TeamTrialsCategory = 'short' | 'mile' | 'medium' | 'long' | 'dirt';

export const TEAM_TRIAL_CATEGORIES: { value: TeamTrialsCategory; label: string }[] = [
	{ value: 'short', label: 'Sprint' },
	{ value: 'mile', label: 'Mile' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'long', label: 'Long' },
	{ value: 'dirt', label: 'Dirt' },
];

export interface TeamTrialCourse {
	id: string;
	course: CourseData;
	racedef: Record<string, unknown>;
}

export function getTeamTrialCourseIds(
	courses: Record<string, Pick<CourseData, 'surface' | 'distanceType'>>,
	category: TeamTrialsCategory
): string[] {
	if (category === 'dirt') {
		return Object.entries(courses)
			.filter(([, course]) => course.surface === 2)
			.map(([id]) => id)
			.sort((a, b) => Number(a) - Number(b));
	}

	const distanceType = { short: 1, mile: 2, medium: 3, long: 4 }[category];
	return Object.entries(courses)
		.filter(([, course]) => course.surface === 1 && course.distanceType === distanceType)
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
	}[];
}

// Race-condition weights used to reduce conditional skill averages.
const CONDITION_PROBABILITIES: Record<string, number[]> = {
	season: [0, 0.4, 0.22, 0.12, 0.26],
	weather: [0, 0.58, 0.3, 0.11, 0.01],
	ground_condition: [0, 0.77, 0.11, 0.07, 0.05],
};

export function getSkillConditionMatches(
	skills: Record<string, { alternatives?: { condition?: string }[] }>
): Record<string, SkillConditionMatch> {
	const matches: Record<string, SkillConditionMatch> = {};
	const fields = ['season', 'weather', 'ground_condition'] as const;

	for (const [skillId, skill] of Object.entries(skills)) {
		const variants = new Map<string, SkillConditionMatch['variants'][number]>();
		let hasUnconditionalBranch = false;

		for (const alternative of skill.alternatives ?? []) {
			for (const branch of (alternative.condition ?? '').split('@')) {
				const overrides: SkillConditionMatch['variants'][number]['overrides'] = {};
				let probability = 1;
				let hasRelevantCondition = false;
				let invalidBranch = false;

				for (const field of fields) {
					const values = new Set<number>();
					const pattern = new RegExp(`(?:^|[^a-z_])${field}==([0-9]+)`, 'g');
					let match: RegExpExecArray | null;
					while ((match = pattern.exec(branch)) !== null) {
						const value = Number(match[1]);
						if (value > 0 && value < CONDITION_PROBABILITIES[field].length) values.add(value);
					}
					if (values.size === 0) continue;
					if (values.size > 1) {
						invalidBranch = true;
						break;
					}

					const value = [...values][0];
					hasRelevantCondition = true;
					if (field === 'season') overrides.season = value;
					else if (field === 'weather') overrides.weather = value;
					else overrides.groundCondition = value;
					probability *= CONDITION_PROBABILITIES[field][value];
				}

				if (invalidBranch) continue;
				if (!hasRelevantCondition) {
					hasUnconditionalBranch = true;
					break;
				}

				const key = JSON.stringify(overrides);
				const existing = variants.get(key);
				variants.set(key, {
					overrides,
					probability: Math.max(existing?.probability ?? 0, probability),
				});
			}
			if (hasUnconditionalBranch) break;
		}

		if (!hasUnconditionalBranch && variants.size > 0) {
			const combinedVariants = new Map<string, SkillConditionMatch['variants'][number]>();
			for (const variant of variants.values()) {
				const { groundCondition: _groundCondition, ...otherOverrides } = variant.overrides;
				const key = JSON.stringify(otherOverrides);
				const existing = combinedVariants.get(key);
				combinedVariants.set(key, {
					overrides: existing?.overrides ?? variant.overrides,
					probability: (existing?.probability ?? 0) + variant.probability,
				});
			}

			const totalProbability = [...combinedVariants.values()].reduce((sum, variant) => sum + variant.probability, 0);
			const scale = totalProbability > 1 ? 1 / totalProbability : 1;
			matches[skillId] = {
				variants: [...combinedVariants.values()].map(variant => ({
					...variant,
					probability: variant.probability * scale,
				})),
			};
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
