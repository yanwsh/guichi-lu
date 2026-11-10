import { readFileSync } from 'node:fs'
import type { HotspotMap, HotspotTrigger } from '../src/data/hotspotTypes.ts'
import { applyShortOp, freshShortOp, shortOpForTrigger } from '../src/shortop/shortOps.ts'
import {
  YAN2_DEBT,
  allowedHop,
  applySetFlags,
  nextAuto,
  nextEnter,
  openBeat,
  triggerEligible,
  visibleHotspots,
} from '../src/walk/c01Flow.ts'

const load = (id: string) => JSON.parse(readFileSync(`public/config/walkmaps/${id}.json`, 'utf8')) as HotspotMap
const shop = load('C01_SHOP')
const street = load('C01_STREET')
const gate = load('CH1_GATE')
const dialogues = JSON.parse(readFileSync('public/config/dialogues.json', 'utf8')) as {
  dialogue_id: string
  lines: { text: string }[]
  choices: { text: string; value: number; set_flag: string }[]
}[]
const byDlg = new Map(dialogues.map(row => [row.dialogue_id, row]))

function fail(msg: string): never { throw new Error(msg) }
function flagsOf(extra: Record<string, number> = {}) {
  const flags: Record<string, number> = {}
  for (const row of JSON.parse(readFileSync('public/config/flags.json', 'utf8')) as { flag_id: string; default: number }[]) {
    flags[row.flag_id] = row.default
  }
  return Object.assign(flags, extra)
}
function trig(map: HotspotMap, id: string) {
  const row = map.triggers.find(t => t.id === id)
  if (!row) fail(`missing ${id}`)
  return row
}
function mustEligible(t: HotspotTrigger, flags: Record<string, number>, triggered: string[], scene: string) {
  if (!triggerEligible(t, flags, triggered, scene)) fail(`${t.id} should be eligible`)
}
function mustHidden(t: HotspotTrigger, flags: Record<string, number>, triggered: string[], scene: string) {
  if (triggerEligible(t, flags, triggered, scene)) fail(`${t.id} should stay hidden`)
}

const flags = flagsOf()
const seen: string[] = []
mustEligible(trig(gate, 'TR_CH1_GATE_START'), flags, seen, 'CH1_GATE')
applySetFlags(flags, ['c01_started'])
if (!allowedHop('CH1_GATE', 'C01_SHOP')) fail('gate hop')
if (allowedHop('C01_SHOP', 'C01_FIRE') || allowedHop('C01_SHOP', 'C01_END_STUB')) fail('later hop leaked')

const enter = nextEnter(shop.triggers, flags, seen, 'C01_SHOP')
if (enter?.id !== 'TR_C01_01_ENTER') fail(`enter ${enter?.id}`)
applySetFlags(flags, enter.result?.set_flags)
seen.push(enter.id)
if (flags.c01_phase_day !== 1) fail('day phase')

mustHidden(trig(shop, 'TR_C01_03_BOWLS'), flags, seen, 'C01_SHOP')
mustHidden(trig(shop, 'TR_C01_04_BREAKIN'), flags, seen, 'C01_SHOP')
mustHidden(trig(shop, 'TR_C01_01_EXIT'), flags, seen, 'C01_SHOP')
mustHidden(trig(shop, 'TR_C01_01_LAMPS'), flags, seen, 'C01_SHOP')

applySetFlags(flags, ['c01_purse_merged'])
mustEligible(trig(shop, 'TR_C01_01_LAMPS'), flags, seen, 'C01_SHOP')
applySetFlags(flags, ['c01_lamps_picked'])
mustEligible(trig(shop, 'TR_C01_01_EXIT'), flags, seen, 'C01_SHOP')
if (!allowedHop('C01_SHOP', 'C01_STREET')) fail('street hop')

mustEligible(trig(street, 'TR_C01_01_HE'), flags, seen, 'C01_STREET')
mustHidden(trig(street, 'TR_C01_01_BACK'), flags, seen, 'C01_STREET')
mustHidden(trig(street, 'MG_C01_01_ANTIKNOT'), flags, seen, 'C01_STREET')
const collect = shortOpForTrigger('TR_C01_01_HE')
if (!collect) fail('collect op')
let op = freshShortOp()
op = applyShortOp(collect, op, 'pay')
if (op.done || op.lastToast !== '还不到这一步。') fail('collect order')
op = applyShortOp(collect, op, 'hand')
op = applyShortOp(collect, op, 'pay')
if (!op.done) fail('collect done')
applySetFlags(flags, ['c01_paid_he'])

