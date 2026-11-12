import type { ChoiceRow, DialogueLine, DialogueRow } from '../data/types'

/** Bottom subtitle strip. The portrait is a head crop of the standing webp. */
export class DialogueBar {
  open = false
  text = ''
  private wait: (() => void) | null = null
  private choice: ChoiceRow | null = null
  private readonly face = new Map<string, string>()
  private readonly img: HTMLImageElement
  private readonly who: HTMLElement
  private readonly line: HTMLElement
  private readonly choices: HTMLElement
  private readonly hint: HTMLElement

  constructor(private host: HTMLElement, private portraits: Record<string, string>) {
    host.innerHTML = ''
    this.img = document.createElement('img')
    this.img.alt = ''
    this.img.className = 'face'
    const body = document.createElement('div')
    body.className = 'dlgBody'
    this.who = document.createElement('div')
    this.who.className = 'who'
    this.line = document.createElement('div')
    this.line.className = 'line'
    this.choices = document.createElement('div')
    this.choices.className = 'choices'
    this.hint = document.createElement('div')
    this.hint.className = 'hint'
    body.append(this.who, this.line, this.choices, this.hint)
    host.append(this.img, body)
    host.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('button')) return
      if (this.choices.childElementCount > 0) return
      this.advance()
    })
  }

  play(row: DialogueRow): Promise<ChoiceRow | null> {
    return new Promise(resolve => {
      let index = 0
      const show = () => {
        const line = row.lines[index]
        if (!line) {
          this.hide()
          resolve(null)
          return
        }
        const last = index === row.lines.length - 1
        this.open = true
        this.text = line.text
        this.choice = null
        this.paint(line, last ? row.choices : [])
      }
      this.wait = () => {
        if (this.choice) {
          const picked = this.choice
          this.choice = null
          this.hide()
          resolve(picked)
          return
        }
        if (index >= row.lines.length - 1) {
          this.hide()
          resolve(null)
        } else {
          index += 1
          show()
        }
      }
      show()
    })
  }

  advance() {
    this.wait?.()
  }

  private paint(line: DialogueLine, choices: ChoiceRow[]) {
    this.host.classList.remove('hidden')
    this.who.textContent = line.speaker
    this.line.textContent = line.text
    this.choices.innerHTML = ''
    const src = this.portraits[line.speaker]
    if (!src) {
      this.img.removeAttribute('src')
      this.img.classList.add('empty')
    } else {
      this.img.classList.remove('empty')
      const cached = this.face.get(line.speaker)
      if (cached) this.img.src = cached
      else this.crop(line.speaker, src)
    }
    if (choices.length) {
      this.hint.textContent = ''
      for (const choice of choices) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = choice.text
        button.addEventListener('click', event => {
          event.stopPropagation()
          this.choice = choice
          this.advance()
        })
        this.choices.append(button)
      }
    } else {
      this.hint.textContent = '点击继续'
    }
  }

  private crop(speaker: string, src: string) {
    const image = new Image()
    image.onload = () => {
      const size = 128
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#241c16'
      ctx.fillRect(0, 0, size, size)
      const side = image.naturalWidth * 0.46
      const sx = (image.naturalWidth - side) / 2
      const sy = image.naturalHeight * 0.045
      ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size)
      const url = canvas.toDataURL('image/png')
      this.face.set(speaker, url)
      if (this.who.textContent === speaker) this.img.src = url
    }
    image.src = src
  }

  private hide() {
    this.open = false
    this.text = ''
    this.wait = null
    this.host.classList.add('hidden')
  }
}
