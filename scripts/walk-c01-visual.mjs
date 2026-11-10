// Headless walk of C01-01→03. Needs `playwright` and a preview of `dist` at C01_URL.
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const base = process.env.C01_URL ?? 'http://127.0.0.1:4173/'
const out = '/opt/cursor/artifacts'
const viewports = [
  { name: '540x960', width: 540, height: 960 },
  { name: '390x844', width: 390, height: 844 },
  { name: '1440x900', width: 1440, height: 900 },
]
const shortSteps = {
  '收款': ['交灯', '收钱'],
  '反结': ['卸下重灯', '反结，分力穿到另一侧'],
  '拆沉水灯': ['拆开外层', '找出受扭力的那根骨', '卸力'],
  '垫踏凳': ['把踏凳垫稳', '取下防潮布'],
  '细反结': ['拆掉破骨', '系上细反结'],
}

async function readState(page) {
  return page.evaluate(() => {
    const art = document.getElementById('artBoard')?.dataset.art ?? ''
    const gate = !document.getElementById('gateCard')?.classList.contains('hidden')
    const dialog = !document.getElementById('dialog')?.classList.contains('hidden')
    const shortOp = !document.getElementById('shortOp')?.classList.contains('hidden')
    const cutaway = !document.getElementById('cutaway')?.classList.contains('hidden')
    const speaker = document.getElementById('dialog')?.dataset.speaker ?? ''
    const text = document.querySelector('#dialog .text')?.textContent ?? ''
    const still = document.getElementById('cutaway')?.dataset.still ?? ''
    const stillIndex = document.getElementById('cutaway')?.dataset.stillIndex ?? ''
    const banner = document.getElementById('c01Banner')?.textContent ?? ''
    const hotspots = [...document.querySelectorAll('#hotspotLayer button')].map(b => b.dataset.triggerId)
    const stage = document.getElementById('portraitStage')?.getBoundingClientRect()
    const figs = [...document.querySelectorAll('.portrait.shown')].map(fig => {
      const rect = fig.getBoundingClientRect()
      const img = fig.querySelector('img')?.getBoundingClientRect()
      return {
        speaker: fig.dataset.speaker,
        mode: fig.dataset.mode,
        active: fig.classList.contains('active'),
        left: rect.left,
        right: rect.right,
        width: rect.width,
        imgBottom: img?.bottom ?? 0,
        stageBottom: stage?.bottom ?? 0,
      }
    })
    let textOwner = ''
    const textEl = document.querySelector('#dialog .text')
    if (textEl && dialog) {
      const r = textEl.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(12, r.height / 2))
      const dialogEl = document.getElementById('dialog')
      textOwner = hit && dialogEl?.contains(hit) ? 'dialog' : (hit?.className || hit?.id || 'outside')
    }
    let price = null
    const priceBtn = document.querySelector('[data-trigger-id="TR_C01_01_PRICE"]')
    const board = document.getElementById('artBoard')?.getBoundingClientRect()
    if (priceBtn && board && board.width > 0) {
      const r = priceBtn.getBoundingClientRect()
        price = {
          dx: r.left - (board.left + 558 / 1080 * board.width),
          dy: r.top - (board.top + 276 / 1920 * board.height),
          dw: r.width - 214 / 1080 * board.width,
          dh: r.height - 118 / 1920 * board.height,
        }
    }
    const app = document.getElementById('app')?.getBoundingClientRect()
    return {
      art, gate, dialog, shortOp, cutaway, speaker, text, still, stillIndex, banner, hotspots, figs, textOwner, price,
      shortTitle: document.querySelector('.shortOpTitle')?.textContent ?? '',
      app: app ? { x: app.x, y: app.y, w: app.width, h: app.height } : null,
      vw: window.innerWidth,
      vh: window.innerHeight,
    }
  })
}

function bodyGap(figs) {
  const bodies = figs.map(fig => {
    const cx = (fig.left + fig.right) / 2
    const half = fig.width * 0.32
    return { speaker: fig.speaker, left: cx - half, right: cx + half }
  }).sort((a, b) => a.left - b.left)
  let gap = Infinity
  for (let i = 1; i < bodies.length; i++) gap = Math.min(gap, bodies[i].left - bodies[i - 1].right)
  return gap
}

async function snap(page, file) {
  await page.waitForTimeout(320)
  await page.screenshot({ path: `${out}/${file}.png` })
  console.log('shot', file)
}

