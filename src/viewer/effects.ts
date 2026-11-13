import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

/** A particle system of the game, flattened by the asset export to constants and sampled curves. */
interface ParticleSpec {
  loop: boolean;
  duration: number;
  max: number;
  life: [number, number];
  speed: [number, number];
  size: [number, number];
  rotation: [number, number];
  gravity: number;
  rate: number;
  bursts: number[];
  color: [number, number, number, number];
  world: boolean;
  shape: { type: number; radius: number; angle: number; scale: [number, number, number] };
  texture: number;
  /** texture whose brightness shapes the sprite */
  mask?: number;
  blend: 'add' | 'alpha';
  tint: [number, number, number, number];
  sizeOverLife?: number[] | null;
  colorOverLife?: [number, number, number, number][] | null;
  tiles?: [number, number];
  velocity?: [number, number, number];
  /** 0 facing the camera, 1 stretched along the velocity, 2 lying flat, 3 upright */
  mode?: number;
  /** length scale and speed scale of the stretched mode */
  stretch?: [number, number];
  /** 0 faces the view, 1 world axes, 2 the plane of its own node */
  align?: number;
}

interface EffectMaterial {
  hidden?: boolean;
  blend?: 'add' | 'alpha';
  tint?: [number, number, number, number];
  uv?: [number, number, number, number];
  /** texture index whose brightness limits the opacity */
  mask?: number;
  /** UV speed of the main texture, units per second */
  scroll?: [number, number];
  /** a shell that glows only along its silhouette */
  rim?: { color: number[]; inner: number[]; power: number; gain: number };
}

/** Anything the stage advances every frame and frees with the composition. */
export interface Animated {
  update(delta: number): void;
  dispose(): void;
}

const MAX_PARTICLES_PER_SYSTEM = 160;
const SHAPE_SPHERE = 0;
const SHAPE_CONE = 4;
const SHAPE_BOX = 5;
/** The game stores effect colours with headroom for bloom; without bloom they are shown within this range. */
const GLOW_CEILING = 1.15;
const GLOW_GAIN = 0.75;

const rand = (range: [number, number]): number => range[0] + Math.random() * (range[1] - range[0]);

function sample(curve: number[], t: number): number {
  const x = Math.min(Math.max(t, 0), 1) * (curve.length - 1);
  const i = Math.floor(x);
  const next = Math.min(i + 1, curve.length - 1);
  return curve[i] + (curve[next] - curve[i]) * (x - i);
}

/** Keeps the hue of an HDR colour and brings its brightness into what the display can show. */
function displayTint(tint: number[], additive: boolean): [number, number, number] {
  const peak = Math.max(tint[0], tint[1], tint[2], 1e-3);
  const gain = (Math.min(peak, GLOW_CEILING) / peak) * (additive ? GLOW_GAIN : 1);
  return [tint[0] * gain, tint[1] * gain, tint[2] * gain];
}

