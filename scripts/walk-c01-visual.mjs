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
        dx: r.left - (board.left + 640 / 1080 * board.width),
        dy: r.top - (board.top + 320 / 1920 * board.height),
        dw: r.width - 150 / 1080 * board.width,
        dh: r.height - 80 / 1920 * board.height,
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

async function act(page, state) {
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
  const hot = page.locator('#hotspotLayer button')
  const count = await hot.count()
  if (count) {
    let target = hot.first()
    for (let i = 0; i < count; i++) {
      const id = await hot.nth(i).getAttribute('data-trigger-id')
      if (id !== 'TR_C01_01_EXIT' && id !== 'TR_C01_01_BACK') { target = hot.nth(i); break }
    }
    await target.click()
    return 'hotspot'
  }
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
  const seen = new Set()
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
      console.log('finished', name, { errors: errors.length, app })
      return
    }
    const what = await act(page, state)
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
