import type { EncounterRow } from '../data/types';
import type { BattleState } from '../save/gameState';
export type BattleResult = 'win' | 'retreat' | 'lose' | null;
export function startBattle(enc: EncounterRow): BattleState {
  return { encounter_id: enc.encounter_id, turn: 1, enemy_hp: 30 * enc.enemy_ids.length, party_hp: 40 };
}
/** One player attack + enemy counter. Returns outcome or null if ongoing. */
export function attackTurn(b: BattleState): { log: string; result: BattleResult } {
  const dmg = 8 + Math.floor(Math.random() * 6);
  b.enemy_hp = Math.max(0, b.enemy_hp - dmg);
  if (b.enemy_hp === 0) return { log: `沈归迟出剑，造成 ${dmg} 伤害。妖物溃散！`, result: 'win' };
  const back = 3 + Math.floor(Math.random() * 4);
  b.party_hp = Math.max(0, b.party_hp - back); b.turn++;
  return { log: `造成 ${dmg} 伤害；妖物反扑 ${back}。`, result: b.party_hp === 0 ? 'lose' : null };
}
