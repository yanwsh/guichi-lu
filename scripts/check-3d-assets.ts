import { existsSync, openSync, readSync, closeSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { isLfsPointer } from '../src/scene/c01Art.ts'

/** glb / gltf / ktx2 / webp / basis must stay ordinary blobs. An LFS pointer fails the build. */
const exts = new Set(['.glb', '.gltf', '.ktx2', '.webp', '.basis'])
const attr = readFileSync('.gitattributes', 'utf8')
const banned = /\.(glb|gltf|ktx2|webp|basis)\b.*filter\s*=\s*lfs/i
for (const line of attr.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  if (banned.test(trimmed)) throw new Error(`LFS must not track 3D assets: ${trimmed}`)
}

const files: string[] = []
walk('.', files)
if (!files.some(file => file.endsWith('.webp'))) throw new Error('3d asset guard found no webp files')
const buf = Buffer.alloc(160)
for (const file of files) {
  const fd = openSync(file, 'r')
  const n = readSync(fd, buf, 0, buf.length, 0)
  closeSync(fd)
  if (isLfsPointer(buf.subarray(0, n))) throw new Error(`git-lfs pointer: ${file}`)
}
console.log('3d asset guard ok', { files: files.length, dist: existsSync('dist') })

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) walk(path, out)
    else if (exts.has(extname(name).toLowerCase())) out.push(path)
  }
}