function shapeCenter(shape) {
  if (shape.kind === 'circle') return { x: shape.x, y: shape.y }
  return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 }
}
function shapeKey(shape) {
  if (shape.kind === 'circle') return `c:${shape.x}:${shape.y}:${shape.r}`
  return `b:${shape.x}:${shape.y}:${shape.w}:${shape.h}`
}
function findShape(maps, id) {
  for (const map of Object.values(maps)) {
    const row = map.triggers.find(t => t.id === id)
    if (row?.shape) return row.shape
  }
  return null
}
function shapeContains(shape, px, py) {
  if (shape.kind === 'circle') return Math.hypot(px - shape.x, py - shape.y) <= shape.r + 1
  return px >= shape.x - 1 && py >= shape.y - 1 && px <= shape.x + shape.w + 1 && py <= shape.y + shape.h + 1
}

async function assertChoices(page, name) {
  const buttons = page.locator('#dialog button')
  const count = await buttons.count()
  if (!count) return []
  const vp = page.viewportSize()
  const texts = []
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i)
    const box = await button.boundingBox()
    const text = (await button.innerText()).trim()
    texts.push(text)
    if (!box) throw new Error(`${text} has no box on ${name}`)
    const inside = box.x >= -1 && box.y >= -1 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1
    if (!inside) throw new Error(`${text} is clipped on ${name}: ${JSON.stringify(box)} vp ${vp.width}x${vp.height}`)
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return el?.closest?.('button') === el ? (el.textContent || '').trim() : (el?.className || el?.id || 'none')
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    if (hit !== text) throw new Error(`${text} elementFromPoint hit ${JSON.stringify(hit)} on ${name}`)
  }
  const question = page.locator('#dialog .text')
  const qBox = await question.boundingBox()
  if (!qBox) throw new Error(`choice question missing on ${name}`)
  const qInside = qBox.x >= -1 && qBox.y >= -1 && qBox.x + qBox.width <= vp.width + 1 && qBox.y + qBox.height <= vp.height + 1
  if (!qInside) throw new Error(`choice question clipped on ${name}`)
  const qHit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    if (!el) return 'none'
    if (el.closest('button')) return 'button'
    return document.getElementById('dialog')?.contains(el) ? 'dialog' : (el.className || 'outside')
  }, { x: qBox.x + qBox.width / 2, y: qBox.y + Math.min(8, qBox.height / 2) })
  if (qHit !== 'dialog') throw new Error(`choice plate covers the question on ${name}: ${qHit}`)
  return texts
}

async function clickHotspotAtShape(page, maps, clicked) {
  const info = await page.evaluate(() => {
    const board = document.getElementById('artBoard').getBoundingClientRect()
    const buttons = [...document.querySelectorAll('#hotspotLayer button')].map(b => {
      const r = b.getBoundingClientRect()
      return { id: b.dataset.triggerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
    })
    return { board: { x: board.left, y: board.top, w: board.width, h: board.height }, buttons }
  })
  if (!info.buttons.length) return null
  const pick = info.buttons.find(b => b.id !== 'TR_C01_01_EXIT' && b.id !== 'TR_C01_01_BACK') || info.buttons[0]
  const shape = findShape(maps, pick.id)
  if (!shape) throw new Error(`no shape for ${pick.id}`)
  const center = shapeCenter(shape)
  const siblings = info.buttons.filter(b => shapeKey(findShape(maps, b.id)) === shapeKey(shape))
  let x = info.board.x + center.x / 1080 * info.board.w
  let y = info.board.y + center.y / 1920 * info.board.h
  if (siblings.length > 1) {
    const px = ((pick.cx - info.board.x) / info.board.w) * 1080
    const py = ((pick.cy - info.board.y) / info.board.h) * 1920
    if (!shapeContains(shape, px, py)) throw new Error(`${pick.id} label is outside its shape`)
    x = pick.cx
    y = pick.cy
  }
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    return el?.closest?.('[data-trigger-id]')?.dataset?.triggerId ?? null
  }, { x, y })
  if (hit !== pick.id) throw new Error(`shape click for ${pick.id} hit ${hit} at ${x.toFixed(1)},${y.toFixed(1)}`)
  await page.mouse.click(x, y)
  clicked.add(pick.id)
  return pick.id
}

async function act(page, state, maps, clicked) {
  if (state.dialog) {
    const choice = page.locator('#dialog button', { hasText: '分期延后' })
    if (await choice.count()) { await choice.first().click(); return 'choice' }
    const any = page.locator('#dialog button')
    if (await any.count()) { await any.first().click(); return 'choice' }
    await page.locator('#dialog').click()
    return 'dialog'
  }
  if (state.shortOp) {
    const steps = shortSteps[state.shortTitle] ?? []
    if (!steps.length) throw new Error(`unknown short op ${state.shortTitle}`)
    for (const label of steps) {
      const button = page.locator('#shortOp button', { hasText: label })
      if (!await button.count()) throw new Error(`missing short-op step ${label}`)
      await button.first().click()
    }
    return `op:${state.shortTitle}`
  }
  if (state.gate) { await page.locator('#gateEnter').click(); return 'gate' }
  const hotId = await clickHotspotAtShape(page, maps, clicked)
  if (hotId) return `hotspot:${hotId}`
  return 'idle'
}

