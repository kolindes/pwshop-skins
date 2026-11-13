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
  blend: 'add' | 'alpha';
  tint: [number, number, number, number];
  sizeOverLife?: number[] | null;
  colorOverLife?: [number, number, number, number][] | null;
  tiles?: [number, number];
  velocity?: [number, number, number];
}

interface EffectMaterial {
  hidden?: boolean;
  blend?: 'add' | 'alpha';
  tint?: [number, number, number, number];
  uv?: [number, number, number, number];
}

const MAX_PARTICLES_PER_SYSTEM = 160;
const SHAPE_SPHERE = 0;
const SHAPE_CONE = 4;
const SHAPE_BOX = 5;

const rand = (range: [number, number]): number => range[0] + Math.random() * (range[1] - range[0]);

function sample(curve: number[], t: number): number {
  const x = Math.min(Math.max(t, 0), 1) * (curve.length - 1);
  const i = Math.floor(x);
  const next = Math.min(i + 1, curve.length - 1);
  return curve[i] + (curve[next] - curve[i]) * (x - i);
}

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAngle;
  attribute float aFrame;
  attribute vec4 aColor;
  uniform float uPixels;
  varying vec4 vColor;
  varying float vAngle;
  varying float vFrame;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uPixels / max(-mv.z, 0.01), 0.0, 512.0);
    vColor = aColor;
    vAngle = aAngle;
    vFrame = aFrame;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uTiles;
  uniform float uAdditive;
  varying vec4 vColor;
  varying float vAngle;
  varying float vFrame;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vAngle);
    float s = sin(vAngle);
    vec2 uv = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
    float frame = floor(vFrame);
    vec2 cell = vec2(mod(frame, uTiles.x), floor(frame / uTiles.x));
    uv = (vec2(uv.x, 1.0 - uv.y) + vec2(cell.x, uTiles.y - 1.0 - cell.y)) / uTiles;
    vec4 texel = texture2D(uMap, uv);
    // a texture without an alpha channel carries its shape in brightness
    if (texel.a > 0.995) texel.a = max(texel.r, max(texel.g, texel.b));
    vec4 colour = texel * vColor;
    // additive effect textures usually carry their shape in the colour, not in alpha
    float alpha = mix(colour.a, max(colour.a, max(colour.r, max(colour.g, colour.b))) * vColor.a, uAdditive);
    gl_FragColor = vec4(colour.rgb * mix(1.0, alpha, uAdditive), alpha);
    #include <colorspace_fragment>
  }
`;

/** Replays one exported particle system as camera-facing sprites in the space of its node. */
export class Emitter {
  readonly points: THREE.Points;
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
  private readonly material: THREE.ShaderMaterial;
  private debt = 0;
  private clock = 0;
  private burstDone = false;

  constructor(
    private readonly spec: ParticleSpec,
    map: THREE.Texture,
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
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geometry.setAttribute('aAngle', new THREE.BufferAttribute(this.angle, 1));
    geometry.setAttribute('aFrame', new THREE.BufferAttribute(this.frame, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colour, 4));
    const additive = spec.blend === 'add';
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uMap: { value: map },
        uPixels: { value: 600 },
        uTiles: { value: new THREE.Vector2(spec.tiles?.[0] ?? 1, spec.tiles?.[1] ?? 1) },
        uAdditive: { value: additive ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      premultipliedAlpha: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.points.userData.outOfFrame = true;
    // start as if the effect had been running for a while
    for (let i = 0; i < 40; i++) this.update(0.1, 600);
  }

  dispose(): void {
    this.points.geometry.dispose();
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

  update(delta: number, pixels: number): void {
    const { spec } = this;
    this.material.uniforms.uPixels.value = pixels;
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
        this.colour[i * 4 + c] =
          spec.color[c] * spec.tint[c] * life * (c === 3 && !over ? Math.sin(Math.PI * t) : 1);
      }
    }
    this.debt = Math.min(this.debt, this.count);
    for (const name of ['position', 'aSize', 'aAngle', 'aFrame', 'aColor']) {
      this.points.geometry.getAttribute(name).needsUpdate = true;
    }
  }
}

/** Loads the textures the particle systems of a model refer to; they are not part of any material. */
export async function loadEffectTextures(gltf: GLTF): Promise<void> {
  const nodes = (gltf.parser.json.nodes ?? []) as { extras?: { particles?: ParticleSpec } }[];
  const wanted = new Set(
    nodes.flatMap((node) => (node.extras?.particles ? [node.extras.particles.texture] : [])),
  );
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
export function attachEffects(root: THREE.Object3D, gltf: GLTF, enabled: boolean): Emitter[] {
  const textures = (gltf.userData.effectTextures ?? {}) as Record<number, THREE.Texture>;
  const emitters: Emitter[] = [];
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
      const source = material as THREE.MeshStandardMaterial;
      const tint = effect.tint ?? [1, 1, 1, 1];
      const additive = effect.blend === 'add';
      const map = source.map ? source.map.clone() : null;
      if (map && effect.uv) {
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.repeat.set(effect.uv[0], effect.uv[1]);
        map.offset.set(effect.uv[2], effect.uv[3]);
      }
      mesh.userData.outOfFrame = true;
      mesh.renderOrder = 9;
      return new THREE.MeshBasicMaterial({
        map,
        color: new THREE.Color(Math.min(tint[0], 2), Math.min(tint[1], 2), Math.min(tint[2], 2)),
        opacity: Math.min(tint[3], 1),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
  if (!enabled) return emitters;
  for (const host of hosts) {
    const spec = host.userData.particles as ParticleSpec;
    const map = textures[spec.texture];
    if (!map) continue;
    const emitter = new Emitter(spec, map);
    host.add(emitter.points);
    emitters.push(emitter);
  }
  return emitters;
}