const debt = byDlg.get('DLG_C01A_07')
if (!debt || debt.choices.map(c => c.value).join() !== `${YAN2_DEBT.wood},${YAN2_DEBT.installment},${YAN2_DEBT.iou}`) fail('debt choices')
if (debt.choices.map(c => c.text).join('|') !== '收下杉木|分期延后|只留张欠条') fail('debt labels')
flags.c01_yan2_debt = YAN2_DEBT.installment
applySetFlags(flags, ['c01_yan2_debt'])
if (flags.c01_yan2_debt !== YAN2_DEBT.installment) fail('enum clobber')

mustEligible(trig(street, 'MG_C01_01_ANTIKNOT'), flags, seen, 'C01_STREET')
const knot = shortOpForTrigger('MG_C01_01_ANTIKNOT')
if (!knot) fail('antiknot op')
op = freshShortOp()
op = applyShortOp(knot, op, 'pull_tight')
if (op.done || !op.lastToast.includes('裂响')) fail('antiknot trap')
op = applyShortOp(knot, op, 'reknot')
if (op.step !== 0) fail('antiknot skip')
op = applyShortOp(knot, op, 'unload')
op = applyShortOp(knot, op, 'reknot')
if (!op.done) fail('antiknot done')
applySetFlags(flags, ['c01_anti_knot_learned', 'c01_cheng_lamp_hung'])
mustEligible(trig(street, 'TR_C01_01_BACK'), flags, seen, 'C01_STREET')
if (!allowedHop('C01_STREET', 'C01_SHOP')) fail('back hop')

mustEligible(trig(shop, 'TR_C01_01_SCISSORS'), flags, seen, 'C01_SHOP')
applySetFlags(flags, ['c01_scissors_scene', 'c01_purse_returned'])
const done01 = nextAuto(shop.triggers, flags, seen, 'C01_SHOP')
if (done01?.id !== 'TR_C01_01_DONE') fail(`auto ${done01?.id}`)
applySetFlags(flags, done01.result?.set_flags)
if (flags.c01_01_done !== 1 || flags.c01_phase_yan !== 1 || flags.c01_phase_day !== 0) fail('phase overwrite')
if (openBeat(flags) !== 'C01-02') fail('beat 02')
mustHidden(trig(shop, 'TR_C01_01_EXIT'), flags, seen, 'C01_SHOP')
mustEligible(trig(shop, 'TR_C01_02_YANGUI_IN'), flags, seen, 'C01_SHOP')

const sunk = shortOpForTrigger('MG_C01_02_SUNKLAMP')
if (!sunk) fail('sunk op')
op = freshShortOp()
op = applyShortOp(sunk, op, 'shell')
op = applyShortOp(sunk, op, 'rib')
op = applyShortOp(sunk, op, 'ease')
if (!op.done) fail('sunk done')
applySetFlags(flags, ['c01_sunk_lamp_fixed', 'c01_yangui_deposit', 'c01_no_contraband_stated', 'c01_yangui_wary', 'c01_tassel_reacted'])
const cut = nextAuto(shop.triggers, flags, seen, 'C01_SHOP')
if (cut?.id !== 'CUT_C01_02_FAKESEAL') fail(`cut ${cut?.id}`)
applySetFlags(flags, cut.result?.set_flags)
if (flags.c01_02_done !== 1 || flags.c01_phase_night !== 1 || flags.c01_phase_yan !== 0) fail('night phase')

