import { applyGates, buildGrid, findPath } from '../src/walk/pathfind.ts'

const open = buildGrid(64, 64, 16, () => true)
const straight = findPath(open, 8, 8, 50, 40)
if (!straight || straight.points.length !== 2) {
  throw new Error(`open ground should be one straight segment, got ${straight?.points.length}`)
}

const walled = buildGrid(80, 48, 16, (x, y) => !(x >= 32 && x < 48 && y < 32))
const around = findPath(walled, 8, 8, 70, 8)
if (!around || around.points.length < 3) throw new Error('path should bend around the wall')

const gated = buildGrid(200, 400, 16, (x, y) => x > 40 && x < 120)
applyGates(gated, [{ x: 40, y: 160, w: 80, h: 32 }])
const blocked = findPath(gated, 80, 300, 80, 40)
if (!blocked || blocked.reached) throw new Error('gate should stop the click short of the far side')
const opened = buildGrid(200, 400, 16, (x, y) => x > 40 && x < 120)
const through = findPath(opened, 80, 300, 80, 40)
if (!through?.reached) throw new Error('same click should arrive once the gate is gone')

console.log('walk path checks ok', {
  straight: straight.points.length,
  around: around.points.length,
  blocked: blocked.points.length,
})
