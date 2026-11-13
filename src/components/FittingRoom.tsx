import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PART_LABEL, PART_ORDER, displayName, iconUrl, slotOf } from '../catalog';
import type { Catalog, Item, Look, ModelDef, Part, Persona } from '../types';
import { Stage, type Outfit } from '../viewer/Stage';
import { ViewControls } from './ViewControls';

interface Props {
  catalog: Catalog;
  itemsById: Map<number, Item>;
  persona: Persona;
  look: Look;
  onPersona: (persona: Persona) => void;
  onRemove: (part: Part) => void;
  onClear: () => void;
  onOpen: (item: Item) => void;
}

/** The model an item uses on the persona; rigid parts fall back to any class when the persona has none. */
export function modelFor(catalog: Catalog, item: Item, persona: Persona): ModelDef | null {
  const own = item.models[slotOf(persona)];
  const shared = item.part === 'outfit' || item.part === 'head' ? null : item.models.find((key) => key);
  const key = own ?? shared;
  return key ? (catalog.modelDefs[key] ?? null) : null;
}

function bodyFor(catalog: Catalog, persona: Persona): ModelDef | null {
  const key = catalog.classes[persona.classIndex]?.bodies?.[persona.sex];
  return key ? (catalog.modelDefs[key] ?? null) : null;
}

export function FittingRoom({
  catalog,
  itemsById,
  persona,
  look,
  onPersona,
  onRemove,
  onClear,
  onOpen,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = new Stage(canvas, catalog);
    stageRef.current = stage;
    const observer = new ResizeObserver(() => stage.resize());
    observer.observe(canvas.parentElement ?? canvas);
    return () => {
      observer.disconnect();
      stage.dispose();
      stageRef.current = null;
    };
  }, [catalog]);

  const worn = useMemo(
    () =>
      PART_ORDER.flatMap((part) => {
        const item = look[part] !== undefined ? itemsById.get(look[part]!) : undefined;
        return item ? [{ part, item }] : [];
      }),
    [look, itemsById],
  );

  useEffect(() => {
    const stage = stageRef.current;
    const body = bodyFor(catalog, persona);
    if (!stage || !body) {
      setNote(body ? '' : 'Для этого класса и пола нет модели.');
      return;
    }
    const ownHead = catalog.heads.noHead.some(
      ([cls, sex]) => cls === persona.classIndex && sex === persona.sex,
    );
    const face = ownHead ? undefined : persona.sex === 0 ? catalog.heads.male : catalog.heads.female;
    const outfit: Outfit = { body, sex: persona.sex, beast: persona.classIndex === 0, face };
    const unavailable: string[] = [];
    for (const { part, item } of worn) {
      const def = modelFor(catalog, item, persona);
      if (def) outfit[part] = def;
      else unavailable.push(displayName(item));
    }
    let cancelled = false;
    setBusy(true);
    stage
      .show(outfit)
      .then((report) => {
        if (cancelled) return;
        const missing = report.missing.map((part) => PART_LABEL[part].toLowerCase());
        const parts = [
          unavailable.length ? `Не подходит персонажу: ${unavailable.join(', ')}.` : '',
          missing.length ? `Модель ещё не выгружена: ${missing.join(', ')}.` : '',
          location.search.includes('debug=1') ? stage.problems.join(' | ') : '',
        ];
        setNote(parts.filter(Boolean).join(' '));
      })
      .catch((error: unknown) => {
        console.warn('composition failed', error);
        return !cancelled && setNote(error instanceof Error ? error.message : 'Не удалось показать модель');
      })
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [catalog, persona, worn]);

  const lift = useCallback((speed: number) => stageRef.current?.setLift(speed), []);
  const zoom = useCallback((speed: number) => stageRef.current?.setZoom(speed), []);
  const reset = useCallback(() => stageRef.current?.resetView(), []);
  const current = catalog.classes[persona.classIndex];
  return (
    <aside className="room">
      <div className="room__persona">
        <label className="field">
          <span>Класс</span>
          <select
            value={persona.classIndex}
            onChange={(event) => {
              const classIndex = Number(event.target.value);
              const bodies = catalog.classes[classIndex].bodies ?? [];
              onPersona({ classIndex, sex: bodies[persona.sex] ? persona.sex : bodies[1] ? 1 : 0 });
            }}
          >
            {catalog.classes.map((cls, index) => (
              <option key={cls.key} value={index}>
                {cls.name}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label="Пол">
          {([0, 1] as const).map((sex) => (
            <button
              key={sex}
              type="button"
              className={persona.sex === sex ? 'is-on' : ''}
              disabled={!current?.bodies?.[sex]}
              onClick={() => onPersona({ ...persona, sex })}
            >
              {sex === 0 ? 'Мужской' : 'Женский'}
            </button>
          ))}
        </div>
      </div>
      <div className="room__stage">
        <canvas ref={canvasRef} />
        {busy && (
          <div className="room__busy">
            Загрузка модели…
            {location.search.includes('debug=1') ? ` ${stageRef.current?.problems.join(' > ') ?? ''}` : ''}
          </div>
        )}
        {note && !busy && <div className="room__alert">{note}</div>}
        <ViewControls onLift={lift} onZoom={zoom} onReset={reset} />
      </div>
      <div className="room__worn">
        <div className="room__worn-head">
          <span>Надето</span>
          {worn.length > 0 && (
            <button type="button" className="link" onClick={onClear}>
              Снять всё
            </button>
          )}
        </div>
        {worn.length === 0 && (
          <p className="muted">Нажмите «Примерить» на карточке — облик появится на персонаже.</p>
        )}
        {worn.map(({ part, item }) => (
          <div key={part} className="chip">
            {iconUrl(item.icon) && <img src={iconUrl(item.icon)!} alt="" loading="lazy" />}
            <button type="button" className="chip__name" onClick={() => onOpen(item)}>
              <small>{PART_LABEL[part]}</small>
              {displayName(item)}
            </button>
            <button type="button" className="chip__x" onClick={() => onRemove(part)} aria-label="Снять">
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