mustEligible(trig(shop, 'TR_C01_03_BOWLS'), flags, seen, 'C01_SHOP')
applySetFlags(flags, ['c01_empty_bowl_seen', 'c01_bowl_wear_seen'])
if (nextAuto(shop.triggers, flags, seen, 'C01_SHOP')?.id !== 'TR_C01_03_ATTIC_SOUND') fail('attic auto')
seen.push('TR_C01_03_ATTIC_SOUND')
const stool = shortOpForTrigger('MG_C01_03_STOOL')
if (!stool) fail('stool op')
op = freshShortOp()
op = applyShortOp(stool, op, 'cloth')
if (op.done) fail('stool order')
op = applyShortOp(stool, op, 'set')
op = applyShortOp(stool, op, 'cloth')
if (!op.done) fail('stool done')
flags.c01_stool_set = 1
const old = shortOpForTrigger('MG_C01_03_OLDLAMP')
if (!old || !triggerEligible(trig(shop, 'MG_C01_03_OLDLAMP'), flags, seen, 'C01_SHOP')) fail('old lamp')
applySetFlags(flags, ['c01_old_lamp_knotted'])
if (nextAuto(shop.triggers, flags, seen, 'C01_SHOP')?.id !== 'TR_C01_03_VOICE') fail('voice once-auto')
applySetFlags(flags, ['c01_old_lamp_voice_heard'])
mustEligible(trig(shop, 'TR_C01_03_PRESS'), flags, seen, 'C01_SHOP')
applySetFlags(flags, ['c01_mother_same_press', 'c01_03_done'])
if (openBeat(flags) !== 'done') fail('done beat')
mustHidden(trig(shop, 'TR_C01_04_BREAKIN'), flags, seen, 'C01_SHOP')
mustHidden(trig(shop, 'TR_C01_04_EXIT'), flags, seen, 'C01_SHOP')
if (visibleHotspots(shop, flags, seen).length !== 0) fail('hotspots after 03')

const {
  cutoutSlots,
  devEntriesOn,
  isLfsPointer,
  referencedFiles,
  resolveArtRef,
  slotsOverlap,
  stillAt,
} = await import('../src/scene/c01Art.ts')
const visual = JSON.parse(readFileSync('public/config/c01_visual.json', 'utf8')) as {
  dev_entries: boolean
  subtitle_y: number
  body_half_frac: number
  canvas: { h: number }
  portrait_anchor: { x: number; y: number; w: number; h: number }
  backgrounds: Record<string, string>
  chapter_card: { src: string; title_y: number; title_h: number }
  cutaways: Record<string, { stills: string[] }>
  portraits: Record<string, { src: string; mode: string; generated?: boolean }>
}
if (visual.dev_entries) fail('dev entries default on')
if (visual.subtitle_y !== 1180) fail('subtitle band')
if (visual.chapter_card.title_y !== 600 || visual.chapter_card.title_h !== 400) fail('title band')
if (visual.portrait_anchor.x !== 512 || visual.portrait_anchor.y !== 1536) fail('portrait anchor')
const files = referencedFiles(visual)
if (files.some(file => file.includes('placeholder/'))) fail('placeholder path in visual config')
for (const file of files) {
  const buf = readFileSync(file.startsWith('public/') ? file : `public/${file}`)
  if (buf.length < 1000) fail(`art too small ${file}`)
  if (isLfsPointer(buf)) fail(`lfs pointer ${file}`)
}
for (const map of [shop, street, gate]) {
  const refs = [map.art_ref, ...map.triggers.map(t => t.art_ref)].filter((ref): ref is string => !!ref)
  for (const ref of refs) if (!visual.backgrounds[ref]) fail(`unmapped art_ref ${ref}`)
}
const seal = visual.cutaways.CUT_C01_02_FAKESEAL?.stills ?? []
const tao = visual.cutaways.TR_C01_01_TAO?.stills ?? []
if (seal.length !== 3) fail('fakeseal stills')
if (new Set(seal).size !== 3) fail('fakeseal stills repeat')
if (tao.length !== 1) fail('tao still')
if (stillAt(seal, 0) !== seal[0] || stillAt(seal, 1) !== seal[1] || stillAt(seal, 2) !== seal[2] || stillAt(seal, 9) !== seal[2]) fail('still advance')
if (stillAt(tao, 1) !== tao[0]) fail('tao holds')
const speakerRows = JSON.parse(readFileSync('public/config/dialogues.json', 'utf8')) as {
  dialogue_id: string
  lines: { speaker: string }[]
  choices: { followup_lines?: { speaker: string }[] }[]
}[]
const speakers = new Set<string>()
for (const row of speakerRows) {
  if (!/^DLG_C01[ABC]_/.test(row.dialogue_id)) continue
  for (const line of row.lines) speakers.add(line.speaker)
  for (const choice of row.choices) for (const line of choice.followup_lines ?? []) speakers.add(line.speaker)
}
speakers.delete('旁白')
const catalog = new Set(Object.keys(visual.portraits))
for (const name of speakers) if (!catalog.has(name)) fail(`speaker without portrait ${name}`)
for (const name of catalog) if (!speakers.has(name)) fail(`unused portrait ${name}`)
for (const [name, portrait] of Object.entries(visual.portraits)) {
  if (portrait.mode !== 'cutout') fail(`default mode ${name}`)
  if (name === '？？？' && !portrait.generated) fail('unknown silhouette should be generated')
  if (name !== '？？？' && portrait.generated) fail(`generated flag on ${name}`)
}
const anchor = visual.portrait_anchor
const one = cutoutSlots(1, 1000, anchor.x, anchor.w, visual.body_half_frac)[0]
const expectedLeft = 1000 * 0.68 - 1000 * 0.62 * (anchor.x / anchor.w)
if (!one || Math.abs(one.left - expectedLeft) > 0.01) fail('anchor placement')
for (const width of [360, 374, 390]) {
  if (slotsOverlap(cutoutSlots(2, width, anchor.x, anchor.w, visual.body_half_frac))) fail(`pair overlap ${width}`)
  if (slotsOverlap(cutoutSlots(3, width, anchor.x, anchor.w, visual.body_half_frac))) fail(`trio overlap ${width}`)
}
if (devEntriesOn(false, '') || !devEntriesOn(false, '?dev=1') || devEntriesOn(true, '?dev=0') || !devEntriesOn(true, '')) fail('dev flag')
const dayRef = resolveArtRef(shop, flagsOf({ c01_started: 1, c01_phase_day: 1 }), ['TR_C01_01_ENTER'])
if (visual.backgrounds[dayRef ?? ''] !== 'assets/c01/bg/C01_SHOP_day.webp') fail(`day art ${dayRef}`)
const duskRef = resolveArtRef(shop, flagsOf({ c01_started: 1, c01_01_done: 1, c01_02_done: 1, c01_phase_night: 1 }), [])
if (visual.backgrounds[duskRef ?? ''] !== 'assets/c01/bg/C01_SHOP_dusk.webp') fail(`dusk art ${duskRef}`)
const atticRef = resolveArtRef(
  shop,
  flagsOf({ c01_started: 1, c01_01_done: 1, c01_02_done: 1, c01_phase_night: 1, c01_empty_bowl_seen: 1, c01_bowl_wear_seen: 1 }),
  ['TR_C01_03_ENTER', 'TR_C01_03_BOWLS', 'TR_C01_03_BOWL_WEAR'],
)
if (visual.backgrounds[atticRef ?? ''] !== 'assets/c01/bg/C01_ATTIC.webp') fail(`attic art ${atticRef}`)
const streetRef = resolveArtRef(street, flagsOf({ c01_started: 1, c01_phase_day: 1, c01_lamps_picked: 1 }), [])
if (visual.backgrounds[streetRef ?? ''] !== 'assets/c01/bg/C01_STREET_day.webp') fail(`street art ${streetRef}`)

