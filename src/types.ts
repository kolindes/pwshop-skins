export type Part = 'outfit' | 'head' | 'weapon' | 'back' | 'shoulder' | 'mount' | 'flight';

export type Status =
  | 'on_sale'
  | 'hidden_sale'
  | 'not_yet'
  | 'special'
  | 'table_sale_unverified'
  | 'closed'
  | 'closed_unverified'
  | 'no_shop_offer';

export type ServerAnswer =
  'sellable' | 'closed' | 'not_yet' | 'event_only' | 'vip_only' | 'conflict' | 'unprobed' | 'not_probeable';

export interface Offer {
  goods: number;
  item: number;
  days: number | null;
  permanent: boolean;
  price: number;
  discount: number;
  currency: number;
  tableSell: boolean;
  sellStart: number;
  sellEnd: number;
  saleStart: number;
  saleEnd: number;
  present: boolean;
  server: ServerAnswer;
  serverPrice: number | null;
  probes: [string, string][];
}

export interface Item {
  id: number;
  part: Part;
  /** -1 any, 0 male, 1 female */
  sex: number;
  /** bit (classIndex * 2 + sex) is set when the class and sex can wear the item */
  mask: number;
  rarity: number;
  nameOriginal: string;
  nameCorrect: string | null;
  nameZh: string;
  nameEn: string;
  descOriginal: string;
  descCorrect: string | null;
  descZh: string;
  descEn: string;
  icon: string | null;
  show: number;
  canBuyOriginal: number;
  getWay: string;
  getWayId: number;
  buyLevel: number;
  canBeDyed: number;
  sort: number;
  charm: number;
  offers: Offer[];
  status: Status;
  list1: boolean;
  list2: boolean;
  /** model definition keys, one per class and sex slot */
  models: (string | null)[];
}

export interface ModelDef {
  res: string;
  file: string | null;
  bytes?: number;
  clips?: string[];
  /** outfit: animation folder; mount and flight: rider clip name */
  anim?: string | null;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: number | [number, number, number];
  bind?: string | [string, string];
  alt?: string | null;
  wings?: boolean;
}

export interface GameClass {
  key: string;
  id: number;
  name: string;
  nameZh: string;
  nameEn: string;
  bodies: (string | null)[] | null;
}

export interface Catalog {
  generated: string;
  probePasses: string[];
  classes: GameClass[];
  modelDefs: Record<string, ModelDef | null>;
  animFolders: Record<string, { file?: string; clips: string[] }>;
  points: { back: string; shoulder: string; weapon: string };
  /** separate head and default hair models per sex; noHead lists [classIndex, sex] pairs with a built-in head */
  heads: { male: HeadSet; female: HeadSet; noHead: [number, number][] };
  currencies: Record<string, string>;
  currencyIcons: Record<string, string | null>;
  items: Item[];
}

export interface HeadSet {
  head: string;
  hair: string;
}

export interface Persona {
  classIndex: number;
  sex: 0 | 1;
}

/** What the character wears in the fitting room: an item id per slot. */
export type Look = Partial<Record<Part, number>>;
