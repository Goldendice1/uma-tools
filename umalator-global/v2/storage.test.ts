import test from 'tape';
import { tryParseImportText } from '../../components/gameExportParser';
import { validateAndParseUmaJson } from './storage';

test('Umadump import adds prerequisite and awakening skills at level 0 without unrelated skills', t => {
	const exported = {
		single_mode_load_common: {
			chara_info: {
				card_id: 103401,
				rarity: 3,
				race_running_style: 4,
				proper_ground_turf: 7,
				proper_distance_short: 2,
				proper_distance_mile: 6,
				proper_distance_middle: 7,
				proper_distance_long: 7,
				proper_running_style_oikomi: 7,
				motivation: 3,
				speed: 1200,
				stamina: 800,
				power: 900,
				guts: 700,
				wiz: 1000,
				skill_array: [],
				skill_tips_array: [
					{ group_id: 20053, rarity: 2, level: 1 },
					{ group_id: 20166, rarity: 2, level: 1 },
					{ group_id: 20237, rarity: 2, level: 3 },
					{ group_id: 20001, rarity: 6, level: 1 },
				],
			},
		},
	};
	const converted = tryParseImportText(JSON.stringify(exported));
	const uma = validateAndParseUmaJson(converted);

	t.ok(uma, 'valid export is parsed');
	if (!uma) {
		t.end();
		return;
	}

	for (const skillId of ['200202', '200532', '201661', '202372', '201452', '201611', '201612']) {
		t.equal(uma.skillHints[skillId], 0, `${skillId} is available at level 0`);
	}
	for (const skillId of ['100341', '106701211', '111901111', '200014']) {
		t.notOk(Object.prototype.hasOwnProperty.call(uma.skillHints, skillId), `${skillId} is excluded from imported hints`);
	}
	t.end();
});
