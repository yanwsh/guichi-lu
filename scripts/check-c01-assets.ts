import { existsSync, readFileSync } from 'node:fs'
import { isLfsPointer, referencedFiles, type C01Visual } from '../src/scene/c01Art.ts'
import type { HotspotMap } from '../src/data/hotspotTypes.ts'

/** Fails the build when a C01 picture is missing from dist or is still a Git LFS pointer. */
const dist = 'dist'
const visual = JSON.parse(readFileSync(`${dist}/config/c01_visual.json`, 'utf8')) as C01Visual
const files = referencedFiles(visual)
if (files.length === 0) throw new Error('c01 visual config lists no files')
for (const rel of files) {
  if (rel.includes('placeholder/')) throw new Error(`placeholder path still configured: ${rel}`)
  const path = `${dist}/${rel.replace(/^\//, '')}`
  if (!existsSync(path)) throw new Error(`missing from dist: ${rel}`)
  const buf = readFileSync(path)
  if (isLfsPointer(buf)) throw new Error(`git-lfs pointer in dist: ${rel}`)
  if (buf.length < 1000) throw new Error(`dist art is too small to be a picture: ${rel} (${buf.length} bytes)`)
}
for (const id of ['CH1_GATE', 'C01_SHOP', 'C01_STREET']) {
  const map = JSON.parse(readFileSync(`${dist}/config/walkmaps/${id}.json`, 'utf8')) as HotspotMap
  const refs = [map.art_ref, ...map.triggers.map(trigger => trigger.art_ref)].filter((ref): ref is string => !!ref)
  for (const ref of refs) {
    if (!visual.backgrounds[ref]) throw new Error(`${id} art_ref is not mapped: ${ref}`)
  }
}
console.log('c01 asset guard ok', { files: files.length })