const VERTEX = /* glsl */ `
  attribute vec3 iPosition;
  attribute vec3 iVelocity;
  attribute float iSize;
  attribute float iAngle;
  attribute float iFrame;
  attribute vec4 iColor;
  uniform int uMode;
  uniform vec2 uStretch;
  uniform float uScale;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vFrame;
  void main() {
    float c = cos(iAngle);
    float s = sin(iAngle);
    float size = iSize * uScale;
    vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * size;
    vec4 centre = modelViewMatrix * vec4(iPosition, 1.0);
    vec4 mv;
    if (uMode == 2) {
      // lying flat: a ring or a puddle on the ground
      mv = modelViewMatrix * vec4(iPosition + vec3(corner.x, 0.0, corner.y) / uScale, 1.0);
    } else if (uMode == 3) {
      // upright: turns to the camera around the vertical axis only
      mv = modelViewMatrix * vec4(iPosition + vec3(0.0, corner.y, 0.0) / uScale, 1.0) + vec4(corner.x, 0.0, 0.0, 0.0);
    } else if (uMode == 1) {
      // a streak along its direction of travel
      vec3 travel = (modelViewMatrix * vec4(iVelocity, 0.0)).xyz;
      float speed = length(travel);
      vec2 along = speed > 1e-5 ? travel.xy / max(length(travel.xy), 1e-5) : vec2(0.0, 1.0);
      vec2 across = vec2(-along.y, along.x);
      float reach = size * max(uStretch.x, 1.0) + speed * uStretch.y;
      mv = centre + vec4(along * position.y * reach + across * position.x * size, 0.0, 0.0);
    } else if (uMode == 4) {
      // in the plane of its own node: a ripple or a ring laid out by the artist
      mv = modelViewMatrix * vec4(iPosition + vec3(corner, 0.0) / uScale, 1.0);
    } else if (uMode == 5) {
      // fixed to the world axes
      mv = centre + viewMatrix * vec4(corner, 0.0, 0.0);
    } else {
      mv = centre + vec4(corner, 0.0, 0.0);
    }
    gl_Position = projectionMatrix * mv;
    vColor = iColor;
    vUv = uv;
    vFrame = iFrame;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uMask;
  uniform float uHasMask;
  uniform vec2 uTiles;
  uniform float uAdditive;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vFrame;
  void main() {
    float frame = floor(vFrame);
    vec2 cell = vec2(mod(frame, uTiles.x), floor(frame / uTiles.x));
    vec2 uv = (vUv + vec2(cell.x, uTiles.y - 1.0 - cell.y)) / uTiles;
    vec4 texel = texture2D(uMap, uv);
    float shape = uHasMask > 0.5 ? texture2D(uMask, vUv).g : 1.0;
    float brightness = max(texel.r, max(texel.g, texel.b));
    // Alpha is the shape of a sprite. A glow is added as colour times alpha, so one drawn on black with a
    // solid alpha still fades out; a blended sprite without alpha takes its shape from brightness.
    float coverage = uAdditive > 0.5 ? texel.a : (texel.a > 0.995 ? brightness : texel.a);
    // soft edge so that a texture reaching its border never shows the quad
    vec2 fromCentre = vUv - 0.5;
    float edge = 1.0 - smoothstep(0.42, 0.5, max(abs(fromCentre.x), abs(fromCentre.y)));
    float alpha = coverage * shape * edge * vColor.a;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(texel.rgb * vColor.rgb * (uAdditive > 0.5 ? alpha : 1.0), alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * How the quads of a system are oriented. A system aligned to its own node lies in that node's plane; this also
 * holds for a "stretched" system that barely moves, which the game uses for ripples spreading on the ground.
 */
function renderMode(spec: ParticleSpec): number {
  const mode = spec.mode ?? 0;
  const still = Math.max(Math.abs(spec.speed[0]), Math.abs(spec.speed[1])) < 0.02 && !spec.velocity;
  if (spec.align === 2 && (mode === 0 || (mode === 1 && still))) return 4;
  if (spec.align === 1 && mode === 0) return 5;
  return mode;
}

/** Replays one exported particle system as quads placed the way its render mode asks. */
export class Emitter implements Animated {
  readonly mesh: THREE.Mesh;
  private readonly count: number;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly startSize: Float32Array;
  private readonly size: Float32Array;
  private readonly angle: Float32Array;
  private readonly frame: Float32Array;
  private readonly colour: Float32Array;
  private readonly tint: [number, number, number];
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private debt = 0;
  private clock = 0;
  private burstDone = false;

  constructor(
    private readonly spec: ParticleSpec,
    map: THREE.Texture,
    mask: THREE.Texture | null,
  ) {
    this.count = Math.max(1, Math.min(spec.max, MAX_PARTICLES_PER_SYSTEM));
    const n = this.count;
    this.position = new Float32Array(n * 3);
    this.velocity = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n).fill(-1);
    this.startSize = new Float32Array(n);
    this.size = new Float32Array(n);
    this.angle = new Float32Array(n);
    this.frame = new Float32Array(n);
    this.colour = new Float32Array(n * 4);
    const additive = spec.blend === 'add';
    this.tint = displayTint(spec.tint, additive);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.geometry.instanceCount = n;
    const instanced = (array: Float32Array, size: number) =>
      new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iPosition', instanced(this.position, 3));
    this.geometry.setAttribute('iVelocity', instanced(this.velocity, 3));
    this.geometry.setAttribute('iSize', instanced(this.size, 1));
    this.geometry.setAttribute('iAngle', instanced(this.angle, 1));
    this.geometry.setAttribute('iFrame', instanced(this.frame, 1));
    this.geometry.setAttribute('iColor', instanced(this.colour, 4));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uMap: { value: map },
        uMask: { value: mask ?? map },
        uHasMask: { value: mask ? 1 : 0 },
        uTiles: { value: new THREE.Vector2(spec.tiles?.[0] ?? 1, spec.tiles?.[1] ?? 1) },
        uAdditive: { value: additive ? 1 : 0 },
        uMode: { value: renderMode(spec) },
        uStretch: { value: new THREE.Vector2(spec.stretch?.[0] ?? 2, spec.stretch?.[1] ?? 0) },
        uScale: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.userData.outOfFrame = true;
    // start as if the effect had been running for a while
    for (let i = 0; i < 40; i++) this.update(0.1);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private spawn(index: number): void {
    const { shape } = this.spec;
    const p = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, 1);
    if (shape.type === SHAPE_SPHERE) {
      direction.randomDirection();
      p.copy(direction).multiplyScalar(shape.radius * Math.cbrt(Math.random()));
    } else if (shape.type === SHAPE_CONE) {
      const around = Math.random() * Math.PI * 2;
      const r = shape.radius * Math.sqrt(Math.random());
      p.set(Math.cos(around) * r, Math.sin(around) * r, 0);
      const tilt = THREE.MathUtils.degToRad(shape.angle) * Math.random();
      direction.set(Math.sin(tilt) * Math.cos(around), Math.sin(tilt) * Math.sin(around), Math.cos(tilt));
    } else if (shape.type === SHAPE_BOX) {
      p.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    } else if (shape.type >= 0) {
      const around = Math.random() * Math.PI * 2;
      const r = shape.radius * Math.sqrt(Math.random());
      p.set(Math.cos(around) * r, Math.sin(around) * r, 0);
    }
    p.multiply(new THREE.Vector3(...shape.scale));
    const speed = rand(this.spec.speed);
    const extra = this.spec.velocity ?? [0, 0, 0];
    // the exported models are mirrored along X, so are the vectors of their effects
    this.position.set([-p.x, p.y, p.z], index * 3);
    this.velocity.set(
      [-direction.x * speed + extra[0], direction.y * speed + extra[1], direction.z * speed + extra[2]],
      index * 3,
    );
    this.age[index] = 0;
    this.life[index] = Math.max(rand(this.spec.life), 0.05);
    this.startSize[index] = rand(this.spec.size);
    this.angle[index] = rand(this.spec.rotation);
  }

  update(delta: number): void {
    const { spec } = this;
    // particle sizes follow the scale of the node that carries the system, as in the game
    const world = this.mesh.matrixWorld.elements;
    const scale = Math.hypot(world[0], world[1], world[2]);
    this.material.uniforms.uScale.value = scale > 1e-6 ? scale : 1;
    this.clock += delta;
    this.debt += spec.rate * delta;
    if (!this.burstDone && spec.bursts.length) {
      this.debt += spec.bursts.reduce((sum, count) => sum + count, 0);
      this.burstDone = true;
    }
    if (spec.loop && this.clock > spec.duration) {
      this.clock = 0;
      this.burstDone = false;
    }
    const tiles = (spec.tiles?.[0] ?? 1) * (spec.tiles?.[1] ?? 1);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] > 0) {
        this.age[i] += delta;
        if (this.age[i] >= this.life[i]) this.life[i] = -1;
      }
      if (this.life[i] <= 0 && this.debt >= 1) {
        this.debt -= 1;
        this.spawn(i);
      }
      const base = i * 3;
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      const t = this.age[i] / this.life[i];
      this.velocity[base + 1] -= spec.gravity * 9.81 * delta;
      this.position[base] += this.velocity[base] * delta;
      this.position[base + 1] += this.velocity[base + 1] * delta;
      this.position[base + 2] += this.velocity[base + 2] * delta;
      this.size[i] = this.startSize[i] * (spec.sizeOverLife ? sample(spec.sizeOverLife, t) : 1);
      this.frame[i] = Math.min(Math.floor(t * tiles), tiles - 1);
      const over = spec.colorOverLife;
      const k = over ? Math.min(Math.floor(t * (over.length - 1)), over.length - 2) : 0;
      const f = over ? t * (over.length - 1) - k : 0;
      for (let c = 0; c < 4; c++) {
        const life = over ? over[k][c] + (over[k + 1][c] - over[k][c]) * f : 1;
        // without a colour curve a particle fades in and out instead of popping
        const fade = c === 3 && !over ? Math.sin(Math.PI * t) : 1;
        const tint = c === 3 ? Math.min(spec.tint[3], 1) : this.tint[c];
        this.colour[i * 4 + c] = Math.min(spec.color[c], 1) * tint * life * fade;
      }
    }
    this.debt = Math.min(this.debt, this.count);
    for (const name of ['iPosition', 'iVelocity', 'iSize', 'iAngle', 'iFrame', 'iColor']) {
      this.geometry.getAttribute(name).needsUpdate = true;
    }
  }
}

/** Moves a texture across its surface, as the flowing effect shader of the game does. */
class Scroller implements Animated {
  constructor(
    private readonly map: THREE.Texture,
    private readonly speed: [number, number],
  ) {}

  update(delta: number): void {
    this.map.offset.x = (this.map.offset.x + this.speed[0] * delta) % 1;
    this.map.offset.y = (this.map.offset.y + this.speed[1] * delta) % 1;
  }

  dispose(): void {
    this.map.dispose();
  }
}

let rimTexture: THREE.Texture | null = null;

/** Matcap that is dark in the middle and bright at the edge: the look of a rim-light shell. */
function rimMatcap(): THREE.Texture {
  if (rimTexture) return rimTexture;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.min(1, Math.hypot(x - size / 2, y - size / 2) / (size / 2));
      const v = Math.round(255 * Math.pow(r, 4));
      data.set([v, v, v, 255], (y * size + x) * 4);
    }
  }
  rimTexture = new THREE.DataTexture(data, size, size);
  rimTexture.colorSpace = THREE.SRGBColorSpace;
  rimTexture.needsUpdate = true;
  return rimTexture;
}

/** Loads the textures effects refer to outside of any standard material: particle sprites and masks. */
export async function loadEffectTextures(gltf: GLTF): Promise<void> {
  const nodes = (gltf.parser.json.nodes ?? []) as { extras?: { particles?: ParticleSpec } }[];
  const wanted = new Set<number>();
  for (const node of nodes) {
    const spec = node.extras?.particles;
    if (!spec) continue;
    wanted.add(spec.texture);
    if (typeof spec.mask === 'number') wanted.add(spec.mask);
  }
  const materials = (gltf.parser.json.materials ?? []) as { extras?: { effect?: EffectMaterial } }[];
  for (const material of materials) {
    const mask = material.extras?.effect?.mask;
    if (typeof mask === 'number') wanted.add(mask);
  }
  const textures: Record<number, THREE.Texture> = {};
  await Promise.all(
    [...wanted].map(async (index) => {
      try {
        textures[index] = (await gltf.parser.getDependency('texture', index)) as THREE.Texture;
      } catch {
        /* an effect without its texture is skipped */
      }
    }),
  );
  gltf.userData.effectTextures = textures;
}

/** Turns exported effect materials into unlit blended ones and starts the particle systems of a model instance. */
export function attachEffects(root: THREE.Object3D, gltf: GLTF, enabled: boolean): Animated[] {
  const textures = (gltf.userData.effectTextures ?? {}) as Record<number, THREE.Texture>;
  const animated: Animated[] = [];
  const hosts: THREE.Object3D[] = [];
  root.traverse((node) => {
    if (node.userData.particles) hosts.push(node);
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = materials.map((material) => {
      const effect = material.userData?.effect as EffectMaterial | undefined;
      if (!effect) return material;
      if (effect.hidden || !enabled) {
        mesh.visible = false;
        return material;
      }
      mesh.userData.outOfFrame = true;
      mesh.renderOrder = 9;
      if (effect.rim) {
        const [r, g, b] = displayTint(effect.rim.color, true);
        return new THREE.MeshMatcapMaterial({
          matcap: rimMatcap(),
          color: new THREE.Color(r, g, b),
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.FrontSide,
        });
      }
      const source = material as THREE.MeshStandardMaterial;
      const tint = effect.tint ?? [1, 1, 1, 1];
      const additive = effect.blend === 'add';
      const map = source.map ? source.map.clone() : null;
      if (map && effect.uv) {
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.repeat.set(effect.uv[0], effect.uv[1]);
        map.offset.set(effect.uv[2], effect.uv[3]);
      }
      if (map && effect.scroll) {
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        animated.push(new Scroller(map, effect.scroll));
      }
      const mask = typeof effect.mask === 'number' ? (textures[effect.mask] ?? null) : null;
      const [r, g, b] = displayTint(tint, additive);
      return new THREE.MeshBasicMaterial({
        map,
        // a blended surface without a mask takes its coverage from the brightness of its own texture,
        // otherwise a texture without alpha shows as a solid panel
        alphaMap: mask ?? (additive ? null : map),
        color: new THREE.Color(r, g, b),
        opacity: Math.min(tint[3], 1),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
  if (!enabled) return animated;
  for (const host of hosts) {
    const spec = host.userData.particles as ParticleSpec;
    const map = textures[spec.texture];
    if (!map) continue;
    const mask = typeof spec.mask === 'number' ? (textures[spec.mask] ?? null) : null;
    const emitter = new Emitter(spec, map, mask);
    host.add(emitter.mesh);
    animated.push(emitter);
  }
  return animated;
}