const hooks = ['就把剪刀也替我拿着', '站远些', '多费这一点', '我买了三十年东西，还得你领着', '谁教你这样接', '做久了就会', '我可不替你藏', '别咬线。']
const blob = dialogues.filter(d => /^DLG_C01[ABC]_/.test(d.dialogue_id)).map(d => d.lines.map(l => l.text).join('\n')).join('\n')
for (const hook of hooks) if (!blob.includes(hook)) fail(`missing hook ${hook}`)
for (const row of dialogues) {
  if (!/^DLG_C01[ABC]_/.test(row.dialogue_id)) continue
  if (row.choices.some(c => c.text.includes('忘记'))) fail('forget button')
}
if (byDlg.get('DLG_C01D_01')?.lines[0].text !== '（骨架占位）') fail('later dialogue touched')
if (byDlg.get('DLG_P01_01')?.lines[0].text !== '（骨架占位）') fail('prologue dialogue touched')
const antiknot = street.triggers.find(t => t.id === 'MG_C01_01_ANTIKNOT')
if (!antiknot?.shape || antiknot.shape.kind !== 'box' || antiknot.shape.x !== 318 || antiknot.shape.y !== 392 || antiknot.shape.w !== 118 || antiknot.shape.h !== 392) fail('antiknot box')

console.log('c01 playable checks ok', { beat: openBeat(flags), debt: flags.c01_yan2_debt })
