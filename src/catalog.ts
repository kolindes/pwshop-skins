import type { Catalog, Item, Offer, Part, Persona, Status } from './types';

export const DATA_URL = '/data';

export const PART_LABEL: Record<Part, string> = {
  outfit: 'Стили',
  head: 'Причёски и шляпы',
  weapon: 'Оружие',
  back: 'На спину',
  shoulder: 'Спутники на плечо',
  mount: 'Ездовые',
  flight: 'Полёты',
};

export const PART_ORDER: Part[] = ['outfit', 'head', 'weapon', 'back', 'shoulder', 'mount', 'flight'];

export const STATUS_LABEL: Record<Status, string> = {
  on_sale: 'В продаже',
  hidden_sale: 'Скрыт, но продаётся',
  not_yet: 'Ещё недоступен',
  special: 'Особые условия',
  table_sale_unverified: 'В продаже (не проверено)',
  closed: 'Не продаётся',
  closed_unverified: 'Не продаётся (по таблице)',
  no_shop_offer: 'Нет в магазине',
};

export const STATUS_HINT: Record<Status, string> = {
  on_sale: 'Виден в магазине, сервер подтвердил продажу.',
  hidden_sale: 'В магазине не показан, но сервер принимает покупку.',
  not_yet: 'Сервер отвечает «Этот предмет ещё недоступен»: продажа заведена, но не открыта.',
  special: 'Сервер продаёт только при особых условиях (событие или VIP).',
  table_sale_unverified: 'По таблице клиента продаётся; сервером не проверено.',
  closed: 'Сервер отвечает, что предмет не продаётся.',
  closed_unverified: 'По таблице клиента не продаётся; сервером не проверено.',
  no_shop_offer: 'У облика нет товара в магазине: выдаётся иначе или не выдаётся.',
};

export const RARITY_LABEL = ['—', 'B', 'A', 'S', 'S+'];

export type Availability = 'all' | 'list1' | 'buyable' | 'unavailable';

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  all: 'Все',
  list1: 'Видны в магазине',
  buyable: 'Можно купить',
  unavailable: 'Недоступные',
};

export type SortKey = 'default' | 'price_asc' | 'price_desc' | 'name' | 'new';

export const SORT_LABEL: Record<SortKey, string> = {
  default: 'Как в игре',
  price_asc: 'Сначала дешёвые',
  price_desc: 'Сначала дорогие',
  name: 'По названию',
  new: 'Сначала новые',
};

export interface Filters {
  query: string;
  parts: Part[];
  availability: Availability;
  rarities: number[];
  priceMin: number | null;
  priceMax: number | null;
  wearableOnly: boolean;
  sort: SortKey;
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  parts: [],
  availability: 'all',
  rarities: [],
  priceMin: null,
  priceMax: null,
  wearableOnly: true,
  sort: 'default',
};

export async function loadCatalog(): Promise<Catalog> {
  const reply = await fetch(`${DATA_URL}/catalog.json`);
  if (!reply.ok) throw new Error(`Каталог не загрузился (${reply.status})`);
  return (await reply.json()) as Catalog;
}

export const slotOf = (persona: Persona): number => persona.classIndex * 2 + persona.sex;

export const displayName = (item: Item): string =>
  item.nameCorrect || item.nameOriginal || item.nameEn || item.nameZh || `№ ${item.id}`;

export const displayDesc = (item: Item): string => item.descCorrect || item.descOriginal || item.descEn;

export function canWear(item: Item, persona: Persona): boolean {
  if (item.sex !== -1 && item.sex !== persona.sex) return false;
  const slot = slotOf(persona);
  if (((item.mask >>> slot) & 1) !== 1) return false;
  // the mask may name a class and sex pair the game has no model for
  return item.models.length === 0 || item.models[slot] != null;
}

/** The offer shown on a card: the permanent one when it exists, otherwise the cheapest. */
export function mainOffer(item: Item): Offer | null {
  if (!item.offers.length) return null;
  const permanent = item.offers.filter((o) => o.permanent);
  const pool = permanent.length ? permanent : item.offers;
  return pool.reduce((best, o) => (payPrice(o) < payPrice(best) ? o : best));
}

export const payPrice = (offer: Offer): number =>
  offer.serverPrice ?? (offer.discount > 0 && offer.discount < offer.price ? offer.discount : offer.price);

export const isBuyable = (item: Item): boolean => item.status === 'on_sale' || item.status === 'hidden_sale';

const UNAVAILABLE: Status[] = ['closed', 'closed_unverified', 'no_shop_offer', 'not_yet'];

function matchesAvailability(item: Item, availability: Availability): boolean {
  switch (availability) {
    case 'list1':
      return item.list1;
    case 'buyable':
      return isBuyable(item);
    case 'unavailable':
      return UNAVAILABLE.includes(item.status);
    default:
      return true;
  }
}

const normalise = (text: string): string => text.toLowerCase().replace(/ё/g, 'е').trim();

function matchesQuery(item: Item, query: string): boolean {
  if (!query) return true;
  if (/^\d+$/.test(query))
    return String(item.id) === query || item.offers.some((o) => String(o.goods) === query);
  const hay = normalise(
    [item.nameCorrect, item.nameOriginal, item.nameEn, item.nameZh, item.descOriginal, item.getWay].join(' '),
  );
  return query.split(/\s+/).every((word) => hay.includes(word));
}

export function applyFilters(items: Item[], filters: Filters, persona: Persona): Item[] {
  const query = normalise(filters.query);
  const out = items.filter((item) => {
    if (filters.parts.length && !filters.parts.includes(item.part)) return false;
    if (filters.rarities.length && !filters.rarities.includes(item.rarity)) return false;
    if (filters.wearableOnly && !canWear(item, persona)) return false;
    if (!matchesAvailability(item, filters.availability)) return false;
    if (filters.priceMin !== null || filters.priceMax !== null) {
      const offer = mainOffer(item);
      if (!offer) return false;
      const price = payPrice(offer);
      if (filters.priceMin !== null && price < filters.priceMin) return false;
      if (filters.priceMax !== null && price > filters.priceMax) return false;
    }
    return matchesQuery(item, query);
  });
  const price = (item: Item) => {
    const offer = mainOffer(item);
    return offer ? payPrice(offer) : Number.POSITIVE_INFINITY;
  };
  switch (filters.sort) {
    case 'price_asc':
      return out.sort((a, b) => price(a) - price(b));
    case 'price_desc':
      return out.sort(
        (a, b) => (price(b) === Infinity ? -1 : price(b)) - (price(a) === Infinity ? -1 : price(a)),
      );
    case 'name':
      return out.sort((a, b) => displayName(a).localeCompare(displayName(b), 'ru'));
    case 'new':
      return out.sort((a, b) => b.id - a.id);
    default:
      return out.sort(
        (a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part) || a.sort - b.sort || a.id - b.id,
      );
  }
}

export const iconUrl = (file: string | null | undefined): string | null =>
  file ? `${DATA_URL}/icons/${file}` : null;

export function formatDuration(offer: Offer): string {
  if (offer.permanent) return 'Навсегда';
  if (offer.days === null) return '—';
  return `${offer.days} дн.`;
}
