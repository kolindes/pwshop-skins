import { useEffect } from 'react';
import {
  PART_LABEL,
  RARITY_LABEL,
  STATUS_HINT,
  STATUS_LABEL,
  displayDesc,
  displayName,
  formatDuration,
  iconUrl,
  payPrice,
} from '../catalog';
import type { Catalog, Item, Offer, Persona } from '../types';

interface Props {
  catalog: Catalog;
  item: Item;
  persona: Persona;
  worn: boolean;
  wearable: boolean;
  currencyIcon: string | null;
  onTry: (item: Item) => void;
  onClose: () => void;
}

const SERVER_LABEL: Record<Offer['server'], string> = {
  sellable: 'Сервер продаёт',
  closed: 'Сервер: не продаётся',
  not_yet: 'Сервер: ещё недоступен',
  event_only: 'Сервер: только в событии',
  vip_only: 'Сервер: только VIP',
  conflict: 'Ответы сервера расходятся',
  unprobed: 'Не проверено',
  not_probeable: 'Не проверено',
};

const gameDate = (value: number): string | null => {
  const text = String(value);
  if (value <= 0 || text.length < 8) return null;
  return `${text.slice(6, 8)}.${text.slice(4, 6)}.${text.slice(0, 4)}`;
};

function period(offer: Offer): string | null {
  const from = gameDate(offer.sellStart);
  const to = gameDate(offer.sellEnd);
  if (!from && !to) return null;
  return `${from ?? '…'} — ${to ?? '…'}`;
}

function wearers(catalog: Catalog, item: Item): string {
  const names = catalog.classes.flatMap((cls, index) => {
    const male = (item.mask >>> (index * 2)) & 1 && item.sex !== 1;
    const female = (item.mask >>> (index * 2 + 1)) & 1 && item.sex !== 0;
    if (male && female) return [cls.name];
    if (male) return [`${cls.name} (м)`];
    if (female) return [`${cls.name} (ж)`];
    return [];
  });
  const everyone = catalog.classes.every((cls) => names.includes(cls.name) || !cls.bodies?.[0]);
  return everyone && names.length >= catalog.classes.length - 1 ? 'Все классы' : names.join(', ') || '—';
}

export function Details({ catalog, item, worn, wearable, currencyIcon, onTry, onClose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const icon = iconUrl(item.icon);
  const translated = item.nameCorrect && item.nameCorrect !== item.nameOriginal;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={displayName(item)} onClick={onClose}>
      <div className="modal__panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal__close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <header className="details__head">
          <div className={`details__icon card--r${item.rarity}`}>{icon && <img src={icon} alt="" />}</div>
          <div>
            <p className="details__kind">
              {PART_LABEL[item.part]}
              {item.rarity > 0 && <> · класс {RARITY_LABEL[item.rarity]}</>}
            </p>
            <h2>{displayName(item)}</h2>
            <p className="details__names">
              {translated && <span>В игре: {item.nameOriginal}</span>}
              {item.nameEn && <span>EN: {item.nameEn}</span>}
              {item.nameZh && <span>中文: {item.nameZh}</span>}
            </p>
          </div>
        </header>

        {displayDesc(item) && <p className="details__desc">{displayDesc(item)}</p>}

        <div className={`details__status badge--${item.status}`}>
          <b>{STATUS_LABEL[item.status]}</b>
          <span>{STATUS_HINT[item.status]}</span>
        </div>

        <dl className="facts">
          <div>
            <dt>Как получить</dt>
            <dd>{item.getWay || '—'}</dd>
          </div>
          <div>
            <dt>Кому подходит</dt>
            <dd>{wearers(catalog, item)}</dd>
          </div>
          <div>
            <dt>В витрине игры</dt>
            <dd>
              {item.list1 ? 'Показан и продаётся' : item.show === 1 ? 'Показан, покупка закрыта' : 'Скрыт'}
            </dd>
          </div>
          <div>
            <dt>Окраска</dt>
            <dd>{item.canBeDyed === 1 ? 'Можно красить' : 'Не красится'}</dd>
          </div>
          {item.charm > 0 && (
            <div>
              <dt>Обаяние</dt>
              <dd>+{item.charm}</dd>
            </div>
          )}
          <div>
            <dt>Номер облика</dt>
            <dd>{item.id}</dd>
          </div>
        </dl>

        {item.offers.length > 0 && (
          <table className="offers">
            <thead>
              <tr>
                <th>Срок</th>
                <th>Цена</th>
                <th>Период продажи</th>
                <th>Проверка</th>
              </tr>
            </thead>
            <tbody>
              {item.offers.map((offer) => (
                <tr key={offer.goods}>
                  <td>{formatDuration(offer)}</td>
                  <td>
                    <span className="price">
                      {currencyIcon && <img src={currencyIcon} alt="" />}
                      <b>{payPrice(offer).toLocaleString('ru-RU')}</b>
                      {payPrice(offer) < offer.price && <s>{offer.price.toLocaleString('ru-RU')}</s>}
                    </span>
                  </td>
                  <td>{period(offer) ?? (offer.tableSell ? 'Без срока' : '—')}</td>
                  <td className={`check check--${offer.server}`}>
                    {SERVER_LABEL[offer.server]}
                    <small>товар № {offer.goods}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <footer className="details__foot">
          <button
            type="button"
            className={`btn${worn ? ' btn--on' : ''}`}
            disabled={!wearable}
            onClick={() => onTry(item)}
          >
            {worn ? 'Снять' : 'Примерить'}
          </button>
          {!wearable && (
            <span className="muted">Не подходит выбранному персонажу — смените класс или пол.</span>
          )}
        </footer>
      </div>
    </div>
  );
}
