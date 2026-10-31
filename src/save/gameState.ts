import type { FlagRow } from '../data/types';
export const SAVE_VERSION = 1;
const KEY = 'guichi-lu.save';
export interface BattleState { encounter_id: string; turn: number; enemy_hp: number; party_hp: number; }
export interface GameState { flow_node_id: string; scene_id: string; flags: Record<string, number>; party_ids: string[]; battle?: BattleState; visited_scene_ids?: string[]; map_node?: string; visited_map_nodes?: string[]; save_version: number; }
export function newGame(flags: FlagRow[]): GameState {
  return { flow_node_id: 'FLOW_START', scene_id: 'SC_01_OPEN', flags: Object.fromEntries(flags.map(f => [f.flag_id, f.default])), party_ids: ['CH_A'], visited_scene_ids: [], map_node: 'N1', visited_map_nodes: ['N1'], save_version: SAVE_VERSION };
}
export function saveGame(s: GameState) { localStorage.setItem(KEY, JSON.stringify(s)); }
export function loadGame(): GameState | null {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as GameState | null; return s && s.save_version === SAVE_VERSION ? s : null; } catch { return null; }
}
export const clearSave = () => localStorage.removeItem(KEY);
