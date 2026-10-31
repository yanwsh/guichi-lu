export interface Box { x: number; y: number; w: number; h: number }
export interface CircleShape { kind: 'circle'; x: number; y: number; r: number }
export interface BoxShape { kind: 'box'; x: number; y: number; w: number; h: number }
export type WalkShape = CircleShape | BoxShape

export interface WalkZone {
  zone_id: string
  host_scene_id: string
  spawn: { x: number; y: number }
  bounds: Box
  objective: string
  map_phase?: string
  zone_label?: string
}

export interface WalkTrigger {
  id: string
  zone_id: string
  type: 'enter' | 'interact' | 'talk' | 'auto_gate' | string
  shape: WalkShape
  once: boolean
  require_flags?: string[]
  set_flags?: string[]
  unlock_path_id?: string
  start_dialogue_id?: string
  encounter_id?: string
  label?: string
  hint?: string
  reward?: string
  flow_to?: string
  note?: string
}

export interface WalkPath {
  id: string
  from_zone: string
  to_zone: string
  locked_by_default: boolean
  unlock_flag: string
  gate?: Box
  scene_exit?: string
  /** Reserved for a later route graph. M1 does not read this and does not add forks. */
  waypoints?: { x: number; y: number }[]
}

export interface OcclusionSort {
  id: string
  foot_y?: number
  sort_y?: number
  note?: string
}

export interface WalkMap {
  host_scene_id: string
  coord_space: string
  origin: string
  y_axis: string
  canvas: { w: number; h: number }
  art_ref?: string
  walkable_mask: string
  safe_ui: {
    joystick: Box
    interact_btn: Box
    dialog_bar_max_y: number
  }
  occlusion_sort: OcclusionSort[]
  zones: WalkZone[]
  triggers: WalkTrigger[]
  paths: WalkPath[]
  ui_map_labels?: Record<string, string>
  meta?: { version?: string; author?: string; changelog?: string; art_walkmap?: string }
}

export interface LayerCrop { x: number; y: number; w: number; h: number }
export interface LayerSlice {
  id: string
  file: string
  role: 'far' | 'ground' | 'ysort'
  occlusion_id?: string
  crop?: LayerCrop
  note?: string
}
export interface LayerManifest {
  cell: number
  walkable_threshold: number
  speed_px: number
  camera_view_scale: number
  interact_edge_pad: number
  scroll?: { enabled: boolean; y_offset: number; initial_scroll_y: number; note?: string }
  slices: LayerSlice[]
}

export const sortKeyOf = (row: OcclusionSort) => row.foot_y ?? row.sort_y ?? 0
