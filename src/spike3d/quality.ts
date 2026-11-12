export type QualityTier = 'low' | 'mid'

export interface QualityProfile {
  tier: QualityTier
  pixelRatioCap: number
  shadows: boolean
  shadowMap: number
  pointLights: number
  bloom: boolean
}

/** `?q=low` or `?q=mid` wins. Otherwise a small phone is low and everything else is mid. */
export function resolveQuality(search: string): QualityProfile {
  const q = new URLSearchParams(search).get('q')
  const tier: QualityTier = q === 'low' || q === 'mid' ? q : autoTier()
  if (tier === 'low') {
    return { tier, pixelRatioCap: 1, shadows: false, shadowMap: 0, pointLights: 2, bloom: false }
  }
  return { tier, pixelRatioCap: 1.5, shadows: true, shadowMap: 1024, pointLights: 4, bloom: true }
}

function autoTier(): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const cores = navigator.hardwareConcurrency || 8
  const mem = nav.deviceMemory || 8
  const phone = /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent)
  if (mem <= 2 || cores <= 2) return 'low'
  if (phone && (mem <= 4 || cores <= 4)) return 'low'
  return 'mid'
}

export function pixelRatioFor(profile: QualityProfile): number {
  const device = window.devicePixelRatio || 1
  return Math.min(device, profile.pixelRatioCap)
}
