import type { HotspotMap, HotspotShape, HotspotTrigger } from '../data/hotspotTypes'

/** 本轮只开放这三场。C01_FIRE / C01_AFTER / C01_END_STUB 不进。 */
export const HOTSPOT_SCENES = ['CH1_GATE', 'C01_SHOP', 'C01_STREET'] as const

const PLAYABLE_BEATS = new Set(['C01-01', 'C01-02', 'C01-03'])

const PHASES = ['c01_phase_day', 'c01_phase_yan', 'c01_phase_night', 'c01_phase_door', 'c01_phase_depart']

/** 抉择写入的枚举。后面的 set_flags 不得把它抹成 1。 */
const ENUM_FLAGS = new Set(['c01_yan2_debt', 'c01_departure_letter_danger'])

export const YAN2_DEBT = { wood: 1, installment: 2, iou: 3 } as const

const HOPS = new Set(['CH1_GATE>C01_SHOP', 'C01_SHOP>C01_STREET', 'C01_STREET>C01_SHOP'])

const LABELS: Record<string, string> = {
  TR_CH1_GATE_START: '进入青蒲灯铺',
  TR_C01_01_ENTER: '下楼',
  TR_C01_01_PRICE: '价牌',
  TR_C01_01_PURSE: '修屋匣',
  TR_C01_01_LAMPS: '取送灯',
  TR_C01_01_EXIT: '去镇街',
  TR_C01_01_SCISSORS: '裁案剪刀',
  TR_C01_01_HE: '收款',
  TR_C01_01_YAN2: '严二',
  CH_C01_01_YAN2_DEBT: '严二的账',
  TR_C01_01_TAO: '陶慎路过',
  TR_C01_01_CHENG: '程婶',
  MG_C01_01_ANTIKNOT: '反结挂灯',
  TR_C01_01_BACK: '回灯铺',
  TR_C01_02_YANGUI_IN: '晏归进门',
  TR_C01_02_KNOT_Q: '问接法',
  MG_C01_02_SUNKLAMP: '拆沉水灯',
  CH_C01_02_DEPOSIT: '收订金',
  TR_C01_02_BEAM: '看他记梁',
  TR_C01_02_TASSEL: '灯穗',
  TR_C01_03_ENTER: '饭桌',
  TR_C01_03_BOWLS: '空碗',
  TR_C01_03_BOWL_WEAR: '碗底磨痕',
  MG_C01_03_STOOL: '垫踏凳',
  MG_C01_03_OLDLAMP: '细反结',
  TR_C01_03_PRESS: '同压一结',
}

export function isHotspotScene(sceneId: string): boolean {
  return (HOTSPOT_SCENES as readonly string[]).includes(sceneId)
}

export type OpenBeat = 'C01-01' | 'C01-02' | 'C01-03' | 'done'

export function openBeat(flags: Record<string, number>): OpenBeat {
  if (!flags.c01_01_done) return 'C01-01'
  if (!flags.c01_02_done) return 'C01-02'
  if (!flags.c01_03_done) return 'C01-03'
  return 'done'
}

export function allowedHop(from: string, to: string): boolean {
  return HOPS.has(`${from}>${to}`)
}

export function reqMet(trigger: HotspotTrigger, flags: Record<string, number>): boolean {
  const need = trigger.req?.flags_all ?? []
  return need.every(flag => !!flags[flag])
}

/** 只放行当前场。空 req 的后场热点不会在昼间亮。C01-04 起一律不亮。 */
export function beatOpen(trigger: HotspotTrigger, flags: Record<string, number>, sceneId: string): boolean {
  if (!trigger.beat) return sceneId === 'CH1_GATE'
  if (!PLAYABLE_BEATS.has(trigger.beat)) return false
  return trigger.beat === openBeat(flags)
}

export function triggerEligible(
  trigger: HotspotTrigger,
  flags: Record<string, number>,
  triggered: readonly string[],
  sceneId: string,
): boolean {
  if (!beatOpen(trigger, flags, sceneId)) return false
  if (trigger.once && triggered.includes(trigger.id)) return false
  return reqMet(trigger, flags)
}

function isSilent(trigger: HotspotTrigger): boolean {
  if (trigger.type === 'auto') return true
  return trigger.type === 'cutaway' && !trigger.shape
}

export function nextAuto(
  triggers: readonly HotspotTrigger[],
  flags: Record<string, number>,
  triggered: readonly string[],
  sceneId: string,
): HotspotTrigger | null {
  return triggers.find(trigger => isSilent(trigger) && triggerEligible(trigger, flags, triggered, sceneId)) ?? null
}

export function nextEnter(
  triggers: readonly HotspotTrigger[],
  flags: Record<string, number>,
  triggered: readonly string[],
  sceneId: string,
): HotspotTrigger | null {
  return triggers.find(trigger => trigger.type === 'enter' && triggerEligible(trigger, flags, triggered, sceneId)) ?? null
}

export interface HotspotChip {
  trigger: HotspotTrigger
  label: string
  index: number
  count: number
}

export function hotspotLabel(trigger: HotspotTrigger): string {
  return LABELS[trigger.id] ?? trigger.zone_hint ?? trigger.id
}

function shapeKey(shape: HotspotShape): string {
  if (shape.kind === 'circle') return `c:${shape.x}:${shape.y}:${shape.r}`
  return `b:${shape.x}:${shape.y}:${shape.w}:${shape.h}`
}

/** 可点热点。自动与无形切镜不进这张表，由 nextAuto 接着播。 */
export function visibleHotspots(
  map: HotspotMap,
  flags: Record<string, number>,
  triggered: readonly string[],
): HotspotChip[] {
  const sceneId = map.host_scene_id
  const rows = map.triggers.filter(trigger => {
    if (!trigger.shape) return false
    if (isSilent(trigger)) return false
    if (sceneId === 'CH1_GATE') return false
    return triggerEligible(trigger, flags, triggered, sceneId)
  })
  const groups = new Map<string, HotspotTrigger[]>()
  for (const trigger of rows) {
    const key = shapeKey(trigger.shape!)
    const list = groups.get(key)
    if (list) list.push(trigger)
    else groups.set(key, [trigger])
  }
  const chips: HotspotChip[] = []
  for (const trigger of rows) {
    const group = groups.get(shapeKey(trigger.shape!))!
    chips.push({
      trigger,
      label: hotspotLabel(trigger),
      index: group.indexOf(trigger),
      count: group.length,
    })
  }
  return chips
}

export function bannerText(flags: Record<string, number>): string {
  if (flags.c01_03_done) return 'C01-03 完成。灯街与火后本轮不接。'
  const beat = openBeat(flags)
  const name = beat === 'C01-01' ? '先把账结了' : beat === 'C01-02' ? '会看手艺的客人' : '空碗与旧灯'
  const phase = flags.c01_phase_night ? '夜' : flags.c01_phase_yan ? '晏' : flags.c01_phase_day ? '昼' : ''
  return phase ? `${beat} ${name} · ${phase}` : `${beat} ${name}`
}

/** 时相后者覆盖前者。枚举旗标若已由抉择写入，保持原值。 */
export function applySetFlags(flags: Record<string, number>, ids: readonly string[] | undefined): void {
  if (!ids) return
  for (const id of ids) {
    if (PHASES.includes(id)) {
      for (const phase of PHASES) flags[phase] = phase === id ? 1 : 0
      continue
    }
    if (ENUM_FLAGS.has(id) && flags[id]) continue
    if (!flags[id]) flags[id] = 1
  }
}
