import * as THREE from 'three';
import {
  HAIR_COLOUR,
  IRIS_COLOUR,
  LAYER_ORDER,
  colourOf,
  editorUrl,
  hsvToRgb,
  isUntouched,
  type Appearance,
  type BonePart,
  type EditorData,
  type HeadInfo,
} from '../appearance';

const images = new Map<string, Promise<ImageBitmap | HTMLImageElement>>();

function image(file: string): Promise<ImageBitmap | HTMLImageElement> {
  let pending = images.get(file);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const element = new Image();
      element.crossOrigin = 'anonymous';
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`Не загрузилось: ${file}`));
      element.src = editorUrl(file);
    });
    images.set(file, pending);
  }
  return pending;
}

function pixels(source: CanvasImageSource, size: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, size, size);
  return context.getImageData(0, 0, size, size).data;
}

/** How strongly a layer covers the skin at full opacity. */
const STRENGTH: Record<string, number> = {
  blush: 0.4,
  eye: 0.6,
  lips: 0.7,
  decor: 0.9,
  beard: 0.9,
  liner: 1,
  brows: 1,
};

/**
 * The face as the game composes it: base skin plus the make-up layers, each an inverted mask (0 = painted)
 * filled with the colour of its setting.
 */
export async function composeFace(
  data: EditorData,
  head: HeadInfo,
  look: Appearance,
): Promise<THREE.Texture | null> {
  if (!head.base) return null;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(await image(head.base), 0, 0, size, size);
  const frame = context.getImageData(0, 0, size, size);
  const out = frame.data;
  for (const key of LAYER_ORDER) {
    const layer = head.layers[key];
    if (!layer) continue;
    const choice = look.styles[key];
    if (choice === -1) continue;
    const style = choice === undefined ? undefined : layer.styles[choice];
    const file =
      style?.file ??
      (choice === undefined ? (layer.default ?? layer.styles.find((s) => s.file)?.file) : undefined);
    if (!file) continue;
    const setting = data.colours[String(layer.colour)];
    if (choice === undefined && look.colours[layer.colour] === undefined && setting && !setting.on) continue;
    const colour = colourOf(data, look, layer.colour);
    const [r, g, b] = hsvToRgb(colour).map((v) => v * 255);
    const opacity = (colour[3] / 99) * (STRENGTH[key] ?? 1);
    const mask = pixels(await image(file), size);
    for (let i = 0; i < out.length; i += 4) {
      const cover = (1 - mask[i] / 255) * opacity;
      if (cover <= 0.004) continue;
      out[i] += (r - out[i]) * cover;
      out[i + 1] += (g - out[i + 1]) * cover;
      out[i + 2] += (b - out[i + 2]) * cover;
    }
  }
  context.putImageData(frame, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** The eye texture with another iris drawn over the one the model ships with. */
export async function composeEye(
  data: EditorData,
  head: HeadInfo,
  look: Appearance,
  base: THREE.Texture,
): Promise<THREE.Texture | null> {
  const choice = look.iris === undefined ? undefined : head.iris[look.iris];
  const tint = look.colours[IRIS_COLOUR];
  if (!choice && !tint) return null;
  const source = base.image as CanvasImageSource & { width: number; height: number };
  const size = source.width || 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  context.drawImage(source, 0, 0, size, size);
  const iris = await image((choice ?? head.iris[0]).file);
  const span = (size * 1.75) / 2.3;
  const disc = (span / 2) * 0.53;
  context.save();
  context.beginPath();
  context.arc(size / 2, size / 2, disc, 0, Math.PI * 2);
  context.clip();
  context.drawImage(iris, (size - span) / 2, (size - span) / 2, span, span);
  if (tint) {
    const [r, g, b] = hsvToRgb(tint).map((v) => Math.round(v * 255));
    context.globalCompositeOperation = 'color';
    context.globalAlpha = tint[3] / 99;
    context.fillStyle = `rgb(${r}, ${g}, ${b})`;
    context.fillRect(0, 0, size, size);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
  }
  context.fillStyle = '#0b0909';
  context.beginPath();
  context.arc(size / 2, size / 2, disc * 0.34, 0, Math.PI * 2);
  context.fill();
  context.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  void data;
  return texture;
}

interface Rest {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Moves the face bones as the sliders of the game do; values are 0..31, bones return to rest first. */
export function applySliders(
  root: THREE.Object3D,
  head: HeadInfo,
  sliders: { rule: number; data: number }[],
  look: Appearance,
): void {
  const touched = new Map<THREE.Object3D, Rest>();
  const bone = (name: string): THREE.Object3D | undefined => {
    const node = root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
    if (!node) return undefined;
    let rest = node.userData.faceRest as Rest | undefined;
    if (!rest) {
      rest = {
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone(),
      };
      node.userData.faceRest = rest;
    }
    if (!touched.has(node)) {
      node.position.copy(rest.position);
      node.quaternion.copy(rest.quaternion);
      node.scale.copy(rest.scale);
      touched.set(node, rest);
    }
    return node;
  };
  // every bone a slider may drive goes back to rest, then the chosen values are applied
  for (const parts of Object.values(head.bones)) for (const part of parts) bone(part.bone);
  for (const slider of sliders) {
    const value = look.sliders[slider.rule];
    if (value === undefined) continue;
    // 5-bit values: 15 and 16 both sit at the neutral middle
    const t = value <= 15 ? (value / 15) * 0.5 : 0.5 + ((value - 16) / 15) * 0.5;
    for (const part of (head.bones[String(slider.data)] ?? []) as BonePart[]) {
      const node = bone(part.bone);
      if (!node) continue;
      // the middle of a slider is the face as modelled; the ends are the table's extremes
      const rest = touched.get(node)!;
      const middle = part.type === 3 ? [rest.scale.x, rest.scale.y, rest.scale.z] : [0, 0, 0];
      const [x, y, z] = [0, 1, 2].map((i) =>
        t <= 0.5 ? lerp(part.start[i], middle[i], t * 2) : lerp(middle[i], part.end[i], (t - 0.5) * 2),
      );
      if (part.type === 3) {
        // only the axes the slider varies; the others belong to the model or to another slider
        if (part.start[0] !== part.end[0]) node.scale.x = x;
        if (part.start[1] !== part.end[1]) node.scale.y = y;
        if (part.start[2] !== part.end[2]) node.scale.z = z;
      } else if (part.type === 1) {
        // the exported models are mirrored along X
        node.position.x -= x;
        node.position.y += y;
        node.position.z += z;
      } else {
        const rad = THREE.MathUtils.degToRad;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(x), rad(y), rad(z), 'YXZ'));
        node.quaternion.multiply(new THREE.Quaternion(q.x, -q.y, -q.z, q.w));
      }
    }
  }
}

/** Hair colour of the look, or null to keep the default tint. */
export function hairColour(data: EditorData, look: Appearance): THREE.Color | null {
  if (look.colours[HAIR_COLOUR] === undefined) return null;
  const [r, g, b] = hsvToRgb(colourOf(data, look, HAIR_COLOUR));
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

export { isUntouched };
