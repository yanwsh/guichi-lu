import type { Box, WalkShape } from './walkTypes'

export interface Pt { x: number; y: number }

export function containsShape(shape: WalkShape, x: number, y: number, pad = 0): boolean {
  if (shape.kind === 'circle') {
    const dx = x - shape.x
    const dy = y - shape.y
    const r = shape.r + pad
    return dx * dx + dy * dy <= r * r
  }
  return x >= shape.x - pad && y >= shape.y - pad && x < shape.x + shape.w + pad && y < shape.y + shape.h + pad
}

export function shapeCenter(shape: WalkShape): Pt {
  if (shape.kind === 'circle') return { x: shape.x, y: shape.y }
  return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 }
}

export function distToBox(x: number, y: number, b: Box): number {
  const dx = x < b.x ? b.x - x : x > b.x + b.w ? x - (b.x + b.w) : 0
  const dy = y < b.y ? b.y - y : y > b.y + b.h ? y - (b.y + b.h) : 0
  return Math.hypot(dx, dy)
}

export function inBox(x: number, y: number, b: Box): boolean {
  return x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h
}
