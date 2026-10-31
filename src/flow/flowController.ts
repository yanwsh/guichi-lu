import type { GameDb, MapNodeRow } from '../data/types';
import { type GameState, saveGame } from '../save/gameState';
import type { DialogRunner } from '../dialog/dialogRunner';
import type { ScenePresenter } from '../scene/scenePresenter';
import { startBattle } from '../battle/battleLogic';
import type { WalkBridge } from '../walk/walkScene';
import type { WalkTrigger } from '../walk/walkTypes';
export interface FlowHooks {
  onSceneReady(sceneName: string, hasNext: boolean): void;
  onBattleStart(): void;
  onBattleEnd(): void;
  onLocationCard?(sceneId: string): Promise<void>;
  onReward?(node: MapNodeRow): Promise<void>;
  onChapterEnd?(node: MapNodeRow): void;
  onWalkMode?(on: boolean): void;
  onToast?(text: string): void;
}
/** 灰盒：抉择→分支对白（苏禾草稿 README，不改 DialogueRow） */
const CHOICE_DIALOGUE: Record<string, string> = { CHO_OPEN_LETTER: 'DLG_OPEN_LETTER_PEEK', CHO_KEEP_SEALED: 'DLG_OPEN_LETTER_KEEP', CHO_SAVE_LIFE: 'DLG_CHOICE_SAVE_01', CHO_CHASE: 'DLG_CHOICE_CHASE_01' };
export class FlowController {
  private snapshot: string | null = null;
  walk: WalkBridge | null = null;
  constructor(public db: GameDb, public state: GameState, private dialog: DialogRunner, private presenter: ScenePresenter, private hooks: FlowHooks) {
    presenter.onInteract = id => this.interact(id);
  }
  attachWalk(walk: WalkBridge | null) { this.walk = walk; }
  /** 地图进度：N1–N6（N3/N4/N5 同 host SC_03_TOWN，故按 map_node 记） */
  node(id: string) { return this.db.mapNodes.find(n => n.map_node === id); }
  setMapNode(id: string) {
    if (!this.node(id)) return; this.state.map_node = id;
    const v = (this.state.visited_map_nodes ??= []); if (!v.includes(id)) v.push(id); saveGame(this.state);
  }
  farthestOrder() { return Math.max(1, ...(this.state.visited_map_nodes ?? []).map(id => this.node(id)?.map_order ?? 0)); }
  private nodeForScene(sceneId: string) { return this.db.mapNodes.find(n => n.host_scene_id === sceneId && (n.map_phase === 'scene' || n.map_phase === 'pre_battle')); }
  start() { void this.goto(this.state.scene_id, this.state.flow_node_id); }
  async goto(sceneId: string, flowNode = `FLOW_${sceneId}`, opts?: { hook?: boolean }) {
    const row = this.db.scenes.get(sceneId); if (!row) throw new Error(`unknown scene ${sceneId}`);
    // SC_05 后置：故事流和结束卡「继续」都不播 Boss stub。
    if (this.deferredBoss(sceneId)) { this.chapterEnd(); return; }
    this.state.scene_id = sceneId; this.state.flow_node_id = flowNode;
    const v = (this.state.visited_scene_ids ??= []); if (!v.includes(sceneId)) v.push(sceneId);
    const useWalk = sceneId === 'SC_03_TOWN' && !!this.walk?.ready;
    if (useWalk) {
      const cur = this.node(this.state.map_node ?? '')?.map_order ?? 0;
      if (cur < 3) this.setMapNode('N3');
    } else {
      const mn = this.nodeForScene(sceneId); if (mn) this.setMapNode(mn.map_node);
    }
    saveGame(this.state);
    if (useWalk && this.walk) {
      this.presenter.clear();
      this.hooks.onWalkMode?.(true);
      this.walk.show(this.state);
      this.hooks.onSceneReady(row.name, false);
      return;
    }
    this.walk?.hide();
    this.hooks.onWalkMode?.(false);
    this.presenter.show(row);
    this.hooks.onSceneReady(row.name, false);
    if (this.hooks.onLocationCard) await this.hooks.onLocationCard(sceneId);
    const teaId = sceneId === 'SC_04_CHOICE' ? this.db.sc04Triggers?.find(t => t.id === 'TR_N6_TEA')?.result?.dialogue_id : undefined;
    const enc = await this.playChain(teaId || row.enter_dialogue_id);
    if (enc && !(sceneId === 'SC_03_TOWN' && this.state.flags['tutorial_won'])) { this.beginBattle(enc); return; }
    // 章末宿主：抉择播完再按 TR_N6_END_CARD 收束，不接 Boss stub。hook 进入则停在场景里。
    if (!opts?.hook && this.cliffNode(sceneId)) { this.finishChapterCliff(sceneId); return; }
    this.onDialogueEnd();
  }
  /** 播放对白链（next_dialogue_id / 抉择 followup_lines）；返回链尾 start_encounter_id */
  private async playChain(id?: string): Promise<string | undefined> {
    let enc: string | undefined;
    while (id) {
      const d = this.db.dialogues.get(id); if (!d) break;
      const choice = await this.dialog.run(d);
      this.markDialogue(d.dialogue_id);
      if (choice) {
        this.state.flags[choice.set_flag] = choice.value; saveGame(this.state);
        const mapped = CHOICE_DIALOGUE[choice.choice_id];
        if (mapped && this.db.dialogues.get(mapped)) { await this.dialog.run(this.db.dialogues.get(mapped)!); this.markDialogue(mapped); }
        if (choice.choice_id === 'CHO_SAVE_LIFE') { this.state.flags['link_tongxin_unlocked'] = 1; saveGame(this.state); }
        if (choice.followup_lines?.length) await this.dialog.run({ dialogue_id: `${d.dialogue_id}_${choice.choice_id}`, lines: choice.followup_lines, choices: [] });
      }
      enc = d.start_encounter_id ?? enc; id = d.next_dialogue_id;
    }
    saveGame(this.state);
    return enc;
  }
  private markDialogue(id: string) {
    if (!id) return;
    const done = (this.state.dialogue_done ??= []);
    if (!done.includes(id)) done.push(id);
  }
  private markTrigger(id: string) {
    const ids = (this.state.triggered_ids ??= []);
    if (!ids.includes(id)) ids.push(id);
  }
  private onDialogueEnd() {
    const row = this.db.scenes.get(this.state.scene_id)!;
    const nextId = row.next_scene_id ?? '';
    if (nextId && this.deferredBoss(nextId)) { this.chapterEnd(); return; }
    this.hooks.onSceneReady(row.name, !!nextId);
  }
  next() { const n = this.db.scenes.get(this.state.scene_id)?.next_scene_id; if (n) void this.goto(n); }
  interact(id: string) {
    const enc = this.db.scenes.get(this.state.scene_id)?.interact_encounters?.[id];
    if (enc) this.beginBattle(enc);
  }
  /** SC_03 可走触发。对白锁移动由 WalkScene 在回调期间停步。 */
  async handleWalkTrigger(t: WalkTrigger) {
    const mark = () => {
      if (!t.once) return;
      const ids = (this.state.triggered_ids ??= []);
      if (!ids.includes(t.id)) ids.push(t.id);
    };
    if (t.start_dialogue_id) await this.playChain(t.start_dialogue_id);
    if (t.id === 'TR_N3_ENTER') this.state.flags['dlg_town_01_done'] = 1;
    if (t.hint) {
      await this.dialog.run({
        dialogue_id: t.id,
        lines: [{ speaker: t.label || '旁白', portrait_key: '', text: t.hint }],
        choices: [],
      });
    }
    if (t.set_flags) for (const f of t.set_flags) this.state.flags[f] = 1;
    if (t.id === 'TR_N3_SEARCH') this.hooks.onToast?.('爪痕还新。上山的路通了。');
    mark();
    saveGame(this.state);
    if (t.reward === 'IT_MIST_SHARD') await this.grantShard();
    if (t.encounter_id) { this.beginBattle(t.encounter_id); return; }
    if (t.flow_to) {
      this.setMapNode('N6');
      await this.goto(t.flow_to);
    }
  }
  private async grantShard() {
    if (this.state.flags['mist_shard_taken']) return;
    this.setMapNode('N5');
    const n5 = this.node('N5');
    if (n5 && this.hooks.onReward && !this.state.flags['map_reward_n5']) await this.hooks.onReward(n5);
    this.state.flags['mist_shard_taken'] = 1;
    if (!this.state.flags['qingge_joined_early']) this.state.flags['qingge_joined_early'] = 1;
    saveGame(this.state);
    this.hooks.onToast?.('残晶已收好。走到亭台北缘再进镇。');
  }
  beginBattle(encounterId: string) {
    const enc = this.db.encounters.get(encounterId); if (!enc) throw new Error(`unknown encounter ${encounterId}`);
    if (encounterId === 'ENC_TUTORIAL_01') this.setMapNode('N4');
    this.walk?.commitPos();
    const { battle: _b, ...rest } = this.state; this.snapshot = JSON.stringify(rest);
    this.state.battle = startBattle(enc); this.state.flow_node_id = `BATTLE_${encounterId}`; saveGame(this.state);
    this.hooks.onBattleStart();
  }
  endBattle(result: 'win' | 'retreat' | 'lose') {
    const enc = this.state.battle && this.db.encounters.get(this.state.battle.encounter_id);
    if (result !== 'win' && this.snapshot) this.state = Object.assign(this.state, JSON.parse(this.snapshot));
    delete this.state.battle; this.snapshot = null;
    this.state.flow_node_id = result === 'win' && enc ? enc.on_win_flow : `FLOW_${this.state.scene_id}`;
    if (result === 'win' && enc?.encounter_id === 'ENC_TUTORIAL_01') this.state.flags['tutorial_won'] = 1;
    saveGame(this.state); this.hooks.onBattleEnd();
    if (this.walk?.isActive() && this.state.scene_id === 'SC_03_TOWN') {
      this.walk.refresh();
      this.walk.resumeAfterBattle(result);
      return;
    }
    this.presenter.show(this.db.scenes.get(this.state.scene_id)!);
    if (result === 'win' && enc?.encounter_id === 'ENC_TUTORIAL_01') void this.afterTutorial(); else this.onDialogueEnd();
  }
  /** 地图 N5：回 SC_03_TOWN 播战后对白 → 奖励（不重进入场对白/战斗） */
  async replayAfterTutorial() {
    if (this.walk?.ready) {
      const sp = this.walk.spawnZone('N5');
      if (sp) this.state.walk_pos = { scene_id: 'SC_03_TOWN', x: sp.x, y: sp.y };
      this.setMapNode('N5');
      await this.goto('SC_03_TOWN');
      return;
    }
    const row = this.db.scenes.get('SC_03_TOWN')!; this.state.scene_id = row.scene_id; this.state.flow_node_id = 'FLOW_AFTER_TUTORIAL'; saveGame(this.state);
    this.presenter.show(row); this.hooks.onSceneReady(row.name, false);
    this.setMapNode('N5');
    if (this.hooks.onLocationCard) await this.hooks.onLocationCard('N5');
    await this.afterTutorial();
  }
  private async afterTutorial() {
    this.setMapNode('N5'); const n5 = this.node('N5');
    await this.playChain(n5?.end_dialogue_id || 'DLG_AFTER_TUTORIAL_01');
    if (!this.state.flags['qingge_joined_early']) { this.state.flags['qingge_joined_early'] = 1; saveGame(this.state); }
    if (n5 && this.hooks.onReward) await this.hooks.onReward(n5);
    this.setMapNode('N6');
    // 解锁 N6 后不再把「下一场景」接到后置 Boss。下一跳是 SC_04 时仍进入抉择，抉择结束由 goto 收束到结束卡。
    const nextId = this.db.scenes.get(this.state.scene_id)?.next_scene_id ?? '';
    if (!nextId || this.deferredBoss(nextId)) this.chapterEnd(); else this.onDialogueEnd();
  }
  /** 地图 N4（未胜）：落到 host 场景再开战 */
  battleAt(sceneId: string, encounterId: string) {
    if (sceneId === 'SC_03_TOWN' && this.walk?.ready) {
      void this.goto(sceneId).then(() => { if (!this.state.flags['tutorial_won']) this.beginBattle(encounterId); });
      return;
    }
    const row = this.db.scenes.get(sceneId)!; this.state.scene_id = sceneId; this.state.flow_node_id = `FLOW_${sceneId}`;
    this.presenter.show(row); this.hooks.onSceneReady(row.name, false); this.beginBattle(encounterId);
  }
  /**
   * 苏禾 v0.1：TR_N6_TEA / TR_N6_END_CARD 同圆 (529, 628) r=90。
   * 茶棚对白（DLG_MEET_B_01 → DLG_CHOICE_01）结束后才出结束卡。
   * result.hook_scene 是 SC_05_BOSS，本章后置，不写进 hook_scene_id，关闭不进 Boss。
   * 灰盒没有镇口可走网格；抉择结束即视为人在茶棚前，不铺迷宫。
   */
  private finishChapterCliff(sceneId: string) {
    const triggers = this.db.sc04Triggers ?? [];
    const tea = triggers.find(t => t.id === 'TR_N6_TEA');
    const end = triggers.find(t => t.id === 'TR_N6_END_CARD');
    const done = this.state.dialogue_done ?? [];
    if (tea?.result?.dialogue_id && done.includes(tea.result.dialogue_id)) this.markTrigger(tea.id);
    const need = end?.gate?.require_dialogue_done;
    if (end && need && !done.includes(need)) { this.onDialogueEnd(); return; }
    if (end) this.markTrigger(end.id);
    saveGame(this.state);
    this.chapterEnd(this.cliffNode(sceneId));
  }
  /** 章末宿主（N6 的 host 为 SC_04）。 */
  private cliffNode(sceneId: string) { return this.db.mapNodes.find(n => n.host_scene_id === sceneId && n.map_phase === 'chapter_end'); }
  /** 六站地图不占位的章末 Boss（SC_05 / DLG_BOSS_01）。 */
  private deferredBoss(sceneId: string) {
    const row = this.db.scenes.get(sceneId);
    return !!row && (row.map_deferred === true || row.enter_dialogue_id === 'DLG_BOSS_01');
  }
  /** 地图 N6 / TR_N6_END_CARD：结束卡用 map_nodes 文案。后置 Boss 不当继续目标。 */
  chapterEnd(node?: MapNodeRow) {
    const n = node ?? this.node('N6'); if (!n || n.map_phase !== 'chapter_end') return;
    this.dialog.hide(); this.setMapNode(n.map_node);
    const hook = n.hook_scene_id;
    const card = hook && !this.deferredBoss(hook) ? n : { ...n, hook_scene_id: undefined };
    this.hooks.onChapterEnd?.(card);
  }
}
