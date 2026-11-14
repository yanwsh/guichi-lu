/** Licenses for code this spike adds. `three` itself is already MIT. */
export const THIRD_PARTY = [
  {
    name: 'three-mesh-bvh',
    version: '0.9.4',
    license: 'MIT',
    use: 'Capsule against the COL_ mesh (BVH shapecast and raycast).',
  },
  {
    name: 'three addons',
    license: 'MIT',
    use: 'GLTFLoader, MeshoptDecoder, KTX2Loader, UnrealBloomPass, OutputPass. UnrealBloomPass already renders its buffers at half resolution.',
  },
  {
    name: 'meshoptimizer',
    license: 'MIT',
    holder: 'Arseny Kapoulkine',
    use: 'MeshoptDecoder embedded in three, for future glb.',
  },
  {
    name: 'Basis Universal transcoder',
    license: 'Apache-2.0',
    holder: 'Binomial LLC',
    use: 'KTX2 textures. KTX2Loader loads the transcoder shipped inside the three package.',
  },
  {
    name: 'Quaternius Universal Animation Library',
    license: 'CC0',
    use: 'In-place idle/walk/talk/run, retargeted offline onto a Mixamo-style skeleton with no mixamorig: prefix. License: public/assets/3d/_third_party/quaternius_UAL/License.txt.',
  },
] as const
