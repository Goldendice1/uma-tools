/**
 * V2 Simulation Worker
 * Handles race simulation in a background thread
 */

import { fromJS, Map as ImmMap } from 'immutable';
import { HorseState } from '../../components/HorseDefTypes';
import { runComparison } from '../../umalator/compare';
import { runHpCalc } from '../../umalator/hpcalc';
import { runComparison as runComparisonV1 } from '../../umalator/compare-v1';
import { runHpCalc as runHpCalcV1 } from '../../umalator/hpcalc-v1';
import {
	applyConditionProbability,
	getTeamTrialSampleCount,
	type SkillConditionMatch,
} from './team-trials-utils';

// Engine v1 is alpha123's published solver, vendored verbatim (tools/sync-upstream-engine.mjs).
// Its glue takes a seed tuple where ours takes a pacemaker, and it emits only p/v/hp/sk/sdly/dh
// per run -- no pacerGap, position-keep, dueling or lead-competition telemetry, and no allruns.
// The panes that render those check `engine` and show an unavailable state rather than blanks.
// Upstream's HorseState carries `popularity` and `samplePolicies`; ours does not (see
// components/HorseDefTypes). Rather than patch the vendored glue, widen the horse at the
// boundary. skills stays an Immutable Map because the v1 glue calls .keys()/.values() on it.
function toV1Horse(uma: any) {
	if (uma == null) return uma;
	const base = typeof uma.toObject === 'function' ? uma.toObject() : {...uma};
	return {...base, popularity: base.popularity ?? 1, samplePolicies: base.samplePolicies ?? ImmMap()};
}

function pickEngine(options: any) {
	const v1 = options?.engine === 'v1';
	return {
		v1,
		runComparison: v1 ? runComparisonV1 : runComparison,
		runHpCalc: v1 ? runHpCalcV1 : runHpCalc,
		// 6th positional arg: seed tuple for v1, pacemaker HorseState for v2
		sixth: (pacer: any, seed: any) => v1 ? [(seed ?? 0) >>> 0, 0] as [number, number] : pacer,
		horse: (uma: any) => v1 ? toV1Horse(uma) : uma
	};
}

/**
 * Merge skill activation maps from two result sets
 */
function mergeSkillMaps(map1: any, map2: any) {
	const obj1 = map1 instanceof Map ? Object.fromEntries(map1) : (map1 || {});
	const obj2 = map2 instanceof Map ? Object.fromEntries(map2) : (map2 || {});
	const merged = { ...obj1 };
	Object.entries(obj2).forEach(([skillId, values]: [string, any]) => {
		merged[skillId] = [...(merged[skillId] || []), ...(values || [])];
	});
	return merged;
}

/**
 * Merge two result sets into one (memory-efficient version)
 * Only merges statistics, not full result arrays
 */
function mergeResults(results1: any, results2: any) {
	const n1 = results1.sampleCount || 0;
	const n2 = results2.sampleCount || 0;
	const totalCount = n1 + n2;

	// Weighted mean calculation
	const combinedMean = totalCount > 0
		? (results1.mean * n1 + results2.mean * n2) / totalCount
		: 0;

	// Use the newer result's median as approximation (more samples = better estimate)
	const newMedian = n2 > n1 ? results2.median : results1.median;

	// Keep runData from the result with more samples (more accurate)
	const runData = n2 > n1 ? (results2.runData || results1.runData) : (results1.runData || results2.runData);

	return {
		id: results1.id,
		results: [], // Empty - detailed data not needed
		runData, // Keep runData for track visualization
		min: Math.min(results1.min, results2.min),
		max: Math.max(results1.max, results2.max),
		mean: combinedMean,
		median: newMedian,
		sampleCount: totalCount
	};
}

/**
 * Convert incoming plain JS uma object to HorseState with Immutable.js structures
 */
function convertToHorseState(uma: any): HorseState {
	return new HorseState(uma)
		.set('skills', fromJS(uma.skills))
		.set('forcedSkillPositions', ImmMap(uma.forcedSkillPositions || {}));
}

/**
 * Run comparison simulation with progressive updates
 */
