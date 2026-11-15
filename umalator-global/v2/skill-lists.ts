import skilldata from '../skill_data.json';

export interface SavedSkillList {
	id: string;
	name: string;
	skillIds: string[];
}

export const SKILL_LIST_STORAGE_KEY = 'umalator_v2_skillLists';

export function loadSavedSkillLists(): SavedSkillList[] {
	try {
		const raw = localStorage.getItem(SKILL_LIST_STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			console.error('[V2] Saved skill lists are not an array');
			return [];
		}

		return parsed.flatMap((item): SavedSkillList[] => {
			if (!item || typeof item !== 'object') return [];
			const list = item as Partial<SavedSkillList>;
			if (typeof list.id !== 'string' || typeof list.name !== 'string' || !Array.isArray(list.skillIds)) {
				return [];
			}
			return [{
				id: list.id,
				name: list.name,
				skillIds: [...new Set(list.skillIds.filter((id): id is string =>
					typeof id === 'string' && Object.prototype.hasOwnProperty.call(skilldata, id)
				))],
			}];
		});
	} catch (error) {
		console.error('[V2] Failed to load saved skill lists:', error);
		return [];
	}
}

export function saveSkillLists(lists: SavedSkillList[]): void {
	try {
		localStorage.setItem(SKILL_LIST_STORAGE_KEY, JSON.stringify(lists));
	} catch (error) {
		console.error('[V2] Failed to save skill lists:', error);
	}
}
