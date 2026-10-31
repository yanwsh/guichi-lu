import type { DialogueRow, ChoiceRow } from '../data/types';
export class DialogRunner {
  constructor(private root: HTMLElement) {}
  /** Resolves with chosen choice (or null) when dialogue ends. */
  run(d: DialogueRow): Promise<ChoiceRow | null> {
    return new Promise(done => {
      let i = 0;
      const show = () => {
        this.root.classList.remove('hidden'); this.root.innerHTML = '';
        const line = d.lines[i];
        const sp = document.createElement('div'); sp.className = 'speaker'; sp.textContent = line.speaker;
        const tx = document.createElement('div'); tx.className = 'text'; tx.textContent = line.text;
        this.root.append(sp, tx);
        const last = i === d.lines.length - 1;
        if (last && d.choices.length) {
          for (const c of d.choices) {
            const b = document.createElement('button'); b.textContent = c.text;
            b.onclick = e => { e.stopPropagation(); this.hide(); done(c); };
            this.root.append(b);
          }
          this.root.onclick = null;
        } else {
          const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = last ? '▶ 点击结束' : '▶ 点击继续';
          this.root.append(hint);
          this.root.onclick = () => { if (last) { this.hide(); done(null); } else { i++; show(); } };
        }
      };
      show();
    });
  }
  hide() { this.root.classList.add('hidden'); this.root.onclick = null; this.root.innerHTML = ''; }
}
