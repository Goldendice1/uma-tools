import { Fragment, h } from 'preact';
import { createPortal } from 'preact/compat';
import { useState } from 'preact/hooks';
import { SkillPickerModal } from './skills';
import { Button } from './components';
import type { SavedSkillList } from './skill-lists';

interface SkillListManagerProps {
	lists: SavedSkillList[];
	onListsChange: (lists: SavedSkillList[]) => void;
	onSaved: (id: string) => void;
	hideNotInGame: boolean;
}

export function SkillListManager({ lists, onListsChange, onSaved, hideNotInGame }: SkillListManagerProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [isPickerOpen, setIsPickerOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [skillIds, setSkillIds] = useState<string[]>([]);
	const [error, setError] = useState('');

	function startNewList() {
		setEditingId(null);
		setName('');
		setSkillIds([]);
		setError('');
		setIsOpen(true);
	}

	function editList(list: SavedSkillList) {
		setEditingId(list.id);
		setName(list.name);
		setSkillIds(list.skillIds);
		setError('');
		setIsOpen(true);
	}

	function close() {
		setIsOpen(false);
		setIsPickerOpen(false);
	}

	function save() {
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError('Enter a name for this list.');
			return;
		}
		if (lists.some(list => list.id !== editingId && list.name.toLowerCase() === trimmedName.toLowerCase())) {
			setError('A list with this name already exists.');
			return;
		}
		if (skillIds.length === 0) {
			setError('Choose at least one skill.');
			return;
		}

		const id = editingId ?? `skill-list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const nextList = { id, name: trimmedName, skillIds: [...new Set(skillIds)] };
		const nextLists = editingId
			? lists.map(list => list.id === editingId ? nextList : list)
			: [...lists, nextList];
		onListsChange(nextLists);
		onSaved(id);
		close();
	}

	const manager = isOpen && createPortal(
		<div class="v2-skill-picker-overlay" onClick={close}>
			<div class="v2-skill-list-manager" onClick={event => event.stopPropagation()}>
				<div class="v2-skill-list-manager-header">
					<h2>{editingId ? 'Edit skill list' : 'Create skill list'}</h2>
					<button type="button" class="v2-skill-picker-close" onClick={close} aria-label="Close">×</button>
				</div>
				<div class="v2-skill-list-manager-body">
					<div class="v2-skill-list-saved">
						<strong>Saved lists</strong>
						{lists.length === 0 && <span>No custom lists yet.</span>}
						{lists.map(list => (
							<div class="v2-skill-list-saved-row" key={list.id}>
								<span>{list.name} ({list.skillIds.length})</span>
								<div>
									<button type="button" onClick={() => editList(list)}>Edit</button>
									<button type="button" onClick={() => onListsChange(lists.filter(item => item.id !== list.id))}>Delete</button>
								</div>
							</div>
						))}
					</div>
					<label class="v2-skill-list-name">
						List name
						<input value={name} onInput={event => setName((event.target as HTMLInputElement).value)} />
					</label>
					<div class="v2-skill-list-selection">
						<span>{skillIds.length} skills selected</span>
						<Button variant="secondary" size="sm" onClick={() => setIsPickerOpen(true)}>Choose skills</Button>
					</div>
					{error && <div class="v2-skill-list-error" role="alert">{error}</div>}
				</div>
				<div class="v2-skill-list-manager-footer">
					<Button variant="secondary" size="sm" onClick={close}>Cancel</Button>
					<Button variant="primary" size="sm" onClick={save}>{editingId ? 'Save changes' : 'Create list'}</Button>
				</div>
			</div>
		</div>,
		document.body
	);

	return (
		<>
			<Button variant="secondary" size="sm" onClick={startNewList}>Manage lists</Button>
			{manager}
			<SkillPickerModal
				isOpen={isPickerOpen}
				onClose={() => setIsPickerOpen(false)}
				onSelect={id => setSkillIds(previous =>
					previous.includes(id) ? previous.filter(skillId => skillId !== id) : [...previous, id]
				)}
				selectedSkills={skillIds}
				hideNotInGame={hideNotInGame}
				multiSelect
				confirmLabel="Done"
			/>
		</>
	);
}
