import * as THREE from 'three';
import type { SceneRow } from '../data/types';
import { resolveBg } from '../data/loader';
export class ScenePresenter {
  private loader = new THREE.TextureLoader();
  private cache = new Map<string, THREE.Texture>();
  onInteract: (id: string) => void = () => {};
  constructor(private scene: THREE.Scene, private interactRoot: HTMLElement) {}
  show(row: SceneRow) {
    const url = resolveBg(row.bg_key);
    const apply = (t: THREE.Texture) => { this.scene.background = t; };
    const c = this.cache.get(url);
    if (c) apply(c); else this.loader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; this.cache.set(url, t); apply(t); }, undefined, () => {
      // 缺图回退：纯色 + 地点名
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 456; const x = cv.getContext('2d')!;
      x.fillStyle = '#3c4a4f'; x.fillRect(0, 0, 256, 456); x.fillStyle = '#f4ecd8'; x.font = '28px serif'; x.textAlign = 'center'; x.fillText(row.name, 128, 120);
      const t = new THREE.CanvasTexture(cv); this.cache.set(url, t); apply(t);
    });
    this.interactRoot.innerHTML = '';
    for (const id of row.interactables) {
      const b = document.createElement('button'); b.textContent = `调查 · ${id}`;
      b.onclick = () => this.onInteract(id); this.interactRoot.append(b);
    }
  }
  setBackground(bg: THREE.Color | THREE.Texture) { this.scene.background = bg; }
}
