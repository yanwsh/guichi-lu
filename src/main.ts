import * as THREE from 'three';
import { loadGameDb } from './data/loader';
import { newGame, loadGame, clearSave, type GameState } from './save/gameState';
import { ScenePresenter } from './scene/scenePresenter';
import { DialogRunner } from './dialog/dialogRunner';
import { FlowController } from './flow/flowController';
import { attackTurn } from './battle/battleLogic';
import { nodeStates, enterNode, locationTitle } from './map/chapterMap';
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
const dialog = new DialogRunner($('dialog'));
let flow: FlowController;
let sceneBg: THREE.Color | THREE.Texture | null = null;
function setBattleVisual(on: boolean) {
  mode = on ? 'battle' : 'explore'; enemy.visible = on; eLight.visible = on;
  renderer.domElement.style.filter = on ? 'brightness(.5) saturate(.7)' : ''; // 战斗：SC_03 压暗
  if (!on && sceneBg) presenter.setBackground(sceneBg); else if (on) sceneBg = scene.background as THREE.Texture;
  show('attack', on); show('retreat', on); show('battleLog', on); show('mapBtn', !on); show('interacts', !on); show('dbgBattle', !on); if (on) show('next', false);
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
};
function openMap() {
  if (mode !== 'explore' || !$('dialog').classList.contains('hidden')) return;
  const m = gdb.mapNodes, st = nodeStates(m, flow), root = $('mapNodes'); root.innerHTML = '';
  $('mapTitle').textContent = '第一章 · 云归山';
  const cur = m.find(n => st[n.map_node] === 'current'); $('mapObj').textContent = `当前目标：${cur?.objective ?? '—'}`;
  for (const n of m) {
    const b = document.createElement('button'); b.className = `mnode ${st[n.map_node]}`;
    b.innerHTML = `${n.map_node} · ${st[n.map_node] === 'locked' ? '？？？' : n.map_title}<small>${n.tags.join(' / ')}${st[n.map_node] === 'current' ? ' · 当前' : ''}</small>`;
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
loadGameDb().then(db => {
  gdb = db;
  const saved = loadGame(); show('continue', !!saved);
  const begin = (s: GameState) => {
    mode = 'explore'; show('title', false); show('hud', true); show('mapBtn', true);
    flow = new FlowController(db, s, dialog, presenter, hooks);
    if (s.battle) { flow.state.battle = undefined; }
    flow.start();
  };
  $('enter').onclick = () => { clearSave(); begin(newGame(db.flags)); };
  $('continue').onclick = () => begin(saved!);
}).catch(e => { $('hudText').textContent = String(e); console.error(e); });
function resize() { const r = app.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
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
