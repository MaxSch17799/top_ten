import { useEffect, useRef, useState, type ReactNode } from "react";
import { DEAL_GROUPS, type DealCard as Card, type DealColor, type DealPlayer } from "../../../../shared/monopolyDeal";
import DealColorMark from "../../components/DealColorMark";
import { dealColorLabel, preferredDealColor } from "../../lib/dealChoices";

export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);
  return (
    <dialog
      className="deal-modal"
      aria-label={title}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="deal-modal-title">
        <h2>{title}</h2>
        <button
          className="secondary"
          aria-label="Close card details"
          onClick={close}
        >
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Placement({
  card,
  player,
  submit,
  busy,
  exclude,
  label = "Place property",
}: {
  card: Card;
  player: DealPlayer;
  submit: (p: Record<string, unknown>) => void;
  busy: boolean;
  exclude?: string;
  label?: string;
}) {
  const [color, setColor] = useState<DealColor>(() =>
      preferredDealColor(player.table, card, exclude),
    ),
    [setChoice, setSetChoice] = useState<string | null>(null);
  const eligible = player.table.sets.filter(
    (s) =>
      s.color === color &&
      s.cards.length < DEAL_GROUPS[color].size &&
      s.id !== exclude,
  );
  const from = player.table.sets.find((s) => s.id === exclude);
  const setId =
    setChoice === ""
      ? ""
      : eligible.some((s) => s.id === setChoice)
        ? setChoice!
        : (eligible[0]?.id ?? "");
  return (
    <div className="deal-placement">
      <label className="field">
        <span>Property color</span>
        <select
          className="input"
          value={color}
          onChange={(e) => {
            setColor(e.target.value as DealColor);
            setSetChoice(null);
          }}
        >
          {card.colors.map((c) => (
            <option key={c} value={c}>
              {dealColorLabel(c)}
            </option>
          ))}
        </select>
        <DealColorMark card={card} color={color} />
      </label>
      <label className="field">
        <span>Destination group</span>
        <select
          className="input"
          value={setId}
          onChange={(e) => setSetChoice(e.target.value)}
        >
          <option value="">Start a new {dealColorLabel(color)} group</option>
          {eligible.map((s, i) => (
            <option key={s.id} value={s.id}>
              {dealColorLabel(color)} group {i + 1} · {s.cards.length}/
              {DEAL_GROUPS[color].size}
            </option>
          ))}
        </select>
      </label>
      {from && (from.house || from.hotel) && (
        <p className="deal-gold">
          Moving this card breaks a built set. Its buildings will be discarded.
        </p>
      )}
      <button
        className="primary"
        disabled={busy}
        onClick={() => submit({ color, setId, cardId: card.id })}
      >
        {label}
      </button>
    </div>
  );
}
