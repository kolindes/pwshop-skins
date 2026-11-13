import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { DATA_URL } from '../catalog';
import type { Catalog, ModelDef, Part } from '../types';

/** Resolved models of one composition; a missing key means the slot is empty. */
export type Outfit = Partial<Record<Part, ModelDef>> & {
  body: ModelDef;
  sex: 0 | 1;
  beast: boolean;
  /** head and default hair files of the persona; absent when the body has its own head */
  face?: { head: string; hair: string };
};

export interface StageReport {
  missing: Part[];
}

const BACKGROUND = 0x77777b;
const nodeName = (unityName: string): string => THREE.PropertyBinding.sanitizeNodeName(unityName);
const lastSegment = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

/** Unity local position / euler angles (degrees, ZXY order) to the mirrored right-handed space of the exported models. */
function applyUnityOffset(object: THREE.Object3D, def: ModelDef): void {
  // the game replaces the transform the prefab root was saved with
  const root = object.children[0];
  if (root) {
    root.position.set(0, 0, 0);
    root.quaternion.identity();
  }
  const [px, py, pz] = def.pos ?? [0, 0, 0];
  const [rx, ry, rz] = def.rot ?? [0, 0, 0];
  const rad = THREE.MathUtils.degToRad;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(rx), rad(ry), rad(rz), 'YXZ'));
  object.position.set(-px, py, pz);
  object.quaternion.set(q.x, -q.y, -q.z, q.w);
  const scale = typeof def.scale === 'number' && def.scale > 0 ? def.scale : 1;
  object.scale.setScalar(scale);
}

function hideInactive(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node.userData?.inactive) node.visible = false;
  });
}

