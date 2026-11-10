import type { HotspotMap, HotspotTrigger } from '../data/hotspotTypes'
import { nextAuto, nextEnter, visibleHotspots } from '../walk/c01Flow.ts'

export type PortraitMode = 'cutout' | 'card'

export interface PortraitDef {
  src: string
  /** cutout: full RGBA, anchor at the bottom center. card: framed upper-body crop, kept for a later swap. */
  mode: PortraitMode
  /** The unknown-speaker silhouette is drawn by the program. It is not a missing-art stand-in. */
  generated?: boolean
}

export interface C01Visual {
  dev_entries: boolean
  canvas: { w: number; h: number }
  portrait_anchor: { x: number; y: number; w: number; h: number }
  /** Half the opaque body, as a fraction of the portrait image width. The bow is outside this. */
  body_half_frac: number
  /** Image y where the pre-darkened subtitle band begins. */
  subtitle_y: number
  backgrounds: Record<string, string>
  chapter_card: { src: string; title_y: number; title_h: number }
  cutaways: Record<string, { stills: string[] }>
  portraits: Record<string, PortraitDef>
}

export const LFS_MARKER = 'version https://git-lfs'

/** One person sits to the right. Two and three stay apart on a 390-wide phone. */
const WIDTH_FRAC = [0.62, 0.56, 0.46] as const
const CENTER_FRAC: readonly (readonly number[])[] = [
  [0.68],
  [0.28, 0.72],
  [0.17, 0.5, 0.83],
]

export interface CutoutSlot {
  index: number
  center: number
  width: number
  left: number
  bodyLeft: number
  bodyRight: number
}

export function assetUrl(path: string, base = '/'): string {
  const clean = path.replace(/^\//, '')
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${prefix}${clean}`
}

export function stillAt(stills: readonly string[], lineIndex: number): string | null {
  if (!stills.length || lineIndex < 0) return null
  return stills[Math.min(lineIndex, stills.length - 1)] ?? null
}

export function resolveArtRef(
  map: HotspotMap,
  flags: Record<string, number>,
  triggered: readonly string[],
  focus?: Pick<HotspotTrigger, 'art_ref'> | null,
): string | null {
  if (focus?.art_ref) return focus.art_ref
  const sceneId = map.host_scene_id
  const auto = nextAuto(map.triggers, flags, triggered, sceneId)
  if (auto?.art_ref) return auto.art_ref
  for (const chip of visibleHotspots(map, flags, triggered)) {
    if (chip.trigger.art_ref) return chip.trigger.art_ref
  }
  const enter = nextEnter(map.triggers, flags, triggered, sceneId)
  if (enter?.art_ref) return enter.art_ref
  return map.art_ref || null
}

export function containRect(frameW: number, frameH: number, imageW: number, imageH: number) {
  const iw = imageW > 0 ? imageW : 1
  const ih = imageH > 0 ? imageH : 1
  const scale = Math.min(frameW / iw, frameH / ih)
  const w = iw * scale
  const h = ih * scale
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h }
}

/**
 * Place each portrait by the image anchor (512, 1536), which is the body center on the bottom edge.
 * 晏归's bow shifts his opaque box toward x≈584; that box is not the anchor.
 */
export function cutoutSlots(
  count: number,
  frameW: number,
  anchorX: number,
  imageW: number,
  bodyHalfFrac: number,
): CutoutSlot[] {
  const n = Math.max(1, Math.min(count, 3))
  const width = frameW * WIDTH_FRAC[n - 1]
  const anchorFrac = anchorX / imageW
  return CENTER_FRAC[n - 1].slice(0, n).map((frac, index) => {
    const center = frameW * frac
    const left = center - width * anchorFrac
    const bodyHalf = width * bodyHalfFrac
    return { index, center, width, left, bodyLeft: center - bodyHalf, bodyRight: center + bodyHalf }
  })
}

export function slotsOverlap(slots: readonly CutoutSlot[]): boolean {
  const ordered = [...slots].sort((a, b) => a.bodyLeft - b.bodyLeft)
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].bodyLeft < ordered[i - 1].bodyRight - 0.5) return true
  }
  return false
}

export function referencedFiles(visual: C01Visual): string[] {
  const files = new Set<string>()
  for (const src of Object.values(visual.backgrounds)) files.add(src)
  if (visual.chapter_card?.src) files.add(visual.chapter_card.src)
  for (const cut of Object.values(visual.cutaways)) for (const src of cut.stills ?? []) files.add(src)
  for (const portrait of Object.values(visual.portraits)) if (portrait.src) files.add(portrait.src)
  return [...files]
}

export function devEntriesOn(configFlag: boolean, search: string): boolean {
  const q = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('dev')
  if (q === '1' || q === 'true') return true
  if (q === '0' || q === 'false') return false
  return !!configFlag
}

export function isLfsPointer(bytes: Uint8Array | string): boolean {
  const head = typeof bytes === 'string' ? bytes.slice(0, 80) : new TextDecoder().decode(bytes.slice(0, 80))
  return head.startsWith(LFS_MARKER)
}
