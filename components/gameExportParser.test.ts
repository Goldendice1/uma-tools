import test from 'tape';
import { skillHintsFromTips, tryParseImportText } from './gameExportParser';

const umadump = {
	single_mode_load_common: {
		chara_info: {
			card_id: 100101,
			rarity: 3,
			race_running_style: 1,
			proper_ground_turf: 8,
			proper_distance_short: 7,
			proper_distance_mile: 6,
			proper_distance_middle: 5,
			proper_distance_long: 4,
			proper_running_style_nige: 7,
			motivation: 5,
			speed: 1200,
			stamina: 800,
			power: 900,
			guts: 700,
			wiz: 1000,
			fans: 123456,
			skill_point: 250,
			fast_learner: true,
			skill_array: [{ skill_id: 200011, level: 1 }],
			skill_tips_array: [
				{ group_id: 20001, rarity: 1, level: 2 },
				{ group_id: 20001, rarity: 1, level: 4 },
				{ group_id: 20002, rarity: 2, level: 3 },
				{ group_id: 20001, rarity: 2, level: 5 },
				{ group_id: 20003, rarity: 1, level: 0 },
			],
		},
	},
};

test('Umadump import reads the wrapped trainee and career data', t => {
	const parsed = tryParseImportText(JSON.stringify(umadump));

	t.equal(parsed.outfitId, '100101');
	t.notOk('fans' in parsed, 'fan count is ignored when the UI does not model fan thresholds');
	t.equal(parsed.remainingSP, 250);
	t.equal(parsed.fastLearner, true);
	t.deepEqual(parsed.skillTips, [
		{ group_id: 20001, rarity: 1, level: 2 },
		{ group_id: 20001, rarity: 1, level: 4 },
		{ group_id: 20002, rarity: 2, level: 3 },
		{ group_id: 20001, rarity: 2, level: 5 },
		{ group_id: 20003, rarity: 1, level: 0 },
	]);

	const hints = skillHintsFromTips(parsed.skillTips, {
		whiteA: { rarity: 1 },
		whiteB: { rarity: 1 },
		gold: { rarity: 2 },
		zeroHint: { rarity: 1 },
	}, {
		whiteA: { groupId: '20001' },
		whiteB: { groupId: '20001' },
		gold: { groupId: '20002' },
		zeroHint: { groupId: '20003' },
	});
	t.deepEqual(hints, { whiteA: 4, whiteB: 4, gold: 3, zeroHint: 0 });
	t.end();
});