export class Stage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 400);
  private readonly controls: OrbitControls;
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<GLTF>>();
  private readonly clock = new THREE.Clock();
  private readonly holder = new THREE.Group();
  private mixers: THREE.AnimationMixer[] = [];
  private generation = 0;
  private frame = 0;
  private disposed = false;
  private framedFor = '';
  /** load and composition problems of the last show(), for diagnostics */
  readonly problems: string[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly catalog: Catalog,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.scene.background = new THREE.Color(BACKGROUND);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6a72, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(2.5, 4, 3.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xdfe6ff, 0.7);
    rim.position.set(-3, 2.5, -3);
    this.scene.add(rim);
    this.scene.add(this.holder);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 40;
    this.camera.position.set(0, 1.2, 5);
    this.resize();
    this.loop();
  }

  resize(): void {
    const { clientWidth: width, clientHeight: height } = this.canvas.parentElement ?? this.canvas;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.renderer.dispose();
  }

  resetView(): void {
    this.framedFor = '';
    this.fit('reset');
  }

  /** Builds the composition; resolves with the slots whose model file is not available. */
  async show(outfit: Outfit): Promise<StageReport> {
    const generation = ++this.generation;
    this.problems.length = 0;
    const missing: Part[] = [];
    const group = new THREE.Group();
    const mixers: THREE.AnimationMixer[] = [];

    const body = await this.instance(outfit.outfit ?? outfit.body);
    if (!body) throw new Error('Модель персонажа недоступна');
    if (outfit.outfit && !outfit.outfit.file) missing.push('outfit');
    const bodyDef = outfit.outfit?.file ? outfit.outfit : outfit.body;
    const bone = (name: string) => body.scene.getObjectByName(nodeName(name));

    const optional = async (part: Part) => {
      const def = outfit[part];
      if (!def) return null;
      const loaded = await this.instance(def);
      if (!loaded) missing.push(part);
      return loaded ? { def, ...loaded } : null;
    };
    const [head, weapon, back, shoulder, mount, flight] = await Promise.all(
      (['head', 'weapon', 'back', 'shoulder', 'mount', 'flight'] as Part[]).map(optional),
    );
    const file = (name: string) => this.instance({ res: name, file: name });
    const [face, hair] = outfit.face
      ? await Promise.all([file(outfit.face.head), head ? null : file(outfit.face.hair)])
      : [null, null];
    if (generation !== this.generation) return { missing };

    for (const piece of [face, hair])
      if (piece) this.skinOnto(piece.scene, body.scene, bone('Bip01 Head') ?? body.scene);
    if (head) this.skinOnto(head.scene, body.scene, bone('Bip01 Head') ?? body.scene);
    if (weapon) {
      const hand = bone(lastSegment(String(weapon.def.bind || '')) || this.catalog.points.weapon);
      if (hand) {
        applyUnityOffset(weapon.scene, weapon.def);
        weapon.scene.userData.outOfFrame = true;
        hand.add(weapon.scene);
      }
    }
    for (const [piece, point] of [
      [back, this.catalog.points.back],
      [shoulder, this.catalog.points.shoulder],
    ] as const) {
      if (!piece) continue;
      const target = bone(lastSegment(String(piece.def.bind || '')) || point) ?? body.scene;
      applyUnityOffset(piece.scene, piece.def);
      target.add(piece.scene);
      this.play(piece, 'Stand', mixers);
    }

    const carrier = flight ?? mount;
    let riderClip = 'Stand';
    if (carrier) {
      const bindPath = Array.isArray(carrier.def.bind) ? carrier.def.bind[outfit.sex] : carrier.def.bind;
      const seat =
        carrier.scene.getObjectByName(nodeName(lastSegment(bindPath ?? 'Ride_Point'))) ?? carrier.scene;
      seat.add(body.scene);
      // bind points keep the modelling tool's axes (X forward): turn the rider to face along the carrier
      body.scene.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      carrier.scene.updateMatrixWorld(true);
      const ws = seat.getWorldScale(new THREE.Vector3());
      const wq = seat.getWorldQuaternion(new THREE.Quaternion());
      this.problems.push(
        `seat ${seat.name} scale ${ws.x.toFixed(3)},${ws.y.toFixed(3)},${ws.z.toFixed(3)} quat ${wq.x.toFixed(2)},${wq.y.toFixed(2)},${wq.z.toFixed(2)},${wq.w.toFixed(2)} clip ${carrier.def.anim}`,
      );
      const scales = Array.isArray(carrier.def.scale) ? carrier.def.scale : null;
      const scale = scales ? scales[outfit.beast && outfit.sex === 0 ? 0 : outfit.sex === 0 ? 1 : 2] : 1;
      if (scale > 0) carrier.scene.scale.setScalar(scale);
      this.play(carrier, 'Stand', mixers);
      riderClip = carrier.def.anim || 'Stand';
      group.add(carrier.scene);
    } else {
      group.add(body.scene);
    }

    const clip =
      (await this.riderClip(bodyDef, riderClip)) ?? body.animations.find((c) => c.name === 'Stand');
    if (generation !== this.generation) return { missing };
    if (clip) {
      const mixer = new THREE.AnimationMixer(body.scene);
      mixer.clipAction(this.pruned(clip, body.scene)).play();
      mixers.push(mixer);
    }

    this.holder.clear();
    this.holder.add(group);
    this.mixers = mixers;
    this.fit(carrier ? `carrier:${carrier.def.res}` : 'body');
    return { missing };
  }

  private async instance(
    def: ModelDef | undefined,
  ): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] } | null> {
    if (!def?.file) return null;
    try {
      const gltf = await this.load(`${DATA_URL}/models/${encodeURIComponent(def.file)}`);
      const scene = SkeletonUtils.clone(gltf.scene);
      hideInactive(scene);
      return { scene, animations: gltf.animations };
    } catch (error) {
      console.warn('model failed', def.file, error);
      this.problems.push(`${def.file}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private load(url: string): Promise<GLTF> {
    let pending = this.cache.get(url);
    if (!pending) {
      pending = this.loader.loadAsync(url);
      pending.catch(() => this.cache.delete(url));
      this.cache.set(url, pending);
      if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value as string);
    }
    return pending;
  }

  /** The rider clip of the outfit's animation folder (shared library file per folder). */
  private async riderClip(body: ModelDef, name: string): Promise<THREE.AnimationClip | undefined> {
    const folder = body.anim ?? '';
    const candidates = [folder, folder.replace(/\/CJ$/, '')];
    for (const candidate of candidates) {
      const library = this.catalog.animFolders[candidate];
      if (!library?.file || !library.clips.includes(name)) continue;
      try {
        const gltf = await this.load(`${DATA_URL}/anims/${encodeURIComponent(library.file)}`);
        const clip = gltf.animations.find((c) => c.name === name);
        if (clip) return clip;
      } catch {
        /* fall through to the next folder */
      }
    }
    return name === 'Stand' ? undefined : this.riderClip(body, 'Stand');
  }

  /** Drops tracks whose bone the model does not have, so the mixer stays quiet. */
  private pruned(clip: THREE.AnimationClip, root: THREE.Object3D): THREE.AnimationClip {
    const tracks = clip.tracks.filter((track) =>
      root.getObjectByName(THREE.PropertyBinding.parseTrackName(track.name).nodeName),
    );
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  }

  private play(
    piece: { scene: THREE.Object3D; animations: THREE.AnimationClip[] },
    name: string,
    mixers: THREE.AnimationMixer[],
  ): void {
    const clip = piece.animations.find((c) => c.name === name) ?? piece.animations[0];
    if (!clip) return;
    const mixer = new THREE.AnimationMixer(piece.scene);
    mixer.clipAction(this.pruned(clip, piece.scene)).play();
    mixers.push(mixer);
  }

  /** Re-binds the skinned meshes of a hair or hat model to the skeleton of the body. */
  private skinOnto(piece: THREE.Object3D, body: THREE.Object3D, fallback: THREE.Object3D): void {
    const meshes: THREE.SkinnedMesh[] = [];
    const rigid: THREE.Mesh[] = [];
    piece.traverse((node) => {
      if ((node as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(node as THREE.SkinnedMesh);
      else if ((node as THREE.Mesh).isMesh) rigid.push(node as THREE.Mesh);
    });
    const adopt = (own: THREE.Bone): THREE.Object3D => {
      const match = body.getObjectByName(own.name);
      if (match) return match;
      const parent =
        own.parent && (own.parent as THREE.Bone).isBone ? adopt(own.parent as THREE.Bone) : fallback;
      if (own.parent !== parent) parent.add(own);
      return own;
    };
    for (const mesh of meshes) {
      if (!mesh.visible || mesh.parent?.visible === false) continue;
      const bones = mesh.skeleton.bones.map((own) => adopt(own) as THREE.Bone);
      mesh.bind(new THREE.Skeleton(bones, mesh.skeleton.boneInverses), mesh.bindMatrix);
      mesh.frustumCulled = false;
      body.add(mesh);
    }
    for (const mesh of rigid) fallback.add(mesh);
  }

  private fit(key: string): void {
    if (key === this.framedFor) return;
    this.framedFor = key;
    this.holder.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    // the frame follows the character and its carrier; a long weapon must not push the figure aside
    const visit = (node: THREE.Object3D): void => {
      if (node.userData.outOfFrame || !node.visible) return;
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        const skinned = mesh as THREE.SkinnedMesh;
        let local: THREE.Box3 | null;
        if (skinned.isSkinnedMesh) {
          skinned.skeleton.update();
          skinned.computeBoundingBox();
          local = skinned.boundingBox;
        } else {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          local = mesh.geometry.boundingBox;
        }
        const world = local?.clone().applyMatrix4(mesh.matrixWorld);
        if (
          world &&
          Number.isFinite(world.min.lengthSq() + world.max.lengthSq()) &&
          world.getSize(point).length() < 60
        )
          box.union(world);
      }
      node.children.forEach(visit);
    };
    visit(this.holder);
    box.expandByScalar(0.05);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    this.problems.push(`box ${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)}`);
    const centre = box.getCenter(new THREE.Vector3());
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const width = Math.max(size.x, size.z * 0.7);
    const distance = Math.max(size.y / 2 / tan, width / 2 / (tan * this.camera.aspect)) * 1.12 + size.z / 2;
    this.controls.target.copy(centre);
    this.camera.position.set(
      centre.x + distance * 0.35,
      centre.y + size.y * 0.08,
      centre.z + distance * 0.94,
    );
    this.controls.maxDistance = distance * 4;
    this.controls.update();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    for (const mixer of this.mixers) mixer.update(delta);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
