import test from 'tape';
import { addImplicitZeroHintSkills, calculateOwnedSkillCost, calculateSkillCost, getSkillsForChartList, isSkillHiddenByOwned, skillGroups } from './skill-chart-utils';
import skillmeta from '../../skill_meta.json';

test('skill list modes select imported hints, inherited skills, and saved custom skills', t => {
	const hintSkills = getSkillsForChartList('hints', new Map([['200011', 2], ['200142', 0]]), [], false);
	t.deepEqual(hintSkills, ['200011', '200142']);

	const inheritedSkills = getSkillsForChartList('inherited', new Map(), [], false);
	t.ok(inheritedSkills.length > 0);
	t.ok(inheritedSkills.every(id => id[0] === '9'));

	const customSkills = getSkillsForChartList('custom:my-list', new Map(), [
		{ id: 'my-list', name: 'My list', skillIds: ['200011', 'unknown'] },
	], false);
	t.deepEqual(customSkills, ['200011']);
	t.end();
});

test('implicit zero-level hints include prerequisites and awakenings but not the innate unique skill', t => {
	const hints = addImplicitZeroHintSkills({
		'200531': 1,
		'201662': 1,
		'202371': 3,
		'200202': 4,
	}, '103401');

	for (const skillId of ['200532', '201661', '202372', '201452', '201611', '201612']) {
		t.equal(hints[skillId], 0, `${skillId} is included at hint level 0`);
	}
	t.notOk(Object.prototype.hasOwnProperty.call(hints, '100341'), 'the selected Uma unique skill is not added as a hint');
	t.equal(hints['200202'], 4, 'an existing hint level is preserved');

	const hintSkills = getSkillsForChartList('hints', new Map(Object.entries(hints)), [], false);
	t.ok(hintSkills.includes('200532'));
	t.ok(hintSkills.includes('201661'));
	t.ok(hintSkills.includes('200202'));
	t.notOk(hintSkills.includes('100341'));

	const otherUmaHints = addImplicitZeroHintSkills({}, '100101');
	t.equal(otherUmaHints['200512'], 0, 'awakening skills are read from the selected outfit');
	t.notOk(Object.prototype.hasOwnProperty.call(otherUmaHints, '100011'), 'a selected Uma unique skill is not added as a hint');
	t.end();
});

test('imported hints discard unreleased skills before inferring prerequisites', t => {
	const hints = addImplicitZeroHintSkills({
		'106701211': 1,
		'111901111': 1,
	}, '103401');

	for (const skillId of ['106701211', '111901111', '200014']) {
		t.notOk(Object.prototype.hasOwnProperty.call(hints, skillId), `${skillId} is not added to the available hint list`);
	}
	t.end();
});

test('same-rarity skill continuations inherit the shared hint level', t => {
	const zeroLevelHints = addImplicitZeroHintSkills({ '201452': 0 }, '');
	t.equal(zeroLevelHints['201451'], 0, 'End Closer Straightaways ◎ is included at level 0');

	const leveledHints = addImplicitZeroHintSkills({ '201452': 3 }, '');
	t.equal(leveledHints['201451'], 3, 'End Closer Straightaways ◎ shares the hint level');
	t.end();
});

test('skill SP cost deducts owned prerequisites and Fast Learner discount', t => {
	const chain = [...skillGroups.entries()].find(([, ids]) => ids.length > 1);
	t.ok(chain, 'skill data includes an upgrade chain');
	if (!chain) {
		t.end();
		return;
	}

	const [groupId, ids] = chain;
	const baseSkill = ids[0];
	const upgrade = ids[1];
	const regularCost = calculateSkillCost(upgrade, new Map(), new Map());
	const prerequisiteOwnedCost = calculateSkillCost(upgrade, new Map(), new Map([[groupId, baseSkill]]));
	const alreadyOwnedCost = calculateSkillCost(upgrade, new Map(), new Map([[groupId, upgrade]]));
	const fastLearnerCost = calculateSkillCost(upgrade, new Map(), new Map(), true);

	t.ok(regularCost > 0);
	t.ok(prerequisiteOwnedCost < regularCost);
	t.equal(alreadyOwnedCost, 0);
	t.ok(fastLearnerCost < regularCost);
	t.end();
});

test('owned skill SP total counts prerequisite tiers once', t => {
	const chain = [...skillGroups.entries()].find(([, ids]) => ids.length > 1);
	t.ok(chain, 'skill data includes an upgrade chain');
	if (!chain) {
		t.end();
		return;
	}

	const [, ids] = chain;
	const meta = skillmeta as Record<string, { baseCost?: number }>;
	const expected = (meta[ids[0]]?.baseCost ?? 0) + (meta[ids[1]]?.baseCost ?? 0);
	t.equal(calculateOwnedSkillCost([ids[0]]), meta[ids[0]]?.baseCost ?? 0);
	t.equal(calculateOwnedSkillCost([ids[1]]), expected);
	t.equal(calculateOwnedSkillCost([ids[0], ids[1]]), expected);
	t.end();
});

test('owned skill SP total applies hint and Fast Learner discounts', t => {
	const skillId = '200142';
	const baseCost = (skillmeta as Record<string, { baseCost?: number }>)[skillId]?.baseCost ?? 0;
	const hints = new Map([[skillId, 3]]);

	t.equal(calculateOwnedSkillCost([skillId], hints), Math.floor(baseCost * 0.7));
	t.equal(calculateOwnedSkillCost([skillId], hints, true), Math.floor(baseCost * 0.7 * 0.9));
	t.end();
});

test('Hide Owned keeps takable skill upgrades visible', t => {
	const groupId = skillmeta['200142']?.groupId;
	if (!groupId) {
		t.fail('Non-Standard Distance ○ has a skill group');
		t.end();
		return;
	}
	const owned = new Map<string, string>([[groupId, '200142']]);

	t.ok(isSkillHiddenByOwned('200142', owned), 'hides the owned skill');
	t.notOk(isSkillHiddenByOwned('200141', owned), 'keeps the upgrade available');
	t.end();
});
