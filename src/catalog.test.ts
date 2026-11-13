import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, applyFilters, canWear, mainOffer, payPrice } from './catalog';
import type { Item, Offer } from './types';

const offer = (patch: Partial<Offer>): Offer => ({
  goods: 1,
  item: 1,
  days: null,
  permanent: true,
  price: 1000,
  discount: 1000,
  currency: 2,
  tableSell: true,
  sellStart: -1,
  sellEnd: -1,
  saleStart: -1,
  saleEnd: -1,
  present: false,
  server: 'sellable',
  serverPrice: null,
  probes: [],
  ...patch,
});

const item = (patch: Partial<Item>): Item => ({
  id: 1,
  part: 'outfit',
  sex: -1,
  mask: 0xffffff,
  rarity: 2,
  nameOriginal: 'Облако тумана',
  nameCorrect: null,
  nameZh: '',
  nameEn: 'Miyun',
  descOriginal: '',
  descCorrect: null,
  descZh: '',
  descEn: '',
  icon: null,
  show: 1,
  canBuyOriginal: 1,
  getWay: '',
  getWayId: 0,
  buyLevel: 0,
  canBeDyed: 1,
  sort: 0,
  charm: 0,
  offers: [offer({})],
  status: 'on_sale',
  list1: true,
  list2: false,
  models: [],
  ...patch,
});

const mage = { classIndex: 5, sex: 1 } as const;

describe('catalog', () => {
  it('checks class and sex by the mask', () => {
    expect(canWear(item({ mask: 1 << 11 }), mage)).toBe(true);
    expect(canWear(item({ mask: 1 << 10 }), mage)).toBe(false);
    expect(canWear(item({ sex: 0 }), mage)).toBe(false);
  });

  it('prefers the permanent offer and the discounted price', () => {
    const subject = item({
      offers: [
        offer({ goods: 1, permanent: false, days: 7, price: 90, discount: 90 }),
        offer({ goods: 2, price: 450, discount: 400 }),
      ],
    });
    expect(mainOffer(subject)?.goods).toBe(2);
    expect(payPrice(mainOffer(subject)!)).toBe(400);
  });

  it('filters by query, price and availability', () => {
    const items = [
      item({ id: 1 }),
      item({
        id: 2,
        nameOriginal: 'Лев',
        part: 'mount',
        status: 'closed',
        list1: false,
        offers: [offer({ price: 300, discount: 300 })],
      }),
      item({ id: 3, nameOriginal: 'Сыч', part: 'flight', offers: [], status: 'no_shop_offer', list1: false }),
    ];
    expect(applyFilters(items, { ...EMPTY_FILTERS, query: 'лев' }, mage).map((i) => i.id)).toEqual([2]);
    expect(applyFilters(items, { ...EMPTY_FILTERS, priceMax: 500 }, mage).map((i) => i.id)).toEqual([2]);
    expect(applyFilters(items, { ...EMPTY_FILTERS, availability: 'buyable' }, mage).map((i) => i.id)).toEqual(
      [1],
    );
    expect(
      applyFilters(items, { ...EMPTY_FILTERS, availability: 'unavailable' }, mage).map((i) => i.id),
    ).toEqual([2, 3]);
    expect(applyFilters(items, { ...EMPTY_FILTERS, query: '3' }, mage).map((i) => i.id)).toEqual([3]);
  });
});
