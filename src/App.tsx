import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_FILTERS, applyFilters, canWear, iconUrl, loadCatalog, type Filters } from './catalog';
import { Card } from './components/Card';
import { Details } from './components/Details';
import { FilterBar } from './components/FilterBar';
import { FittingRoom, modelFor } from './components/FittingRoom';
import type { Catalog, Item, Look, Part, Persona } from './types';

const PAGE = 60;
const STORE_KEY = 'pw-skins:v1';

interface Saved {
  persona: Persona;
  look: Look;
}

const PARTS: Part[] = ['outfit', 'head', 'weapon', 'back', 'shoulder', 'mount', 'flight'];

/** A shared link: ?cls=5&sex=1&look=outfit:6,head:152 */
function fromLink(): Saved | null {
  const params = new URLSearchParams(location.search);
  if (!params.has('look') && !params.has('cls')) return null;
  const look: Look = {};
  for (const pair of (params.get('look') ?? '').split(',')) {
    const [part, id] = pair.split(':');
    if (PARTS.includes(part as Part) && /^\d+$/.test(id ?? '')) look[part as Part] = Number(id);
  }
  const classIndex = Math.min(11, Math.max(0, Number(params.get('cls') ?? 5) || 0));
  return { persona: { classIndex, sex: params.get('sex') === '0' ? 0 : 1 }, look };
}

function restore(): Saved {
  const linked = fromLink();
  if (linked) return linked;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Saved | null;
    if (saved && Number.isInteger(saved.persona?.classIndex)) return saved;
  } catch {
    /* a broken record is ignored */
  }
  return { persona: { classIndex: 5, sex: 1 }, look: {} };
}

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [persona, setPersona] = useState<Persona>(() => restore().persona);
  const [look, setLook] = useState<Look>(() => restore().look);
  const [opened, setOpened] = useState<Item | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [roomOpen, setRoomOpen] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadCatalog().then(setCatalog, (reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, []);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ persona, look } satisfies Saved));
    const worn = Object.entries(look).map(([part, id]) => `${part}:${id}`);
    const params = new URLSearchParams(location.search);
    params.set('cls', String(persona.classIndex));
    params.set('sex', String(persona.sex));
    if (worn.length) params.set('look', worn.join(','));
    else params.delete('look');
    history.replaceState(null, '', `?${params.toString().replace(/%3A/g, ':').replace(/%2C/g, ',')}`);
  }, [persona, look]);

  const itemsById = useMemo(() => new Map((catalog?.items ?? []).map((item) => [item.id, item])), [catalog]);
  const deferred = useDeferredValue(filters);
  const visible = useMemo(
    () => (catalog ? applyFilters(catalog.items, deferred, persona) : []),
    [catalog, deferred, persona],
  );
  const counts = useMemo(() => {
    const base = catalog ? applyFilters(catalog.items, { ...deferred, parts: [] }, persona) : [];
    return base.reduce(
      (acc, item) => ({ ...acc, [item.part]: (acc[item.part] ?? 0) + 1 }),
      {} as Record<Part, number>,
    );
  }, [catalog, deferred, persona]);

  useEffect(() => setShown(PAGE), [deferred, persona]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && setShown((count) => count + PAGE),
      { rootMargin: '900px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [catalog]);

  const tryOn = useCallback((item: Item) => {
    setLook((current) => {
      const next = { ...current };
      if (current[item.part] === item.id) delete next[item.part];
      else {
        next[item.part] = item.id;
        if (item.part === 'mount') delete next.flight;
        if (item.part === 'flight') delete next.mount;
      }
      return next;
    });
  }, []);

  const remove = useCallback(
    (part: Part) =>
      setLook((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== part))),
    [],
  );
  const close = useCallback(() => setOpened(null), []);

  if (error) return <div className="splash">Не удалось открыть каталог: {error}</div>;
  if (!catalog) return <div className="splash">Загружаем каталог…</div>;

  const currencyIcon = iconUrl(catalog.currencyIcons.yuanbao);
  const wearable = (item: Item) => canWear(item, persona) || modelFor(catalog, item, persona) !== null;
  const wornCount = Object.keys(look).length;

  return (
    <div className={`layout${roomOpen ? ' layout--room' : ''}`}>
      <header className="top">
        <a className="brand" href="/" aria-label="Дом Моды ПВ">
          <span className="brand__mark">ДМ</span>
          <span className="brand__text">
            Дом Моды <b>ПВ</b>
          </span>
        </a>
        <label className="search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" />
          </svg>
          <input
            type="search"
            placeholder="Название, описание или номер облика"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          />
        </label>
        <button type="button" className="btn room-toggle" onClick={() => setRoomOpen((open) => !open)}>
          {roomOpen ? 'К каталогу' : `Примерочная${wornCount ? ` · ${wornCount}` : ''}`}
        </button>
      </header>

      <main className="content">
        <div className="catalog">
          <FilterBar filters={filters} counts={counts} total={visible.length} onChange={setFilters} />
          {visible.length === 0 ? (
            <p className="empty">
              Ничего не нашлось. Попробуйте снять часть фильтров или выключить «Только для моего персонажа».
            </p>
          ) : (
            <div className="grid">
              {visible.slice(0, shown).map((item) => (
                <Card
                  key={item.id}
                  item={item}
                  worn={look[item.part] === item.id}
                  wearable={wearable(item)}
                  has3d={Boolean(modelFor(catalog, item, persona)?.file)}
                  currencyIcon={currencyIcon}
                  onOpen={setOpened}
                  onTry={tryOn}
                />
              ))}
            </div>
          )}
          <div ref={sentinel} className="sentinel" />
          <footer className="foot">
            Данные клиента и ответы сервера на {new Date(catalog.generated).toLocaleDateString('ru-RU')}.
            Неофициальный фанатский каталог; все права на игру и её материалы принадлежат правообладателям.
          </footer>
        </div>
        <FittingRoom
          catalog={catalog}
          itemsById={itemsById}
          persona={persona}
          look={look}
          onPersona={setPersona}
          onRemove={remove}
          onClear={() => setLook({})}
          onOpen={setOpened}
        />
      </main>

      {opened && (
        <Details
          catalog={catalog}
          item={opened}
          persona={persona}
          worn={look[opened.part] === opened.id}
          wearable={wearable(opened)}
          currencyIcon={currencyIcon}
          onTry={tryOn}
          onClose={close}
        />
      )}
    </div>
  );
}