function runCompare({ nsamples, course, racedef, courses, uma1, uma2, pacer, options }: {
	nsamples: number;
	course: any;
	racedef: any;
	courses?: { course: any; racedef: any }[];
	uma1: any;
	uma2: any;
	pacer: any;
	options: any;
}) {
	const startTime = performance.now();

	// Convert plain JS objects to HorseState with Immutable structures
	const uma1_ = convertToHorseState(uma1);
	const uma2_ = convertToHorseState(uma2);
	const pacer_ = pacer ? convertToHorseState(pacer) : null;

	const compareOptions = { ...options, mode: 'compare' };
	const engine = pickEngine(options);
	const courseRuns = courses?.length ? courses : [{ course, racedef }];
	const totalSamples = courses?.length ? getTeamTrialSampleCount(nsamples, courseRuns.length) : nsamples;
	const runComparisonRound = (requestedSamples: number) => {
		const roundSamples = courses?.length
			? getTeamTrialSampleCount(requestedSamples, courseRuns.length)
			: requestedSamples;
		const samplesPerCourse = roundSamples / courseRuns.length;
		const courseResults = courseRuns.map((entry, courseIndex) => {
			const courseSeed = courses?.length
				? ((options?.seed ?? 0) + courseIndex) >>> 0
				: options?.seed;
			const courseOptions = courses?.length
				? { ...compareOptions, seed: courseSeed }
				: compareOptions;
			return engine.runComparison(
				samplesPerCourse,
				entry.course,
				entry.racedef,
				engine.horse(uma1_),
				engine.horse(uma2_),
				engine.sixth(pacer_, courseSeed),
				courseOptions
			);
		});
		return {
			...courseResults[0],
			results: courseResults.flatMap(result => result.results).sort((a: number, b: number) => a - b),
		};
	};

	// Progressive sampling: start small and increase
	// This provides early feedback to the UI
	let results: any;
	for (let n = Math.min(20, totalSamples), mul = 6; n < totalSamples; n = Math.min(n * mul, totalSamples), mul = Math.max(mul - 1, 2)) {
		const roundSamples = courses?.length
			? getTeamTrialSampleCount(n, courseRuns.length)
			: n;
		if (roundSamples < totalSamples) {
			results = runComparisonRound(roundSamples);
			self.postMessage({ type: 'compare', results });
		}
	}

	// Final run with full sample count
	results = runComparisonRound(totalSamples);
	self.postMessage({ type: 'compare', results });
	self.postMessage({ type: 'compare-complete' });

	const elapsed = performance.now() - startTime;
	const runsPerSec = (totalSamples / elapsed) * 1000;
	console.log(`[V2 RaceSimulator] Completed ${totalSamples} runs in ${elapsed.toFixed(2)}ms (${runsPerSec.toFixed(0)} runs/sec)`);
}

/**
 * Merge two result sets (for chart mode progressive refinement)
 */
function mergeResultSets(data1: Map<string, any>, data2: Map<string, any>) {
	data2.forEach((r, id) => {
		if (data1.has(id)) {
			data1.set(id, mergeResults(data1.get(id), r));
		} else {
			data1.set(id, r);
		}
	});
}

function weightedMedian(values: { value: number; weight: number }[], totalWeight: number): number {
	if (values.length === 0 || totalWeight <= 0) return 0;
	values.sort((a, b) => a.value - b.value);
	const midpoint = totalWeight / 2;
	let accumulated = 0;
	for (let i = 0; i < values.length; i++) {
		accumulated += values[i].weight;
		if (accumulated > midpoint) return values[i].value;
		if (Math.abs(accumulated - midpoint) < 1e-12 && i + 1 < values.length) {
			return (values[i].value + values[i + 1].value) / 2;
		}
	}
	return values[values.length - 1].value;
}

/**
 * Run one round of chart testing for a skill list
 */
