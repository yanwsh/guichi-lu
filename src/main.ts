import * as THREE from 'three';
import { loadGameDb, loadWalkMap, walkArtBase } from './data/loader';
import { newGame, loadGame, clearSave, saveGame, type GameState } from './save/gameState';
import { ScenePresenter } from './scene/scenePresenter';
import { DialogRunner } from './dialog/dialogRunner';
import { FlowController } from './flow/flowController';
import { attackTurn } from './battle/battleLogic';
import { nodeStates, enterNode, locationTitle } from './map/chapterMap';
import { WalkScene } from './walk/walkScene';
import type { GameDb, MapNodeRow } from './data/types';
function toast(t: string) { const el = $('locCard'); el.textContent = t; el.style.opacity = '1'; setTimeout(() => { el.style.opacity = '0'; }, 900); }
let gdb: GameDb;
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
app.prepend(renderer.domElement);
const scene = new THREE.Scene();
// 渐变背景
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
const chars = [
  { name: '沈归迟', img: 'shen-guichi', color: 0x3a5a6a, x: -2.0, h: 3.2 },
  { name: '陆清歌', img: 'lu-qingge', color: 0xd8c8e8, x: 0, h: 3.0 },
  { name: '宁小满', img: 'ning-xiaoman', color: 0xe09a40, x: 2.0, h: 2.5 },
].map(d => {
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: d.color, transparent: true });
  loader.load(`${import.meta.env.BASE_URL}portraits/anime-v3-${d.img}.jpg`, t => {
    t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true;
  });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(d.h * 0.6, d.h), mat);
  p.position.y = d.h / 2; grp.add(p);
  const l = label(d.name); l.position.y = d.h + .4; grp.add(l);
  grp.position.x = d.x; scene.add(grp); return grp;
});
const enemyH = 2.4; // 雾纹山魈 ≈ 沈归迟 75%
const enemyMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
loader.load(`${import.meta.env.BASE_URL}enemies/EN_MOB_MELEE.png`, t => {
  t.colorSpace = THREE.SRGBColorSpace; enemyMat.map = t; enemyMat.needsUpdate = true;
});
const enemy = new THREE.Mesh(new THREE.PlaneGeometry(enemyH * 0.72, enemyH), enemyMat);
enemy.position.set(0, enemyH / 2 + 0.15, 3); enemy.visible = false;
const eLight = new THREE.PointLight(0x88aacc, 24, 22); eLight.position.set(0, 4, 6); scene.add(eLight); eLight.visible = false; scene.add(enemy);
let mode: 'title' | 'explore' | 'battle' = 'title';
const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, on: boolean) => $(id).classList.toggle('hidden', !on);
const presenter = new ScenePresenter(scene, $('interacts'));
const dialog = new DialogRunner($('dialog'), $('talkPortrait') as HTMLImageElement, $('dialogDim'));
const walk = new WalkScene();
let promptLabel: string | null = null;
let flow: FlowController;
let sceneBg: THREE.Color | THREE.Texture | null = null;
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
    if (!on && sceneBg) presenter.setBackground(sceneBg); else if (on) sceneBg = scene.background as THREE.Texture;
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
    if (flow.state.flags['map_reward_n5']) return res(); // 只给一次
    $('rewardBody').textContent = n.reward_tip ?? '雾纹残晶 ×1'; show('reward', true);
    $('rewardOk').onclick = () => { flow.state.flags['map_reward_n5'] = 1; show('reward', false); res(); };
  }),
  onChapterEnd: (n: MapNodeRow) => {
    $('endTitle').textContent = n.end_card_title ?? '第一章 · 未完'; $('endBody').textContent = n.end_card_body ?? '';
    show('endContinue', !!n.hook_scene_id); show('endCard', true);
    $('endClose').onclick = () => show('endCard', false);
    $('endContinue').onclick = () => { show('endCard', false); if (n.hook_scene_id) void flow.goto(n.hook_scene_id); };
  },
  onWalkMode: (on: boolean) => { if (on) { const r = app.getBoundingClientRect(); walk.resize(r.width, r.height); } syncWalkChrome(); },
  onToast: (t: string) => toast(t),
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
    b.onclick = () => { show('map', false); enterNode(n, flow, toast); };
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
$('dbgBattle').onclick = () => flow.beginBattle('ENC_TUTORIAL_01');
function layoutSafe() {
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
loadGameDb().then(async db => {
  gdb = db;
  try {
    const wm = await loadWalkMap('SC_03_TOWN');
    if (wm) { await walk.load(wm, walkArtBase('SC_03_TOWN')); layoutSafe(); }
  } catch (err) { console.error(err); }
  const saved = loadGame(); show('continue', !!saved);
  const begin = (s: GameState) => {
    mode = 'explore'; show('title', false); show('hud', true); show('mapBtn', true);
    flow = new FlowController(db, s, dialog, presenter, hooks);
    walk.setHooks({
      flags: () => flow.state.flags,
      triggered: () => flow.state.triggered_ids ?? [],
      blocked: () => mode === 'battle' || !$('dialog').classList.contains('hidden') || !$('map').classList.contains('hidden') || !$('reward').classList.contains('hidden') || !$('endCard').classList.contains('hidden'),
      onTrigger: t => flow.handleWalkTrigger(t),
      onToast: toast,
      onZone: (label, objective) => { $('zoneName').textContent = label; $('zoneObj').textContent = objective; },
      onPrompt: label => { promptLabel = label; syncWalkChrome(); },
      savePos: (x, y) => { if (flow.state.battle) return; flow.state.walk_pos = { scene_id: 'SC_03_TOWN', x, y }; saveGame(flow.state); },
    });
    flow.attachWalk(walk.ready ? walk : null);
    if (s.battle) { flow.state.battle = undefined; }
    flow.start();
  };
  $('enter').onclick = () => { clearSave(); begin(newGame(db.flags)); };
  $('continue').onclick = () => begin(saved!);
  $('enterTown').onclick = () => {
    clearSave(); const s = newGame(db.flags); s.scene_id = 'SC_03_TOWN'; s.flow_node_id = 'FLOW_SC_03_TOWN'; begin(s);
  };
}).catch(e => { $('hudText').textContent = String(e); console.error(e); });
function resize() { const r = app.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); walk.resize(r.width, r.height); }
addEventListener('resize', resize); resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (walk.isActive() && mode !== 'title') { walk.update(dt); syncWalkChrome(); renderer.render(walk.scene, walk.camera); return; }
  chars.forEach((c, i) => {
    c.visible = mode !== 'title';
    c.position.y = Math.sin(t * 2 + i) * .05;
    const tx = mode === 'battle' ? [-2.6, -100, 2.6][i] : [-2.0, 0, 2.0][i];
    c.position.x += (tx === -100 ? 0 : tx - c.position.x) * .15;
    if (i === 1) c.visible = mode === 'explore';
    c.scale.setScalar(mode === 'battle' ? .6 : 1);
  });
  if (mode === 'title') camera.position.x = Math.sin(t * .3) * .8;
  else if (mode === 'explore') camera.position.x *= .95;
  if (enemy.visible) { enemy.position.y = enemyH / 2 + 0.15 + Math.sin(t * 2.2) * .06; }
  camera.lookAt(0, 1.5, 0);
  renderer.render(scene, camera);
});
