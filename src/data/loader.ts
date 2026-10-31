import type { GameDb, SceneRow, DialogueRow, EncounterRow, FlagRow, LinkRow, MapNodeRow } from './types';
const base = `${import.meta.env.BASE_URL}config/`;
async function get<T>(name: string): Promise<T> {
  const r = await fetch(base + name + '.json');
  if (!r.ok) throw new Error(`config load failed: ${name} (${r.status})`);
  return r.json() as Promise<T>;
}
const byKey = <T, K extends keyof T>(rows: T[], k: K) => new Map(rows.map(r => [r[k] as unknown as string, r]));
export async function loadGameDb(): Promise<GameDb> {
  const [scenes, dialogues, encounters, flags, links, mapNodes] = await Promise.all([
    get<SceneRow[]>('scenes'), get<DialogueRow[]>('dialogues'), get<EncounterRow[]>('encounters'), get<FlagRow[]>('flags'), get<LinkRow[]>('links'), get<MapNodeRow[]>('map_nodes')]);
  return { scenes: byKey(scenes, 'scene_id'), dialogues: byKey(dialogues, 'dialogue_id'), encounters: byKey(encounters, 'encounter_id'), flags, links, mapNodes: [...mapNodes].sort((a, b) => a.map_order - b.map_order) };
}
/** bg_key "W0/scenes/SC_01_OPEN" -> public/W0/scenes/SC_01_OPEN_v0.png */
export const resolveBg = (bgKey: string) => `${import.meta.env.BASE_URL}${bgKey}_v0.png`;
