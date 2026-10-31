export interface SceneRow { scene_id: string; name: string; bg_key: string; interactables: string[]; enter_dialogue_id: string; next_scene_id?: string; interact_encounters?: Record<string, string>; map_node?: string; map_order?: number; map_title?: string; objective?: string; tags?: string[]; }
export interface DialogueLine { speaker: string; portrait_key: string; text: string; }
export interface ChoiceRow { choice_id: string; text: string; set_flag: string; value: number; followup_lines?: DialogueLine[]; }
export interface DialogueRow { dialogue_id: string; lines: DialogueLine[]; choices: ChoiceRow[]; next_dialogue_id?: string; start_encounter_id?: string; }
export interface EncounterRow { encounter_id: string; kind: string; enemy_ids: string[]; on_win_flow: string; }
export interface FlagRow { flag_id: string; default: number; note: string; }
export interface LinkRow { link_id: string; name: string; member_ids: string[]; unlock_flag: string; once_per_battle: boolean; }
export type MapPhase = 'scene' | 'pre_battle' | 'battle' | 'after_tutorial' | 'chapter_end';
export interface MapNodeRow { map_node: string; host_scene_id: string; map_phase: MapPhase; map_order: number; map_title: string; objective: string; tags: string[]; encounter_id?: string; reward_tip?: string; end_dialogue_id?: string; end_card_title?: string; end_card_body?: string; hook_scene_id?: string; }
export interface GameDb { mapNodes: MapNodeRow[]; scenes: Map<string, SceneRow>; dialogues: Map<string, DialogueRow>; encounters: Map<string, EncounterRow>; flags: FlagRow[]; links: LinkRow[]; }
