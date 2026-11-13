import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

interface Props {
  /** vertical speed of the view, -1 (down) .. 1 (up); 0 stops */
  onLift: (speed: number) => void;
  /** zoom speed, -1 (away) .. 1 (closer); 0 stops */
  onZoom: (speed: number) => void;
  onReset: () => void;
}

const TRAVEL = 34;

/** Press-and-hold button: acts while the pointer is down, on touch screens and with a mouse alike. */
function HoldButton({
  label,
  title,
  onHold,
}: {
  label: string;
  title: string;
  onHold: (active: boolean) => void;
}) {
  const stop = useCallback(() => onHold(false), [onHold]);
  return (
    <button
      type="button"
      className="view__button"
      title={title}
      aria-label={title}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onHold(true);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(event) => (event.key === ' ' || event.key === 'Enter') && onHold(true)}
      onKeyUp={stop}
      onBlur={stop}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </button>
  );
}

/** Zoom buttons and a vertical joystick that slides the view along the character. */
export function ViewControls({ onLift, onZoom, onReset }: Props) {
  const [offset, setOffset] = useState(0);
  const origin = useRef<number | null>(null);

  const release = useCallback(() => {
    origin.current = null;
    setOffset(0);
    onLift(0);
  }, [onLift]);

  useEffect(() => () => onLift(0), [onLift]);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (origin.current === null) return;
    const delta = Math.max(-TRAVEL, Math.min(TRAVEL, event.clientY - origin.current));
    setOffset(delta);
    onLift(-delta / TRAVEL);
  };

  return (
    <div className="view">
      <button
        type="button"
        className="view__button"
        onClick={onReset}
        title="Вернуть вид"
        aria-label="Вернуть вид"
      >
        ⟲
      </button>
      <HoldButton label="+" title="Приблизить" onHold={(active) => onZoom(active ? 1 : 0)} />
      <HoldButton label="−" title="Отдалить" onHold={(active) => onZoom(active ? -1 : 0)} />
      <div
        className="view__stick"
        role="slider"
        aria-label="Сдвиг вида вверх и вниз"
        aria-orientation="vertical"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Number((-offset / TRAVEL).toFixed(2))}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          origin.current = event.clientY - offset;
          move(event);
        }}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') onLift(1);
          if (event.key === 'ArrowDown') onLift(-1);
        }}
        onKeyUp={() => onLift(0)}
        onBlur={() => onLift(0)}
      >
        <span className="view__arrow">▲</span>
        <span className="view__knob" style={{ transform: `translateY(${offset}px)` }} />
        <span className="view__arrow">▼</span>
      </div>
    </div>
  );
}
