import type { MapNodeRow } from '../data/types';
import type { FlowController } from '../flow/flowController';
/**
 * 章节地图（灰盒，数据 = 苏禾 map_nodes.json v0.2，N1–N6，自下而上；SC_05_BOSS 不入图）。
 * 进度按 map_node 记（state.visited_map_nodes / map_node），因 N3/N4/N5 同 host SC_03_TOWN。
 * 解锁：map_order ≤ 已到达最远者；当前 = state.map_node。
 * 点击：N1/N2/N3 → goto(host)；N4 未胜 → 回 SC_03 开战，已胜 → 同 N5；N5 → 战后对白+奖励；N6 → 结束卡。
 */
export type NodeState = 'locked' | 'reached' | 'current';
export function nodeStates(nodes: MapNodeRow[], flow: FlowController): Record<string, NodeState> {
  const far = flow.farthestOrder(), cur = flow.state.map_node ?? 'N1';
  const out: Record<string, NodeState> = {};
  for (const n of nodes) out[n.map_node] = n.map_node === cur ? 'current' : n.map_order <= far ? 'reached' : 'locked';
  return out;
}
export function enterNode(n: MapNodeRow, flow: FlowController, toast: (t: string) => void = () => {}) {
  const won = !!flow.state.flags['tutorial_won'];
  switch (n.map_phase) {
    case 'scene': return void flow.goto(n.host_scene_id);
    case 'pre_battle': if (won) toast('已调查'); return void flow.goto(n.host_scene_id);
    case 'battle':
      if (won) return void flow.replayAfterTutorial();
      return flow.battleAt(n.host_scene_id, n.encounter_id ?? 'ENC_TUTORIAL_01');
    case 'after_tutorial': return void flow.replayAfterTutorial();
    case 'chapter_end': return flow.chapterEnd();
  }
}
/** 地点名字卡：key 可为 map_node，或 scene_id（取该 host 的 scene/pre_battle 节点） */
export const locationTitle = (nodes: MapNodeRow[], key: string) =>
  (nodes.find(n => n.map_node === key) ?? nodes.find(n => n.host_scene_id === key && (n.map_phase === 'scene' || n.map_phase === 'pre_battle')))?.map_title ?? '';
