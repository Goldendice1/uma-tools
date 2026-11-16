import test from 'tape';
import {
	applyConditionProbability,
	getSkillConditionMatches,
	getTeamTrialCourseIds,
	getTeamTrialSampleCount,
	TEAM_TRIAL_CATEGORIES,
} from './team-trials-utils';

test('Team Trials uses Global Sprint terminology for short-distance courses', t => {
	t.equal(TEAM_TRIAL_CATEGORIES.find(category => category.value === 'short')?.label, 'Sprint');
	t.end();
});

test('Team Trials selects the matching surface and distance category', t => {
	const courses = {
		'10103': { surface: 1 as const, distanceType: 1 as const },
		'10101': { surface: 1 as const, distanceType: 1 as const },
		'10201': { surface: 2 as const, distanceType: 1 as const },
		'10301': { surface: 2 as const, distanceType: 2 as const },
	};

	t.deepEqual(getTeamTrialCourseIds(courses, 'short'), ['10101', '10103']);
	t.deepEqual(getTeamTrialCourseIds(courses, 'dirt'), ['10201', '10301']);
	t.end();
});

test('Team Trials rounds the chosen sample total up to a complete track cycle', t => {
	t.equal(getTeamTrialSampleCount(500, 17), 510);
	t.equal(getTeamTrialSampleCount(500, 50), 500);
	t.throws(() => getTeamTrialSampleCount(0, 17), /positive integer/);
	t.end();
});

test('condition-matched skill data records overrides and occurrence probability', t => {
	const matches = getSkillConditionMatches({
		seasonal: { alternatives: [{ condition: 'season==2&weather==3&ground_condition==1&ground_type==1' }] },
		multipleQualities: { alternatives: [{ condition: 'ground_condition==2@ground_condition==3@ground_condition==4' }] },
		surfaceOnly: { alternatives: [{ condition: 'ground_type==2' }] },
		unconditional: { alternatives: [{ condition: 'phase==2' }] },
	});

	t.deepEqual(matches.seasonal.variants[0].overrides, {
		season: 2,
		weather: 3,
		groundCondition: 1,
	});
	t.ok(Math.abs(matches.seasonal.variants[0].probability - 0.22 * 0.11 * 0.77) < 1e-12);
	t.deepEqual(matches.multipleQualities.variants.map(item => item.overrides), [
		{ groundCondition: 2 },
	]);
	t.ok(Math.abs(matches.multipleQualities.variants[0].probability - 0.23) < 1e-12);
	t.notOk(matches.surfaceOnly, 'surface conditions are not treated as random variants');
	t.notOk(matches.unconditional);
	t.end();
});

test('ground-condition probabilities combine only when other race conditions match', t => {
	const matches = getSkillConditionMatches({
		wet: {
			alternatives: [{
				condition: 'weather==3&ground_condition==3@weather==3&ground_condition==4@weather==2&ground_condition==4',
			}],
		},
	});

	t.deepEqual(matches.wet.variants.map(item => item.overrides), [
		{ weather: 3, groundCondition: 3 },
		{ weather: 2, groundCondition: 4 },
	]);
	t.ok(Math.abs(matches.wet.variants[0].probability - 0.0132) < 1e-12);
	t.ok(Math.abs(matches.wet.variants[1].probability - 0.015) < 1e-12);
	t.end();
});

test('condition weights use the supplied season and weather distributions', t => {
	const matches = getSkillConditionMatches({
		spring: { alternatives: [{ condition: 'season==1' }] },
		summer: { alternatives: [{ condition: 'season==2' }] },
		fall: { alternatives: [{ condition: 'season==3' }] },
		winter: { alternatives: [{ condition: 'season==4' }] },
		sunny: { alternatives: [{ condition: 'weather==1' }] },
		cloudy: { alternatives: [{ condition: 'weather==2' }] },
		rain: { alternatives: [{ condition: 'weather==3' }] },
		snow: { alternatives: [{ condition: 'weather==4' }] },
	});

	t.deepEqual(
		['spring', 'summer', 'fall', 'winter', 'sunny', 'cloudy', 'rain', 'snow']
			.map(id => matches[id].variants[0].probability),
		[0.4, 0.22, 0.12, 0.26, 0.58, 0.3, 0.11, 0.01]
	);
	t.end();
});

test('condition probability scales mean and only retains a likely median', t => {
	t.deepEqual(applyConditionProbability(4, 3, 0.25), { mean: 1, median: 0 });
	t.deepEqual(applyConditionProbability(4, 3, 0.6), { mean: 2.4, median: 3 });
	t.throws(() => applyConditionProbability(4, 3, 1.1), /between 0 and 1/);
	t.end();
});