async function walk(page, name) {
  const errors = []
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text())
    if (msg.type() === 'warning' && /walk layer|git-lfs|missing/i.test(msg.text())) errors.push(msg.text())
  })
  page.on('pageerror', err => errors.push(String(err)))
  page.on('response', res => {
    if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`)
  })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('#enterC01')
  const hidden = {}
  for (const id of ['enter', 'continue', 'enterTown', 'legacyTitle']) {
    hidden[id] = await page.locator(`#${id}`).isVisible()
  }
  if (Object.values(hidden).some(Boolean)) throw new Error(`old title entries visible on ${name}: ${JSON.stringify(hidden)}`)
  if (!await page.locator('#enterC01').isVisible()) throw new Error('chapter entry hidden')
  await snap(page, `title-${name}`)
  await page.locator('#enterC01').click()
  await page.waitForSelector('#gateCard:not(.hidden)')
  await page.waitForFunction(() => {
    const img = document.querySelector('#sceneBg')
    return img && img.complete && img.naturalWidth === 1080
  })
  await snap(page, `chapter-${name}`)
  const maps = {}
  for (const id of ['C01_SHOP', 'C01_STREET']) {
    maps[id] = await (await page.request.get(`${base}config/walkmaps/${id}.json`)).json()
  }
  const seen = new Set()
  const clicked = new Set()
  const choicesSeen = new Set()
  let stuck = ''
  let stuckN = 0
  let priceChecked = false
  for (let step = 0; step < 420; step++) {
    const state = await readState(page)
    const sig = [state.art, state.speaker, state.stillIndex, state.shortTitle, state.gate, state.hotspots.join(',')].join('|')
    if (sig === stuck) stuckN += 1
    else { stuck = sig; stuckN = 0 }
    if (stuckN > 6) throw new Error(`stuck on ${name} after ${sig}`)
    if (state.figs.length >= 2 && !seen.has('pair')) {
      seen.add('pair')
      const gap = bodyGap(state.figs)
      const feet = state.figs.map(fig => Math.abs(fig.imgBottom - fig.stageBottom))
      if (state.textOwner !== 'dialog') throw new Error(`portrait covers dialogue on ${name}: ${state.textOwner}`)
      if (feet.some(d => d > 2)) throw new Error(`feet floating on ${name}: ${JSON.stringify(feet)}`)
      if (state.figs.some(fig => fig.mode !== 'cutout')) throw new Error('portrait not in cutout mode')
      if (gap < 8) throw new Error(`portraits overlap on ${name}: gap ${gap.toFixed(1)}`)
      await snap(page, `portraits-${name}`)
      console.log('pair', name, { gap: gap.toFixed(1), feet, speakers: state.figs.map(f => f.speaker) })
    }
    if (state.figs.some(fig => fig.speaker === '？？？' && fig.active) && !seen.has('unknown')) {
      seen.add('unknown')
      const feet = Math.abs(state.figs.find(fig => fig.speaker === '？？？').imgBottom - state.figs.find(fig => fig.speaker === '？？？').stageBottom)
      if (feet > 2) throw new Error(`unknown feet floating on ${name}`)
      if (state.textOwner !== 'dialog') throw new Error(`unknown covers dialogue on ${name}`)
      await snap(page, `silhouette-${name}`)
    }
    if (state.figs.some(fig => fig.speaker === '晏归') && state.figs.some(fig => fig.speaker === '许照宁') && !seen.has('yan')) {
      seen.add('yan')
      const gap = bodyGap(state.figs)
      if (gap < 8) throw new Error(`晏归 overlaps 许照宁 on ${name}: gap ${gap.toFixed(1)}`)
      if (name === '390x844') await snap(page, `portraits-yan-${name}`)
      console.log('yan pair', name, gap.toFixed(1))
    }
    if (!state.dialog && !state.shortOp && !state.cutaway && state.hotspots.length && state.art && !seen.has(`bg:${state.art}`)) {
      seen.add(`bg:${state.art}`)
      const tag = state.art.includes('SHOP_day') ? 'shop-day'
        : state.art.includes('STREET') ? 'street'
        : state.art.includes('dusk') ? 'shop-dusk'
        : state.art.includes('ATTIC') ? 'attic' : 'bg'
      await snap(page, `${tag}-${name}`)
      if (tag === 'shop-day' && state.price) {
        priceChecked = true
        const off = Math.max(Math.abs(state.price.dx), Math.abs(state.price.dy), Math.abs(state.price.dw), Math.abs(state.price.dh))
        if (off > 3) throw new Error(`价牌 hotspot misaligned on ${name}: ${JSON.stringify(state.price)}`)
        console.log('price align', name, state.price)
      }
    }
    if (state.cutaway && state.still && !seen.has(`still:${state.still}:${state.stillIndex}`)) {
      seen.add(`still:${state.still}:${state.stillIndex}`)
      const tag = state.still.includes('TAO') ? 'cut-tao' : `cut-fakeseal-${state.stillIndex}`
      await page.waitForFunction(() => {
        const img = document.querySelector('#cutawayStill')
        return img && img.complete && img.naturalWidth === 1080
      })
      await snap(page, `${tag}-${name}`)
    }
    if (state.banner.includes('C01-03 完成')) {
      await snap(page, `done-${name}`)
      if (!seen.has('pair') || !seen.has('unknown') || !priceChecked) throw new Error(`missed a required shot on ${name}: ${[...seen].join(', ')}`)
      for (const key of ['shop-day', 'street', 'shop-dusk', 'attic', 'cut-tao', 'cut-fakeseal-0', 'cut-fakeseal-1', 'cut-fakeseal-2']) {
        if (![...seen].some(item => item.startsWith('bg:') || item.startsWith('still:')) && false) throw new Error(key)
      }
      const required = ['bg:assets/c01/bg/C01_SHOP_day.webp', 'bg:assets/c01/bg/C01_STREET_day.webp', 'bg:assets/c01/bg/C01_SHOP_dusk.webp', 'bg:assets/c01/bg/C01_ATTIC.webp']
      for (const key of required) if (!seen.has(key)) throw new Error(`missing ${key} on ${name}`)
      if (errors.length) throw new Error(`console errors on ${name}: ${errors.join(' | ')}`)
      const app = state.app
      const ratio = app.w / app.h
      if (Math.abs(ratio - 9 / 16) > 0.02) throw new Error(`frame ratio ${ratio} on ${name}`)
      if (name === '1440x900' && app.w > 700) throw new Error('desktop frame is not letterboxed')
      if (name === '390x844' && app.w > 390) throw new Error('phone frame wider than the viewport')
      for (const label of ['收下杉木', '分期延后', '只留张欠条']) {
        if (!choicesSeen.has(label)) throw new Error(`choice ${label} was not checked on ${name}`)
      }
      const requiredClicks = [
        'TR_C01_01_PRICE', 'TR_C01_01_PURSE', 'TR_C01_01_LAMPS', 'TR_C01_01_EXIT', 'TR_C01_01_SCISSORS',
        'TR_C01_02_YANGUI_IN', 'TR_C01_02_KNOT_Q', 'MG_C01_02_SUNKLAMP', 'CH_C01_02_DEPOSIT', 'TR_C01_02_BEAM', 'TR_C01_02_TASSEL',
        'TR_C01_01_HE', 'TR_C01_01_YAN2', 'CH_C01_01_YAN2_DEBT', 'TR_C01_01_TAO', 'TR_C01_01_CHENG', 'MG_C01_01_ANTIKNOT', 'TR_C01_01_BACK',
        'TR_C01_03_ENTER', 'TR_C01_03_BOWLS', 'TR_C01_03_BOWL_WEAR', 'MG_C01_03_STOOL', 'MG_C01_03_OLDLAMP', 'TR_C01_03_PRESS',
      ]
      const missed = requiredClicks.filter(id => !clicked.has(id))
      if (missed.length) throw new Error(`hotspots not clicked on ${name}: ${missed.join(', ')}`)
      console.log('finished', name, { errors: errors.length, app, choices: [...choicesSeen], clicks: clicked.size })
      return
    }
    if (state.dialog && await page.locator('#dialog button').count()) {
      for (const text of await assertChoices(page, name)) choicesSeen.add(text)
    }
    const what = await act(page, state, maps, clicked)
    if (what === 'idle') throw new Error(`nothing to do on ${name}: ${JSON.stringify(state)}`)
    await page.waitForTimeout(40)
  }
  throw new Error(`did not finish ${name}`)
}

await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
    await walk(page, vp.name)
    await page.close()
  }
  const dev = await browser.newPage({ viewport: { width: 540, height: 960 } })
  await dev.goto(`${base}?dev=1`, { waitUntil: 'networkidle' })
  await dev.waitForSelector('#enter')
  if (!await dev.locator('#enter').isVisible()) throw new Error('dev flag did not show 开始游戏')
  if (!await dev.locator('#enterTown').isVisible()) throw new Error('dev flag did not show SC_03')
  if (!await dev.locator('#legacyTitle').isVisible()) throw new Error('dev flag did not show the old title')
  if (await dev.locator('#dengduTitle').isVisible()) throw new Error('dev flag still shows the 灯渡 title block')
  await snap(dev, 'title-dev-540x960')
  await dev.close()
} finally {
  await browser.close()
}
console.log('c01 visual walk ok')
