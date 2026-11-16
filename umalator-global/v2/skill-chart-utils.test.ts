import test from 'tape';
import { calculateOwnedSkillCost, calculateSkillCost, getSkillsForChartList, isSkillHiddenByOwned, skillGroups } from './skill-chart-utils';
import skillmeta from '../../skill_meta.json';

test('skill list modes select imported hints, inherited skills, and saved custom skills', t => {
	const hintSkills = getSkillsForChartList('hints', new Map([['200011', 2]]), [], false);
	t.deepEqual(hintSkills, ['200011']);

	const inheritedSkills = getSkillsForChartList('inherited', new Map(), [], false);
	t.ok(inheritedSkills.length > 0);
	t.ok(inheritedSkills.every(id => id[0] === '9'));

	const customSkills = getSkillsForChartList('custom:my-list', new Map(), [
		{ id: 'my-list', name: 'My list', skillIds: ['200011', 'unknown'] },
	], false);
	t.deepEqual(customSkills, ['200011']);
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