function runChartRound(
	nsamples: number,
	skills: string[],
	course: any,
	racedef: any,
	uma: HorseState,
	pacer: HorseState | null,
	options: any,
	skillmeta: any,
	courses?: { course: any; racedef: any }[],
	skillConditions?: Record<string, SkillConditionMatch>
) {
	const data = new Map();

	skills.forEach(id => {
		const newSkillGroupId = skillmeta[id]?.groupId;
		let skillsToUse = uma.skills;

		// Remove existing skills in same group
		if (newSkillGroupId) {
			skillsToUse = skillsToUse.filter((existingSkillId: string) => {
				const existingGroupId = skillmeta[existingSkillId]?.groupId;
				return existingGroupId !== newSkillGroupId;
			});
		}

		// Add test skill to uma
		const withSkill = uma.set('skills', skillsToUse.set(skillmeta[id].groupId, id));

		const chartEngine = pickEngine(options);
		const condition = skillConditions?.[id];
		const courseRuns = courses?.length ? courses : [{ course, racedef }];
		const samplesPerCourse = nsamples / courseRuns.length;
		const variants = condition?.variants ?? [{ overrides: {}, probability: 1 }];
		const weightedValues: { value: number; weight: number }[] = [];
		let weightedMean = 0;
		let totalProbability = 0;
		let minimum = Infinity;
		let maximum = -Infinity;
		let sampleCount = 0;
		let runData: any = null;
		variants.forEach((variant, variantIndex) => {
			const variantResults: number[] = [];
			courseRuns.forEach((entry, courseIndex) => {
				const matchedRace = { ...entry.racedef, ...variant.overrides };
				const seed = ((options?.seed ?? 0) + variantIndex * courseRuns.length + courseIndex) >>> 0;
				const seededOptions = { ...options, seed };
				const run = chartEngine.runComparison(
					samplesPerCourse,
					entry.course,
					matchedRace,
					chartEngine.horse(uma),
					chartEngine.horse(withSkill),
					chartEngine.sixth(pacer, seed),
					seededOptions
				);
				variantResults.push(...run.results);
				runData = runData ?? run.runData;
			});
			variantResults.sort((a, b) => a - b);
			const variantMean = variantResults.reduce((sum, value) => sum + value, 0) / variantResults.length;
			weightedMean += variantMean * variant.probability;
			totalProbability += variant.probability;
			sampleCount += variantResults.length;
			if (variantResults.length > 0) {
				minimum = Math.min(minimum, variantResults[0]);
				maximum = Math.max(maximum, variantResults[variantResults.length - 1]);
				variantResults.forEach(value => weightedValues.push({
					value,
					weight: variant.probability / variantResults.length,
				}));
			}
		});

		const conditionalMean = totalProbability > 0 ? weightedMean / totalProbability : 0;
		const conditionalMedian = weightedMedian(weightedValues, totalProbability);
		const weightedStats = applyConditionProbability(conditionalMean, conditionalMedian, totalProbability);
		if (totalProbability < 1) {
			minimum = Math.min(minimum, 0);
			maximum = Math.max(maximum, 0);
		}

		// Store stats and runData (needed for track visualization)
		data.set(id, {
			id,
			results: [], // Empty - detailed data not needed
			runData, // Keep runData for skill activation visualization
			min: minimum,
			max: maximum,
			mean: weightedStats.mean,
			median: weightedStats.median,
			sampleCount
		});
	});

	return data;
}

/**
 * Run chart mode simulation
 *
 * Two strategies available:
 *
 * DEFAULT (v2-variance): 1.17x faster than kachi, same accuracy
 * - Round 1: 25 samples per skill
 * - Combined filter: max > 0.1L AND variance > 0.1L
 * - Round 2: 175 samples for promising skills (200 total)
 *
 * FAST MODE (v2-turbo): 2x faster, lower accuracy
 * - Single round: 50 samples per skill, no filtering
 * - Best for mobile/low-end devices or quick estimates
 *
 * Benchmark results (30 skills on Kyoto 3000m):
 *   kachi (3-round): 9496ms baseline
 *   v2-variance:     8144ms = 1.17x faster
 *   v2-turbo:        4523ms = 2.10x faster
 */
