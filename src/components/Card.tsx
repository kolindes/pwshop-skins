import { memo } from 'react';
import { RARITY_LABEL, STATUS_LABEL, displayName, iconUrl, mainOffer, payPrice } from '../catalog';
import type { Item } from '../types';

interface Props {
  item: Item;
  worn: boolean;
  wearable: boolean;
  /** the model of the item for the current character is available */
  has3d: boolean;
  currencyIcon: string | null;
  onOpen: (item: Item) => void;
  onTry: (item: Item) => void;
}

export function Price({ item, currencyIcon }: { item: Item; currencyIcon: string | null }) {
  const offer = mainOffer(item);
  if (!offer) return <span className="price price--none">Не продаётся в магазине</span>;
  const price = payPrice(offer);
  return (
    <span className="price">
      {currencyIcon && <img src={currencyIcon} alt="" />}
      <b>{price.toLocaleString('ru-RU')}</b>
      {price < offer.price && <s>{offer.price.toLocaleString('ru-RU')}</s>}
      {!offer.permanent && offer.days !== null && <small>/ {offer.days} дн.</small>}
    </span>
  );
}

export const Card = memo(function Card({ item, worn, wearable, has3d, currencyIcon, onOpen, onTry }: Props) {
  const icon = iconUrl(item.icon);
  return (
    <article className={`card card--r${item.rarity}${worn ? ' is-worn' : ''}`}>
      <button
        type="button"
        className="card__media"
        onClick={() => onOpen(item)}
        aria-label={displayName(item)}
      >
        {icon ? (
          <img src={icon} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="card__noicon">?</span>
        )}
        {!has3d && <span className="card__no3d">без 3D</span>}
        {item.rarity > 0 && <span className="card__rarity">{RARITY_LABEL[item.rarity]}</span>}
        <span className={`badge badge--${item.status}`}>{STATUS_LABEL[item.status]}</span>
      </button>
      <div className="card__body">
        <button type="button" className="card__name" onClick={() => onOpen(item)}>
          {displayName(item)}
        </button>
        <Price item={item} currencyIcon={currencyIcon} />
        <button
          type="button"
          className={`btn btn--small${worn ? ' btn--on' : ''}`}
          disabled={!wearable}
          title={wearable ? '' : 'Не подходит выбранному персонажу'}
          onClick={() => onTry(item)}
        >
          {worn ? 'Снять' : 'Примерить'}
        </button>
      </div>
    </article>
  );
});
