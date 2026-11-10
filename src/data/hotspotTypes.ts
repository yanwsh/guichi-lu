/** 灯渡走图（CH1_GATE / C01_*）的热点表。与 SC_03 的 WalkMap 不是同一套字段。 */
export interface HotspotBox { kind: 'box'; x: number; y: number; w: number; h: number }
export interface HotspotCircle { kind: 'circle'; x: number; y: number; r: number }
export type HotspotShape = HotspotBox | HotspotCircle

export interface HotspotResult {
  dialogue_id?: string
  set_flags?: string[]
  goto_scene?: string
  note?: string
}

export interface HotspotTrigger {
  id: string
  beat: string | null
  type: string
  shape: HotspotShape | null
  zone_hint?: string
  req?: { flags_all?: string[] }
  once?: boolean
  result?: HotspotResult
  /** Design path. The runtime maps it through c01_visual.json; the pixels stay in this file. */
  art_ref?: string | null
}

export interface HotspotMap {
  host_scene_id: string
  canvas: { w: number; h: number }
  triggers: HotspotTrigger[]
  art_ref?: string | null
}
