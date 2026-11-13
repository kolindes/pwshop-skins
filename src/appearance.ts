import { DATA_URL } from './catalog';

/** Hue 0..359, saturation, value and opacity 0..99 — the units of the game's appearance editor. */
export type Hsva = [number, number, number, number];

export type LayerKey = 'brows' | 'eye' | 'lips' | 'beard' | 'decor' | 'blush' | 'liner';

export const LAYER_ORDER: LayerKey[] = ['blush', 'eye', 'lips', 'decor', 'beard', 'liner', 'brows'];

export interface StyleOption {
  index: number;
  id?: number;
  file?: string;
  none?: boolean;
}

export interface LayerInfo {
  name: string;
  styles: StyleOption[];
  /** mask of the head's own default style, when the head ships one */
  default?: string;
  colour: number;
  rule: number;
  colourRule: number;
}

export interface BonePart {
  bone: string;
  /** 1 position offset, 2 rotation offset in degrees, 3 scale */
  type: 1 | 2 | 3;
  start: [number, number, number];
  end: [number, number, number];
}

export interface HeadInfo {
  model: string;
  defaultHair: string;
  base?: string;
  skin?: string;
  layers: Record<LayerKey, LayerInfo>;
  iris: { index: number; file: string }[];
  hair: { index: number; id: number; file: string }[];
  bones: Record<string, BonePart[]>;
}

export interface SliderInfo {
  rule: number;
  data: number;
  pair: number;
  group: string;
  part: string;
  name: string;
}

export interface ColourInfo {
  name: string;
  min: number[];
  max: number[];
  default: number[];
  on: boolean;
}

export interface Preset {
  id: number;
  name: string;
  profession: number | null;
  sex: number | null;
  values: Record<string, number>;
}

export interface EditorData {
  heads: { female: HeadInfo; male: HeadInfo };
  sliders: SliderInfo[];
  colours: Record<string, ColourInfo>;
  presets: Preset[];
}

/** What the visitor changed; anything absent keeps the look the model ships with. */
export interface Appearance {
  preset?: number;
  /** slider rule id -> 0..31 */
  sliders: Record<number, number>;
  /** layer -> position in its style list; -1 hides the layer */
  styles: Partial<Record<LayerKey, number>>;
  /** colour setting id -> colour */
  colours: Record<number, Hsva>;
  hair?: number;
  iris?: number;
}

export const EMPTY_APPEARANCE: Appearance = { sliders: {}, styles: {}, colours: {} };

export const HAIR_COLOUR = 1;
export const IRIS_COLOUR = 4;
export const SLIDER_MAX = 31;

export const isUntouched = (look: Appearance): boolean =>
  look.preset === undefined &&
  look.hair === undefined &&
  look.iris === undefined &&
  !Object.keys(look.sliders).length &&
  !Object.keys(look.styles).length &&
  !Object.keys(look.colours).length;

let pending: Promise<EditorData> | null = null;

export function loadEditor(): Promise<EditorData> {
  pending ??= fetch(`${DATA_URL}/editor/editor.json`).then((reply) => {
    if (!reply.ok) throw new Error(`Редактор не загрузился (${reply.status})`);
    return reply.json() as Promise<EditorData>;
  });
  pending.catch(() => (pending = null));
  return pending;
}

export const editorUrl = (file: string): string => `${DATA_URL}/editor/${file}`;

export function hsvToRgb([h, s, v]: Hsva | number[]): [number, number, number] {
  const sat = Math.min(Math.max(s / 99, 0), 1);
  const val = Math.min(Math.max(v / 99, 0), 1);
  const sector = (((h % 360) + 360) % 360) / 60;
  const c = val * sat;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const m = val - c;
  const [r, g, b] =
    sector < 1
      ? [c, x, 0]
      : sector < 2
        ? [x, c, 0]
        : sector < 3
          ? [0, c, x]
          : sector < 4
            ? [0, x, c]
            : sector < 5
              ? [x, 0, c]
              : [c, 0, x];
  return [r + m, g + m, b + m];
}

export const cssColour = (colour: Hsva | number[]): string => {
  const [r, g, b] = hsvToRgb(colour);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
};

/** A packed colour of a preset: hue in 9 bits, then saturation, value and opacity in 7 bits each. */
export function unpackColour(packed: number): Hsva {
  return [packed & 0x1ff, (packed >>> 9) & 0x7f, (packed >>> 16) & 0x7f, (packed >>> 23) & 0x7f];
}

/** The presets the game offers to a class and sex; all presets of the sex when the class has none. */
export function presetsFor(data: EditorData, professionId: number, sex: 0 | 1): Preset[] {
  const own = data.presets.filter((preset) => preset.profession === professionId && preset.sex === sex);
  return own.length ? own : data.presets.filter((preset) => preset.sex === sex).slice(0, 24);
}

/** Turns a game preset into editor state: sliders, style choices, colours and hair. */
export function fromPreset(data: EditorData, head: HeadInfo, preset: Preset): Appearance {
  const look: Appearance = { preset: preset.id, sliders: {}, styles: {}, colours: {} };
  for (const slider of data.sliders) {
    const value = preset.values[String(slider.rule)];
    if (typeof value === 'number') look.sliders[slider.rule] = Math.min(value, SLIDER_MAX);
  }
  for (const [key, layer] of Object.entries(head.layers) as [LayerKey, LayerInfo][]) {
    const choice = preset.values[String(layer.rule)];
    if (typeof choice === 'number') {
      const position = layer.styles.findIndex((style) => style.index === choice);
      if (position >= 0) look.styles[key] = layer.styles[position].none ? -1 : position;
    }
    const packed = preset.values[String(layer.colourRule)];
    if (typeof packed === 'number' && packed !== 0) look.colours[layer.colour] = unpackColour(packed);
  }
  const hairChoice = preset.values['116'];
  if (typeof hairChoice === 'number') {
    const position = head.hair.findIndex((hair) => hair.index === hairChoice);
    if (position >= 0) look.hair = position;
  }
  const hairColour = preset.values['117'];
  if (typeof hairColour === 'number' && hairColour !== 0)
    look.colours[HAIR_COLOUR] = unpackColour(hairColour);
  return look;
}

export const headFor = (data: EditorData, sex: 0 | 1): HeadInfo =>
  sex === 0 ? data.heads.male : data.heads.female;

/** The colour in effect for a setting: the visitor's, otherwise the game default. */
export function colourOf(data: EditorData, look: Appearance, id: number): Hsva {
  return look.colours[id] ?? (data.colours[String(id)]?.default.slice(0, 4) as Hsva) ?? [0, 0, 50, 99];
}
