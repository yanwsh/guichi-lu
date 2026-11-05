import { applyShortOp, freshShortOp, type ShortOpDef } from './shortOps'

/** 短操作面板。完成 resolve(true)，离开 resolve(false)，不写旗标。 */
export class ShortOpPanel {
  constructor(private root: HTMLElement) {}

  run(def: ShortOpDef): Promise<boolean> {
    return new Promise(resolve => {
      let state = freshShortOp()
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        this.root.classList.add('hidden')
        this.root.innerHTML = ''
        resolve(ok)
      }
      const paint = () => {
        this.root.classList.remove('hidden')
        this.root.innerHTML = ''
        const title = document.createElement('div')
        title.className = 'shortOpTitle'
        title.textContent = def.title
        const hint = document.createElement('div')
        hint.className = 'shortOpHint'
        hint.textContent = def.hint
        this.root.append(title, hint)
        if (state.lastToast) {
          const toast = document.createElement('div')
          toast.className = 'shortOpToast'
          toast.textContent = state.lastToast
          this.root.append(toast)
        }
        for (const trap of def.traps) {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = trap.label
          button.onclick = () => {
            state = applyShortOp(def, state, trap.id)
            paint()
          }
          this.root.append(button)
        }
        for (const step of def.steps) {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = step.label
          button.onclick = () => {
            state = applyShortOp(def, state, step.id)
            if (state.done) finish(true)
            else paint()
          }
          this.root.append(button)
        }
        const leave = document.createElement('button')
        leave.type = 'button'
        leave.textContent = '离开'
        leave.onclick = () => finish(false)
        this.root.append(leave)
      }
      paint()
    })
  }
}
