import * as THREE from 'three'

/** Blocky 1.6 m body. Feet at the local origin, chest facing +Z. */
export class Figure {
  readonly root = new THREE.Group()
  private upper = new THREE.Group()
  private armL = new THREE.Group()
  private armR = new THREE.Group()
  private legL = new THREE.Group()
  private legR = new THREE.Group()
  private phase = 0

  constructor(cloth = 0x5d7594) {
    const clothMat = new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.78 })
    const skin = new THREE.MeshStandardMaterial({ color: 0xd7aa8c, roughness: 0.62 })
    const hair = new THREE.MeshStandardMaterial({ color: 0x1c140f, roughness: 0.7 })
    const torso = box(0.32, 0.5, 0.18, clothMat)
    torso.position.y = 1.08
    this.upper.add(torso)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), skin)
    head.position.y = 1.48
    head.castShadow = true
    this.upper.add(head)
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.118, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair)
    hairCap.position.y = 1.5
    hairCap.castShadow = true
    this.upper.add(hairCap)
    this.armL = hang(this.upper, -0.24, 1.32, clothMat)
    this.armR = hang(this.upper, 0.24, 1.32, clothMat)
    this.legL = hang(this.root, -0.09, 0.84, clothMat, 0.16, 0.8)
    this.legR = hang(this.root, 0.09, 0.84, clothMat, 0.16, 0.8)
    this.root.add(this.upper)
    this.root.scale.setScalar(1.58 / 1.6)
    this.root.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
  }

  setPosition(x: number, y: number, z: number) {
    this.root.position.set(x, y, z)
  }

  setYaw(yaw: number) {
    this.root.rotation.y = yaw
  }

  update(speed: number, dt: number, time: number) {
    const walking = speed > 0.18
    if (walking) this.phase += speed * dt * 6.2
    const swing = walking ? Math.sin(this.phase) : 0
    this.legL.rotation.x = swing * 0.9
    this.legR.rotation.x = -swing * 0.9
    this.armL.rotation.x = -swing * 0.65
    this.armR.rotation.x = swing * 0.65
    this.upper.position.y = walking ? Math.abs(Math.sin(this.phase)) * 0.035 : Math.sin(time * 1.6) * 0.012
  }
}

function box(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
}

function hang(parent: THREE.Object3D, x: number, y: number, material: THREE.Material, w = 0.09, h = 0.46): THREE.Group {
  const pivot = new THREE.Group()
  pivot.position.set(x, y, 0)
  const mesh = box(w, h, w, material)
  mesh.position.y = -h / 2
  pivot.add(mesh)
  parent.add(pivot)
  return pivot
}
