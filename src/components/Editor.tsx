import { useMemo, useState } from 'react';
import {
  EMPTY_APPEARANCE,
  HAIR_COLOUR,
  IRIS_COLOUR,
  SLIDER_MAX,
  colourOf,
  cssColour,
  editorUrl,
  fromPreset,
  isUntouched,
  presetsFor,
  type Appearance,
  type EditorData,
  type HeadInfo,
  type Hsva,
  type LayerKey,
  type SliderInfo,
} from '../appearance';

interface Props {
  data: EditorData;
  head: HeadInfo;
  professionId: number;
  sex: 0 | 1;
  look: Appearance;
  onChange: (look: Appearance) => void;
}

type Tab = 'presets' | 'hair' | 'makeup' | 'face' | 'body';

const TABS: [Tab, string][] = [
  ['presets', 'Пресеты'],
  ['hair', 'Волосы'],
  ['makeup', 'Макияж'],
  ['face', 'Лицо'],
  ['body', 'Тело'],
];

const LAYERS: LayerKey[] = ['brows', 'eye', 'liner', 'lips', 'blush', 'decor', 'beard'];
const CHANNELS = ['Тон', 'Насыщенность', 'Яркость', 'Плотность'];
const CHANNEL_MAX = [359, 99, 99, 99];

function ColourPicker({
  label,
  value,
  opacity,
  onChange,
}: {
  label: string;
  value: Hsva;
  opacity: boolean;
  onChange: (value: Hsva) => void;
}) {
  return (
    <fieldset className="colour">
      <legend>
        <span className="colour__swatch" style={{ background: cssColour(value) }} />
        {label}
      </legend>
      {CHANNELS.slice(0, opacity ? 4 : 3).map((name, channel) => (
        <label key={name} className="range-row">
          <span>{name}</span>
          <input
            type="range"
            min={0}
            max={CHANNEL_MAX[channel]}
            value={value[channel]}
            className={channel === 0 ? 'range-row__hue' : ''}
            onChange={(event) => {
              const next = [...value] as Hsva;
              next[channel] = Number(event.target.value);
              onChange(next);
            }}
          />
        </label>
      ))}
    </fieldset>
  );
}

