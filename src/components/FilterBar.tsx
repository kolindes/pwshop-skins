import {
  AVAILABILITY_LABEL,
  EMPTY_FILTERS,
  PART_LABEL,
  PART_ORDER,
  RARITY_LABEL,
  SORT_LABEL,
  type Availability,
  type Filters,
  type SortKey,
} from '../catalog';
import type { Part } from '../types';

interface Props {
  filters: Filters;
  counts: Record<Part, number>;
  total: number;
  onChange: (filters: Filters) => void;
}

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

const toNumber = (text: string): number | null => {
  const value = Number(text.replace(/\s/g, ''));
  return text.trim() === '' || !Number.isFinite(value) || value < 0 ? null : value;
};

export function FilterBar({ filters, counts, total, onChange }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const dirty = JSON.stringify({ ...filters, query: '' }) !== JSON.stringify(EMPTY_FILTERS);
  return (
    <section className="filters" aria-label="Фильтры">
      <div className="filters__row filters__row--scroll">
        <button
          type="button"
          className={`pill${filters.parts.length === 0 ? ' is-on' : ''}`}
          onClick={() => set({ parts: [] })}
        >
          Всё
        </button>
        {PART_ORDER.map((part) => (
          <button
            key={part}
            type="button"
            className={`pill${filters.parts.includes(part) ? ' is-on' : ''}`}
            onClick={() => set({ parts: toggle(filters.parts, part) })}
          >
            {PART_LABEL[part]}
            <small>{counts[part] ?? 0}</small>
          </button>
        ))}
      </div>
      <div className="filters__row">
        <div className="segmented" role="group" aria-label="Доступность">
          {(Object.keys(AVAILABILITY_LABEL) as Availability[]).map((key) => (
            <button
              key={key}
              type="button"
              className={filters.availability === key ? 'is-on' : ''}
              onClick={() => set({ availability: key })}
            >
              {AVAILABILITY_LABEL[key]}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Редкость">
          {[1, 2, 3, 4].map((rarity) => (
            <button
              key={rarity}
              type="button"
              className={filters.rarities.includes(rarity) ? 'is-on' : ''}
              onClick={() => set({ rarities: toggle(filters.rarities, rarity) })}
            >
              {RARITY_LABEL[rarity]}
            </button>
          ))}
        </div>
        <div className="range" aria-label="Цена">
          <input
            inputMode="numeric"
            placeholder="Цена от"
            value={filters.priceMin ?? ''}
            onChange={(event) => set({ priceMin: toNumber(event.target.value) })}
          />
          <span>—</span>
          <input
            inputMode="numeric"
            placeholder="до"
            value={filters.priceMax ?? ''}
            onChange={(event) => set({ priceMax: toNumber(event.target.value) })}
          />
        </div>
        <label className="check-pill">
          <input
            type="checkbox"
            checked={filters.wearableOnly}
            onChange={(event) => set({ wearableOnly: event.target.checked })}
          />
          Только для моего персонажа
        </label>
        <select
          className="select"
          value={filters.sort}
          onChange={(event) => set({ sort: event.target.value as SortKey })}
          aria-label="Сортировка"
        >
          {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABEL[key]}
            </option>
          ))}
        </select>
        <span className="filters__total">
          {total.toLocaleString('ru-RU')} шт.
          {dirty && (
            <button
              type="button"
              className="link"
              onClick={() => onChange({ ...EMPTY_FILTERS, query: filters.query })}
            >
              Сбросить
            </button>
          )}
        </span>
      </div>
    </section>
  );
}
