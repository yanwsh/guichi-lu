/** 灯渡短操作原语。步骤机与 DOM 分开，便于单测。 */

export interface ShortOpStep { id: string; label: string }
export interface ShortOpTrap { id: string; label: string; toast: string }
export interface ShortOpDef {
  id: string
  title: string
  hint: string
  steps: ShortOpStep[]
  traps: ShortOpTrap[]
}

export interface ShortOpState {
  step: number
  done: boolean
  lastToast: string
}

const COLLECT: ShortOpDef = {
  id: 'collect',
  title: '收款',
  hint: '交灯，再收钱。',
  steps: [
    { id: 'hand', label: '交灯' },
    { id: 'pay', label: '收钱' },
  ],
  traps: [],
}

const ANTIKNOT: ShortOpDef = {
  id: 'antiknot',
  title: '反结',
  hint: '原法拉紧会裂响，可重试。先卸重灯，再反结分力。',
  steps: [
    { id: 'unload', label: '卸下重灯' },
    { id: 'reknot', label: '反结，分力穿到另一侧' },
  ],
  traps: [
    { id: 'pull_tight', label: '照原法拉紧', toast: '檐木裂响。' },
  ],
}

const SUNKLAMP: ShortOpDef = {
  id: 'sunklamp',
  title: '拆沉水灯',
  hint: '拆外层，找到受扭力的那根骨，再卸力。',
  steps: [
    { id: 'shell', label: '拆开外层' },
    { id: 'rib', label: '找出受扭力的那根骨' },
    { id: 'ease', label: '卸力' },
  ],
  traps: [],
}

const STOOL: ShortOpDef = {
  id: 'stool',
  title: '垫踏凳',
  hint: '先垫稳，再取防潮布。',
  steps: [
    { id: 'set', label: '把踏凳垫稳' },
    { id: 'cloth', label: '取下防潮布' },
  ],
  traps: [],
}

/** 阁楼旧灯沿用反结：先拆破骨，再系细反结。不是另一套原语。 */
const OLDLAMP: ShortOpDef = {
  id: 'oldlamp',
  title: '细反结',
  hint: '拆掉破骨，再按反结把细绳系上。',
  steps: [
    { id: 'break_rib', label: '拆掉破骨' },
    { id: 'fine_knot', label: '系上细反结' },
  ],
  traps: [],
}

const BY_TRIGGER: Record<string, ShortOpDef> = {
  TR_C01_01_HE: COLLECT,
  MG_C01_01_ANTIKNOT: ANTIKNOT,
  MG_C01_02_SUNKLAMP: SUNKLAMP,
  MG_C01_03_STOOL: STOOL,
  MG_C01_03_OLDLAMP: OLDLAMP,
}

export function shortOpForTrigger(triggerId: string): ShortOpDef | null {
  return BY_TRIGGER[triggerId] ?? null
}

export function freshShortOp(): ShortOpState {
  return { step: 0, done: false, lastToast: '' }
}

/** 只接受当前这一步。陷阱不推进。点到后面的步骤会停住。 */
export function applyShortOp(def: ShortOpDef, state: ShortOpState, actionId: string): ShortOpState {
  if (state.done) return state
  const trap = def.traps.find(t => t.id === actionId)
  if (trap) return { ...state, lastToast: trap.toast }
  const index = def.steps.findIndex(s => s.id === actionId)
  if (index < 0) return { ...state, lastToast: '这步对不上。' }
  if (index !== state.step) return { ...state, lastToast: '还不到这一步。' }
  const step = state.step + 1
  const done = step >= def.steps.length
  return { step, done, lastToast: '' }
}