/** The appearance editor: the presets, hair, make-up and the face and body sliders of the game. */
export function Editor({ data, head, professionId, sex, look, onChange }: Props) {
  const [tab, setTab] = useState<Tab>('presets');
  const presets = useMemo(() => presetsFor(data, professionId, sex), [data, professionId, sex]);
  const groups = useMemo(() => {
    const out = new Map<string, Map<string, SliderInfo[]>>();
    const paired = new Set<number>();
    for (const slider of data.sliders) {
      if (!head.bones[String(slider.data)]) continue;
      // a mirrored pair moves together: show one slider for both sides
      if (paired.has(slider.rule)) continue;
      if (slider.pair > 0) paired.add(slider.pair);
      const parts = out.get(slider.group) ?? new Map<string, SliderInfo[]>();
      parts.set(slider.part, [...(parts.get(slider.part) ?? []), slider]);
      out.set(slider.group, parts);
    }
    return out;
  }, [data, head]);
  const bodyGroups = ['Тело', 'Размер'];
  const setColour = (id: number, value: Hsva) =>
    onChange({ ...look, colours: { ...look.colours, [id]: value } });
  const setSlider = (slider: SliderInfo, value: number) => {
    const sliders = { ...look.sliders, [slider.rule]: value };
    if (slider.pair > 0) sliders[slider.pair] = value;
    onChange({ ...look, sliders });
  };

  return (
    <section className="editor" aria-label="Внешность">
      <div className="editor__tabs" role="tablist">
        {TABS.map(([key, title]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'is-on' : ''}
            onClick={() => setTab(key)}
          >
            {title}
          </button>
        ))}
        {!isUntouched(look) && (
          <button type="button" className="link editor__reset" onClick={() => onChange(EMPTY_APPEARANCE)}>
            Сбросить
          </button>
        )}
      </div>

      {tab === 'presets' && (
        <div className="tiles">
          {presets.length === 0 && <p className="muted">Для этого персонажа в игре нет готовых пресетов.</p>}
          {presets.map((preset, index) => (
            <button
              key={preset.id}
              type="button"
              className={`tile${look.preset === preset.id ? ' is-on' : ''}`}
              onClick={() => onChange(fromPreset(data, head, preset))}
            >
              {preset.name || `Пресет ${index + 1}`}
            </button>
          ))}
        </div>
      )}

      {tab === 'hair' && (
        <>
          <div className="tiles tiles--small">
            <button
              type="button"
              className={`tile${look.hair === undefined ? ' is-on' : ''}`}
              onClick={() => onChange({ ...look, hair: undefined })}
            >
              Базовая
            </button>
            {head.hair.map((hair, position) => (
              <button
                key={hair.id}
                type="button"
                className={`tile${look.hair === position ? ' is-on' : ''}`}
                onClick={() => onChange({ ...look, hair: position })}
              >
                {position + 1}
              </button>
            ))}
          </div>
          <ColourPicker
            label="Цвет волос"
            value={colourOf(data, look, HAIR_COLOUR)}
            opacity={false}
            onChange={(value) => setColour(HAIR_COLOUR, value)}
          />
        </>
      )}

      {tab === 'makeup' && (
        <>
          {LAYERS.filter((key) => head.layers[key]?.styles.some((style) => style.file)).map((key) => {
            const layer = head.layers[key];
            const choice = look.styles[key];
            return (
              <details key={key} className="fold" open={key === 'brows'}>
                <summary>{layer.name || key}</summary>
                <div className="tiles tiles--small">
                  <button
                    type="button"
                    className={`tile${choice === undefined ? ' is-on' : ''}`}
                    onClick={() => {
                      const styles = { ...look.styles };
                      delete styles[key];
                      onChange({ ...look, styles });
                    }}
                  >
                    Базовый
                  </button>
                  <button
                    type="button"
                    className={`tile${choice === -1 ? ' is-on' : ''}`}
                    onClick={() => onChange({ ...look, styles: { ...look.styles, [key]: -1 } })}
                  >
                    Нет
                  </button>
                  {layer.styles.map((style, position) =>
                    style.file ? (
                      <button
                        key={style.index}
                        type="button"
                        className={`tile tile--mask${choice === position ? ' is-on' : ''}`}
                        onClick={() => onChange({ ...look, styles: { ...look.styles, [key]: position } })}
                        title={`Вариант ${position + 1}`}
                      >
                        <img src={editorUrl(style.file)} alt="" loading="lazy" />
                      </button>
                    ) : null,
                  )}
                </div>
                <ColourPicker
                  label="Цвет"
                  value={colourOf(data, look, layer.colour)}
                  opacity
                  onChange={(value) => setColour(layer.colour, value)}
                />
              </details>
            );
          })}
          <details className="fold">
            <summary>Глаза</summary>
            <div className="tiles tiles--small">
              <button
                type="button"
                className={`tile${look.iris === undefined ? ' is-on' : ''}`}
                onClick={() => onChange({ ...look, iris: undefined })}
              >
                Базовые
              </button>
              {head.iris.map((iris, position) => (
                <button
                  key={iris.file}
                  type="button"
                  className={`tile tile--iris${look.iris === position ? ' is-on' : ''}`}
                  onClick={() => onChange({ ...look, iris: position })}
                  title={`Радужка ${position + 1}`}
                >
                  <img src={editorUrl(iris.file)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
            <ColourPicker
              label="Цвет радужки"
              value={colourOf(data, look, IRIS_COLOUR)}
              opacity
              onChange={(value) => setColour(IRIS_COLOUR, value)}
            />
          </details>
        </>
      )}

      {(tab === 'face' || tab === 'body') &&
        [...groups.entries()]
          .filter(([group]) => bodyGroups.includes(group) === (tab === 'body'))
          .map(([group, parts], order) => (
            <details key={group} className="fold" open={order === 0}>
              <summary>{group}</summary>
              {[...parts.entries()].map(([part, sliders]) => (
                <div key={part} className="slider-group">
                  <h4>{part}</h4>
                  {sliders.map((slider) => (
                    <label key={slider.rule} className="range-row">
                      <span>{slider.name || part}</span>
                      <input
                        type="range"
                        min={0}
                        max={SLIDER_MAX}
                        value={look.sliders[slider.rule] ?? Math.round(SLIDER_MAX / 2)}
                        onChange={(event) => setSlider(slider, Number(event.target.value))}
                      />
                    </label>
                  ))}
                </div>
              ))}
            </details>
          ))}
    </section>
  );
}