function runChart({ skills, course, racedef, courses, targetSamples, skillConditions, uma, pacer, options, skillmeta, workerId, fastMode }: {
	skills: string[];
	course: any;
	racedef: any;
	courses?: { course: any; racedef: any }[];
	targetSamples?: number;
	skillConditions?: Record<string, SkillConditionMatch>;
	uma: any;
	pacer: any;
	options: any;
	skillmeta: any;
	workerId: number;
	fastMode?: boolean;
}) {
	// Convert plain JS objects to HorseState with Immutable structures
	const uma_ = convertToHorseState(uma);
	const pacer_ = pacer ? convertToHorseState(pacer) : null;

	const chartOptions = { ...options, mode: 'chart' };

	if (courses?.length) {
		const requestedSamples = Math.max(1, targetSamples ?? (fastMode ? 50 : 200));
		const totalSamples = getTeamTrialSampleCount(requestedSamples, courses.length);
		self.postMessage({ type: 'chart-progress', workerId, round: 1, total: 1 });
		const results = runChartRound(
			totalSamples, skills, course, racedef, uma_, pacer_, chartOptions, skillmeta, courses, skillConditions
		);
		self.postMessage({ type: 'chart-update', workerId, results });
		self.postMessage({ type: 'chart-complete', workerId });
		return;
	}

	if (fastMode) {
		// FAST MODE: Single round, 50 samples, no filtering
		// 2x faster than kachi, best for mobile/low-end devices
		self.postMessage({ type: 'chart-progress', workerId, round: 1, total: 1 });
		const results = runChartRound(50, skills, course, racedef, uma_, pacer_, chartOptions, skillmeta, undefined, skillConditions);
		self.postMessage({ type: 'chart-update', workerId, results });
		self.postMessage({ type: 'chart-complete', workerId });
		return;
	}

	// DEFAULT MODE: 2-round progressive refinement (v2-variance strategy)
	// Round 1: 25 samples per skill (fast initial scan, same as kachi)
	self.postMessage({ type: 'chart-progress', workerId, round: 1, total: 2 });
	let results = runChartRound(25, skills, course, racedef, uma_, pacer_, chartOptions, skillmeta, undefined, skillConditions);
	self.postMessage({ type: 'chart-update', workerId, results });

	// Combined filter (equivalent to kachi's two-stage filtering):
	// - max > 0.1L: skill shows meaningful positive gain
	// - variance > 0.1L: skill needs more samples for accuracy
	// This combines kachi's round 1 and round 2 filters into one

	skills = skills.filter(id => {
		const r = results.get(id);
		return r && r.max > 0.1 && Math.abs(r.max - r.min) > 0.1;
	});

	// Round 2: 175 samples for promising skills (200 total, same final accuracy as kachi)
	self.postMessage({ type: 'chart-progress', workerId, round: 2, total: 2 });
	const update = runChartRound(175, skills, course, racedef, uma_, pacer_, chartOptions, skillmeta, undefined, skillConditions);
	mergeResultSets(results, update);
	self.postMessage({ type: 'chart-update', workerId, results });

	self.postMessage({ type: 'chart-complete', workerId });
}

/**
 * Run stamina calculator simulation
 */
function runHpCalcWorker({ nsamples, course, racedef, uma, pacer, options }: {
	nsamples: number;
	course: any;
	racedef: any;
	uma: any;
	pacer: any;
	options: any;
}) {
	const uma_ = convertToHorseState(uma);
	const pacer_ = pacer ? convertToHorseState(pacer) : null;
	const hpEngine = pickEngine(options);
	const results = hpEngine.runHpCalc(nsamples, course, racedef, hpEngine.horse(uma_),
		hpEngine.sixth(pacer_, options?.seed), options);
	self.postMessage({ type: 'hpcalc', results });
	self.postMessage({ type: 'hpcalc-complete' });
}

/**
 * Message handler
 */
self.addEventListener('message', function(e: MessageEvent) {
	const { msg, data } = e.data;

	switch (msg) {
		case 'compare':
			runCompare(data);
			break;

		case 'chart':
			runChart(data);
			break;

		case 'hpcalc':
			runHpCalcWorker(data);
			break;

		case 'chart-cancel':
			// TODO: Implement cancellation logic if needed
			break;

		default:
			console.warn(`[V2 Worker] Unknown message type: ${msg}`);
	}
});
