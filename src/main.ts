import * as THREE from 'three';
import { loadC01Visual, loadGameDb, loadHotspotMap, loadWalkMap, walkArtBase } from './data/loader';
import { newGame, loadGame, clearSave, saveGame, type GameState } from './save/gameState';
import { ScenePresenter } from './scene/scenePresenter';
import { DialogRunner } from './dialog/dialogRunner';
import { FlowController } from './flow/flowController';
import { attackTurn } from './battle/battleLogic';
import { nodeStates, enterNode, locationTitle } from './map/chapterMap';
import { WalkScene } from './walk/walkScene';
import { HotspotBoard } from './scene/hotspotBoard';
import { PortraitStage } from './scene/portraitStage';
import { ShortOpPanel } from './shortop/shortOpPanel';
import type { ShortOpDef } from './shortop/shortOps';
import { bannerText, isHotspotScene, nextAuto, nextEnter, visibleHotspots } from './walk/c01Flow';
import { assetUrl, containRect, devEntriesOn, resolveArtRef, type C01Visual } from './scene/c01Art';
import type { HotspotMap, HotspotTrigger } from './data/hotspotTypes';
import type { GameDb, MapNodeRow } from './data/types';
function toast(t: string) { const el = $('locCard'); el.textContent = t; el.style.opacity = '1'; setTimeout(() => { el.style.opacity = '0'; }, 900); }
let gdb: GameDb;
let visual: C01Visual | null = null;
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
app.prepend(renderer.domElement);
const scene = new THREE.Scene();
const c = document.createElement('canvas'); c.width = 2; c.height = 256;
const g = c.getContext('2d')!; const gr = g.createLinearGradient(0, 0, 0, 256);
gr.addColorStop(0, '#9fc3d6'); gr.addColorStop(.6, '#e9dcc0'); gr.addColorStop(1, '#6d7f6a');
g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
const skyBg = new THREE.CanvasTexture(c); scene.background = skyBg;
const camera = new THREE.PerspectiveCamera(60, 9 / 16, 0.1, 100);
camera.position.set(0, 2.6, 10.5); camera.lookAt(0, 1.6, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshLambertMaterial({ color: 0x7c8f6b }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const loader = new THREE.TextureLoader();
function label(text: string) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const x = cv.getContext('2d')!; x.fillStyle = '#000a'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#fff'; x.font = '36px serif'; x.textAlign = 'center'; x.fillText(text, 128, 46);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv) }));
  s.scale.set(2, .5, 1); return s;
}
const legacyActors: { img: string; mat: THREE.MeshBasicMaterial }[] = [];
const chars = [
  { name: '沈归迟', img: 'shen-guichi', color: 0x3a5a6a, x: -2.0, h: 3.2 },
  { name: '陆清歌', img: 'lu-qingge', color: 0xd8c8e8, x: 0, h: 3.0 },
  { name: '宁小满', img: 'ning-xiaoman', color: 0xe09a40, x: 2.0, h: 2.5 },
].map(d => {
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: d.color, transparent: true });
  legacyActors.push({ img: d.img, mat });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(d.h * 0.6, d.h), mat);
  p.position.y = d.h / 2; grp.add(p);
  const l = label(d.name); l.position.y = d.h + .4; grp.add(l);
  grp.position.x = d.x; scene.add(grp); return grp;
});
const enemyH = 2.4;
const enemyMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
const enemy = new THREE.Mesh(new THREE.PlaneGeometry(enemyH * 0.72, enemyH), enemyMat);
enemy.position.set(0, enemyH / 2 + 0.15, 3); enemy.visible = false;
const eLight = new THREE.PointLight(0x88aacc, 24, 22); eLight.position.set(0, 4, 6); scene.add(eLight); eLight.visible = false; scene.add(enemy);
let legacyLoaded = false;
function ensureLegacy() {
  if (legacyLoaded) return;
  legacyLoaded = true;
  for (const actor of legacyActors) {
    loader.load(`${import.meta.env.BASE_URL}portraits/anime-v3-${actor.img}.jpg`, t => {
      t.colorSpace = THREE.SRGBColorSpace; actor.mat.map = t; actor.mat.color.set(0xffffff); actor.mat.needsUpdate = true;
    });
  }
  loader.load(`${import.meta.env.BASE_URL}enemies/EN_MOB_MELEE.png`, t => {
    t.colorSpace = THREE.SRGBColorSpace; enemyMat.map = t; enemyMat.needsUpdate = true;
  });
}
let mode: 'title' | 'explore' | 'battle' = 'title';
const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, on: boolean) => $(id).classList.toggle('hidden', !on);
const presenter = new ScenePresenter(scene, $('interacts'));
const portraits = new PortraitStage($('portraitStage'));
const dialog = new DialogRunner(
  $('dialog'),
  $('talkPortrait') as HTMLImageElement,
  $('dialogDim'),
  portraits,
  { root: $('cutaway'), img: $('cutawayStill') as HTMLImageElement },
);
const walk = new WalkScene();
const hotspotMaps = new Map<string, HotspotMap>();
const hotspotBoard = new HotspotBoard($('hotspotLayer'));
const shortOpPanel = new ShortOpPanel($('shortOp'));
const sceneBg = $('sceneBg') as HTMLImageElement;
let hotspotOn = false;
let hotspotBusy = false;
let promptLabel: string | null = null;
let flow: FlowController;
let sceneBg3: THREE.Color | THREE.Texture | null = null;
let townReady: Promise<void> | null = null;
function toastSafe(t: string) { toast(t); }
function ensureTown() {
  if (walk.ready) return Promise.resolve();
  if (townReady) return townReady;
  townReady = (async () => {
    try {
      const wm = await loadWalkMap('SC_03_TOWN');
      if (wm) { await walk.load(wm, walkArtBase('SC_03_TOWN')); layoutSafe(); }
    } catch (err) { console.error(err); }
  })();
  return townReady;
}
function setEndChrome(on: boolean) {
  $('hud').style.visibility = on ? 'hidden' : '';
  $('zoneLabel').style.visibility = on ? 'hidden' : '';
  $('mapBtn').style.visibility = on ? 'hidden' : '';
}
function clearDialogInline() {
  const el = $('dialog');
  el.style.bottom = '';
  el.style.left = '';
  el.style.top = '';
  el.style.width = '';
  el.style.height = '';
  el.style.right = '';
}
function layoutArt() {
  const fw = app.clientWidth;
  const fh = app.clientHeight;
  const iw = sceneBg.naturalWidth || visual?.canvas.w || 1080;
  const ih = sceneBg.naturalHeight || visual?.canvas.h || 1920;
  const rect = containRect(fw, fh, iw, ih);
  app.style.setProperty('--art-x', `${rect.x}px`);
  app.style.setProperty('--art-y', `${rect.y}px`);
  app.style.setProperty('--art-w', `${rect.w}px`);
  app.style.setProperty('--art-h', `${rect.h}px`);
  app.style.setProperty('--frame-h', `${fh}px`);
  portraits.layout(rect.w);
}
function showBoard(path: string) {
  const url = assetUrl(path, import.meta.env.BASE_URL);
  const board = $('artBoard');
  board.classList.remove('hidden');
  board.dataset.art = path;
  if (sceneBg.getAttribute('src') !== url) sceneBg.src = url;
  layoutArt();
}
function applyArt(focus?: HotspotTrigger | null) {
  if (!flow || !visual || !isHotspotScene(flow.state.scene_id)) return;
  if (flow.state.scene_id === 'CH1_GATE') { showBoard(visual.chapter_card.src); return; }
  const map = hotspotMaps.get(flow.state.scene_id);
  if (!map) return;
  const ref = resolveArtRef(map, flow.state.flags, flow.state.triggered_ids ?? [], focus);
  const src = ref ? visual.backgrounds[ref] : null;
  if (src) showBoard(src);
}
function syncHotspotChrome() {
  const talking = !$('dialog').classList.contains('hidden') || !$('shortOp').classList.contains('hidden') || !$('reward').classList.contains('hidden') || !$('endCard').classList.contains('hidden');
  show('hotspotLayer', hotspotOn);
  show('c01Banner', hotspotOn && flow?.state.scene_id !== 'CH1_GATE');
  show('gateCard', hotspotOn && flow?.state.scene_id === 'CH1_GATE' && !talking);
  hotspotBoard.setLocked(talking || hotspotBusy);
  show('dbgBattle', !hotspotOn && mode !== 'battle');
  show('mapBtn', !hotspotOn && mode !== 'battle');
  renderer.domElement.style.visibility = hotspotOn ? 'hidden' : '';
  renderer.domElement.style.pointerEvents = hotspotOn ? 'none' : '';
  if (hotspotOn) { show('joystick', false); show('walkInteract', false); show('zoneLabel', false); clearDialogInline(); }
}
function refreshHotspots() {
  if (!hotspotOn || !flow) return;
  const map = hotspotMaps.get(flow.state.scene_id);
  $('c01Banner').textContent = bannerText(flow.state.flags);
  applyArt(null);
  if (!map) { hotspotBoard.clear(); return; }
  hotspotBoard.render(visibleHotspots(map, flow.state.flags, flow.state.triggered_ids ?? []));
}
async function flushHotspotAutos() {
  while (flow && isHotspotScene(flow.state.scene_id)) {
    const map = hotspotMaps.get(flow.state.scene_id);
    if (!map) break;
    const auto = nextAuto(map.triggers, flow.state.flags, flow.state.triggered_ids ?? [], flow.state.scene_id);
    if (!auto) break;
    await flow.handleHotspotTrigger(auto);
  }
}
async function presentHotspot(sceneId: string) {
  hotspotOn = true;
  const map = hotspotMaps.get(sceneId) ?? null;
  hotspotBoard.setMap(map);
  applyArt(null);
  layoutArt();
  syncHotspotChrome();
  if (sceneId === 'CH1_GATE') { hotspotBoard.clear(); $('c01Banner').textContent = '第一章 · 纸灯里有个人'; return; }
  const enter = map && nextEnter(map.triggers, flow.state.flags, flow.state.triggered_ids ?? [], sceneId);
  if (enter) await flow.handleHotspotTrigger(enter);
  if (flow.state.scene_id === sceneId) await flushHotspotAutos();
  refreshHotspots();
  syncHotspotChrome();
}
async function activateHotspot(trigger: HotspotTrigger) {
  if (hotspotBusy || !flow) return;
  hotspotBusy = true;
  syncHotspotChrome();
  try {
    await flow.handleHotspotTrigger(trigger);
    if (isHotspotScene(flow.state.scene_id)) await flushHotspotAutos();
  } finally {
    hotspotBusy = false;
    if (isHotspotScene(flow.state.scene_id)) refreshHotspots();
    syncHotspotChrome();
  }
}
function syncWalkChrome() {
  const on = walk.isActive() && mode !== 'title';
  const talking = !$('dialog').classList.contains('hidden') || mode === 'battle' || !$('reward').classList.contains('hidden') || !$('endCard').classList.contains('hidden');
  show('joystick', on && !talking);
  show('zoneLabel', on);
  show('dbgBattle', !on && mode !== 'battle');
  const btn = $('walkInteract');
  if (on && !talking && promptLabel) { btn.textContent = promptLabel; btn.classList.remove('hidden'); }
  else btn.classList.add('hidden');
  if (!on || talking) resetStick();
}
function setBattleVisual(on: boolean) {
  mode = on ? 'battle' : 'explore';
  const walking = walk.isActive();
  if (walking) {
    enemy.visible = false; eLight.visible = false; walk.setBattle(on);
    renderer.domElement.style.filter = on ? 'brightness(.62) saturate(.8)' : '';
  } else {
    enemy.visible = on; eLight.visible = on;
    renderer.domElement.style.filter = on ? 'brightness(.5) saturate(.7)' : '';
    if (!on && sceneBg3) presenter.setBackground(sceneBg3); else if (on) sceneBg3 = scene.background as THREE.Texture;
  }
  show('attack', on); show('retreat', on); show('battleLog', on); show('mapBtn', !on); show('interacts', !on && !walking); show('dbgBattle', !on); if (on) show('next', false);
  syncWalkChrome();
}
function battleHud() { const b = flow.state.battle!; $('hudText').textContent = `战斗 · 回合 ${b.turn} · 我方 ${b.party_hp} / 妖物 ${b.enemy_hp}`; }
const hooks = {
  onSceneReady: (name: string, hasNext: boolean) => { $('hudText').textContent = `${name} · 灰盒`; show('next', hasNext); },
  onBattleStart: () => { setBattleVisual(true); $('battleLog').textContent = '雾纹山魈现身！'; battleHud(); },
  onBattleEnd: () => setBattleVisual(false),
  onLocationCard: (key: string) => new Promise<void>(res => {
    const t = locationTitle(gdb.mapNodes, key); if (!t) return res();
    const el = $('locCard'); el.textContent = t; el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 1100); setTimeout(res, 1500);
  }),
  onReward: (n: MapNodeRow) => new Promise<void>(res => {
    if (flow.state.flags['map_reward_n5']) return res();
    $('rewardBody').textContent = n.reward_tip ?? '雾纹残晶 ×1'; show('reward', true);
    $('rewardOk').onclick = () => { flow.state.flags['map_reward_n5'] = 1; show('reward', false); res(); };
  }),
  onChapterEnd: (n: MapNodeRow) => {
    $('endTitle').textContent = n.end_card_title ?? '第一章 · 未完'; $('endBody').textContent = n.end_card_body ?? '';
    show('endContinue', !!n.hook_scene_id); show('next', false); show('endCard', true); setEndChrome(true); syncWalkChrome();
    const dismiss = () => { show('endCard', false); setEndChrome(false); syncWalkChrome(); };
    $('endClose').onclick = dismiss;
    $('endContinue').onclick = () => { dismiss(); if (n.hook_scene_id) void flow.goto(n.hook_scene_id, `FLOW_${n.hook_scene_id}`, { hook: true }); };
  },
  onWalkMode: (on: boolean) => { if (on) { hotspotOn = false; $('artBoard').classList.add('hidden'); const r = app.getBoundingClientRect(); walk.resize(r.width, r.height); } syncWalkChrome(); syncHotspotChrome(); },
  onToast: (t: string) => toastSafe(t),
  onHotspotScene: (sceneId: string) => presentHotspot(sceneId),
  onShortOp: (op: ShortOpDef) => shortOpPanel.run(op),
  onHotspotFocus: (trigger: HotspotTrigger) => applyArt(trigger),
  cutawayStills: (id: string) => visual?.cutaways[id]?.stills ?? null,
};
function openMap() {
  if (mode !== 'explore' || !$('dialog').classList.contains('hidden')) return;
  const m = gdb.mapNodes, st = nodeStates(m, flow), root = $('mapNodes'); root.innerHTML = '';
  $('mapTitle').textContent = '第一章 · 云归山';
  const cur = m.find(n => st[n.map_node] === 'current'); $('mapObj').textContent = `当前目标：${cur?.objective ?? '—'}`;
  const labels = walk.ready ? walk.labels() : {};
  for (const n of m) {
    const b = document.createElement('button'); b.className = `mnode ${st[n.map_node]}`;
    const name = st[n.map_node] === 'locked' ? '？？？' : (labels[n.map_node] || n.map_title);
    b.innerHTML = `${n.map_node} · ${name}<small>${n.tags.join(' / ')}${st[n.map_node] === 'current' ? ' · 当前' : ''}</small>`;
    b.disabled = st[n.map_node] === 'locked';
    b.onclick = () => { show('map', false); enterNode(n, flow, toastSafe); };
    root.append(b);
  }
  show('map', true);
}
$('mapBtn').onclick = openMap; $('mapClose').onclick = () => show('map', false);
$('next').onclick = () => { show('next', false); flow.next(); };
$('attack').onclick = () => {
  const r = attackTurn(flow.state.battle!); $('battleLog').textContent = r.log; battleHud();
  if (r.result) setTimeout(() => { flow.endBattle(r.result!); }, 700);
};
$('retreat').onclick = () => flow.endBattle('retreat');
$('dbgBattle').onclick = () => { ensureLegacy(); flow.beginBattle('ENC_TUTORIAL_01'); };
function layoutSafe() {
  if (hotspotOn) { layoutArt(); return; }
  const ui = walk.safeUi(); const canvas = walk.canvasSize(); if (!ui || !canvas) return;
  const place = (el: HTMLElement, box: { x: number; y: number; w: number; h: number }) => {
    el.style.left = `${box.x / canvas.w * 100}%`; el.style.top = `${box.y / canvas.h * 100}%`;
    el.style.width = `${box.w / canvas.w * 100}%`; el.style.height = `${box.h / canvas.h * 100}%`;
  };
  place($('joystick'), ui.joystick); place($('walkInteract'), ui.interact_btn);
  const gap = `${(canvas.h - ui.dialog_bar_max_y) / canvas.h * 100}%`;
  $('dialog').style.bottom = gap; $('talkPortrait').style.bottom = gap;
}
const joy = $('joystick'); const knob = $('joyKnob');
function resetStick() { walk.setStick(0, 0, false); knob.style.left = '50%'; knob.style.top = '50%'; }
function stickFrom(e: PointerEvent) {
  const r = joy.getBoundingClientRect();
  let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const mag = Math.hypot(dx, dy); if (mag > 1) { dx /= mag; dy /= mag; }
  knob.style.left = `${50 + dx * 28}%`; knob.style.top = `${50 + dy * 28}%`;
  walk.setStick(dx, dy, mag > 0.18);
}
joy.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); joy.setPointerCapture(e.pointerId); stickFrom(e); });
joy.addEventListener('pointermove', e => { if (joy.hasPointerCapture(e.pointerId)) stickFrom(e); });
joy.addEventListener('pointerup', () => resetStick());
joy.addEventListener('pointercancel', () => resetStick());
$('walkInteract').onclick = e => { e.stopPropagation(); walk.activatePrompt(); };
renderer.domElement.addEventListener('pointerdown', e => {
  if (!walk.isActive() || mode !== 'explore') return;
  walk.pointer(e.clientX, e.clientY, renderer.domElement.getBoundingClientRect());
});
sceneBg.addEventListener('load', () => { if (hotspotOn) layoutArt(); });
loadGameDb().then(async db => {
  gdb = db;
  visual = await loadC01Visual();
  const dev = devEntriesOn(visual.dev_entries, location.search);
  document.body.classList.toggle('dev', dev);
  portraits.setVisual(visual, import.meta.env.BASE_URL);
  dialog.setAssetBase(import.meta.env.BASE_URL);
  $('gateCard').classList.add('has-art');
  app.style.setProperty('--sub-y', String(visual.subtitle_y));
  app.style.setProperty('--canvas-h', String(visual.canvas.h));
  app.style.setProperty('--title-y', String(visual.chapter_card.title_y));
  app.style.setProperty('--title-h', String(visual.chapter_card.title_h));
  for (const id of ['CH1_GATE', 'C01_SHOP', 'C01_STREET']) {
    const map = await loadHotspotMap(id);
    if (map) hotspotMaps.set(id, map);
  }
  const saved = loadGame(); show('continue', !!saved);
  const begin = (s: GameState) => {
    mode = 'explore'; show('title', false); show('hud', true); show('mapBtn', !isHotspotScene(s.scene_id));
    flow = new FlowController(db, s, dialog, presenter, hooks);
    walk.setHooks({
      flags: () => flow.state.flags,
      triggered: () => flow.state.triggered_ids ?? [],
      blocked: () => mode === 'battle' || !$('dialog').classList.contains('hidden') || !$('map').classList.contains('hidden') || !$('reward').classList.contains('hidden') || !$('endCard').classList.contains('hidden'),
      onTrigger: t => flow.handleWalkTrigger(t),
      onToast: toastSafe,
      onZone: (labelText, objective) => { $('zoneName').textContent = labelText; $('zoneObj').textContent = objective; },
      onPrompt: labelText => { promptLabel = labelText; syncWalkChrome(); },
      savePos: (x, y) => { if (flow.state.battle) return; flow.state.walk_pos = { scene_id: 'SC_03_TOWN', x, y }; saveGame(flow.state); },
    });
    flow.attachWalk(walk.ready ? walk : null);
    if (s.battle) { flow.state.battle = undefined; }
    flow.start();
  };
  const beginLegacy = async (s: GameState) => { ensureLegacy(); await ensureTown(); begin(s); };
  $('enter').onclick = () => { clearSave(); void beginLegacy(newGame(db.flags)); };
  $('continue').onclick = () => { const s = saved!; if (isHotspotScene(s.scene_id)) begin(s); else void beginLegacy(s); };
  $('enterTown').onclick = () => {
    clearSave(); const s = newGame(db.flags); s.scene_id = 'SC_03_TOWN'; s.flow_node_id = 'FLOW_SC_03_TOWN'; void beginLegacy(s);
  };
  $('enterC01').onclick = () => {
    clearSave(); const s = newGame(db.flags); s.scene_id = 'CH1_GATE'; s.flow_node_id = 'FLOW_CH1_GATE'; begin(s);
  };
  hotspotBoard.onClick = trigger => { void activateHotspot(trigger); };
  $('gateEnter').onclick = () => {
    const start = hotspotMaps.get('CH1_GATE')?.triggers.find(t => t.id === 'TR_CH1_GATE_START');
    if (start) void activateHotspot(start);
  };
}).catch(e => { $('hudText').textContent = String(e); console.error(e); });
function resize() { const r = app.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); walk.resize(r.width, r.height); if (hotspotOn) layoutArt(); }
addEventListener('resize', resize); resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (hotspotOn && mode !== 'title') {
    syncHotspotChrome();
    return;
  }
  ground.visible = true;
  if (!hotspotOn) { show('hotspotLayer', false); show('gateCard', false); show('c01Banner', false); }
  if (walk.isActive() && mode !== 'title') { walk.update(dt); syncWalkChrome(); renderer.render(walk.scene, walk.camera); return; }
  chars.forEach((ch, i) => {
    ch.visible = mode !== 'title';
    ch.position.y = Math.sin(t * 2 + i) * .05;
    const tx = mode === 'battle' ? [-2.6, -100, 2.6][i] : [-2.0, 0, 2.0][i];
    ch.position.x += (tx === -100 ? 0 : tx - ch.position.x) * .15;
    if (i === 1) ch.visible = mode === 'explore';
    ch.scale.setScalar(mode === 'battle' ? .6 : 1);
  });
  if (mode === 'title') camera.position.x = Math.sin(t * .3) * .8;
  else if (mode === 'explore') camera.position.x *= .95;
  if (enemy.visible) { enemy.position.y = enemyH / 2 + 0.15 + Math.sin(t * 2.2) * .06; }
  camera.lookAt(0, 1.5, 0);
  renderer.render(scene, camera);
});
