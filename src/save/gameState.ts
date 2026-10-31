import type { FlagRow } from '../data/types';
export const SAVE_VERSION = 2;
const KEY = 'guichi-lu.save';
export interface BattleState { encounter_id: string; turn: number; enemy_hp: number; party_hp: number; }
/** Image-pixel position on a walkmap (SC_03: origin top-left, y down). */
export interface WalkPos { scene_id: string; x: number; y: number; }
export interface GameState {
  flow_node_id: string;
  scene_id: string;
  flags: Record<string, number>;
  party_ids: string[];
  battle?: BattleState;
  visited_scene_ids?: string[];
  map_node?: string;
  visited_map_nodes?: string[];
  walk_pos?: WalkPos;
  triggered_ids?: string[];
  /** 已播完的 dialogue_id。TR_N6_END_CARD 的 gate 读 DLG_CHOICE_01，不另开 flag。 */
  dialogue_done?: string[];
  save_version: number;
}
export function newGame(flags: FlagRow[]): GameState {
  return { flow_node_id: 'FLOW_START', scene_id: 'SC_01_OPEN', flags: Object.fromEntries(flags.map(f => [f.flag_id, f.default])), party_ids: ['CH_A'], visited_scene_ids: [], map_node: 'N1', visited_map_nodes: ['N1'], triggered_ids: [], dialogue_done: [], save_version: SAVE_VERSION };
}
export function saveGame(s: GameState) { localStorage.setItem(KEY, JSON.stringify(s)); }
export function loadGame(): GameState | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as GameState | null;
    if (!s) return null;
    if (s.save_version === 1) { s.save_version = SAVE_VERSION; s.triggered_ids ??= []; return s; }
    return s.save_version === SAVE_VERSION ? s : null;
  } catch { return null; }
}
export const clearSave = () => localStorage.removeItem(KEY);
