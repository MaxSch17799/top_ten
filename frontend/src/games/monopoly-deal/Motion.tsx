import { useEffect, useRef, useState } from "react";
import { type DealView } from "../../../../shared/monopolyDeal";

export function Motion({ s }: { s: DealView }) {
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = s.events.at(-1)?.id ?? 0;
    if (
      before === null ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const effects: { node: HTMLDivElement; animation: Animation }[] = [];
    for (const e of s.events
      .filter(
        (e) =>
          e.id > before &&
          [
            "draw",
            "bank",
            "property",
            "action",
            "payment",
            "steal",
            "no",
            "set",
            "win",
          ].includes(e.type),
      )
      .slice(-5)) {
      if (e.type === "win") {
        const node = document.createElement("div");
        node.className = "deal-confetti";
        node.setAttribute("aria-hidden", "true");
        for (let i = 0; i < 48; i++) {
          const bit = document.createElement("i");
          bit.style.setProperty(
            "--confetti-x",
            `${(i * 37 + e.id * 7) % 100}%`,
          );
          bit.style.setProperty("--confetti-delay", `${(i % 8) * 0.09}s`);
          bit.style.setProperty(
            "--confetti-drift",
            `${(i % 2 ? 1 : -1) * (25 + (i % 75))}px`,
          );
          bit.style.setProperty("--confetti-spin", `${180 + i * 47}deg`);
          bit.style.background = [
            "#f4ce7f",
            "#6ee7a0",
            "#f29bc7",
            "#7dd3fc",
            "#c9b8eb",
          ][i % 5];
          node.append(bit);
        }
        document.body.append(node);
        const animation = node.animate(
          [{ opacity: 1 }, { opacity: 1, offset: 0.82 }, { opacity: 0 }],
          { duration: 3900 },
        );
        animation.onfinish = () => node.remove();
        effects.push({ node, animation });
        continue;
      }
      const attack =
        e.type === "action" &&
        ["slyDeal", "forcedDeal", "dealBreaker"].includes(e.card?.effect ?? "");
      const seat = document.querySelector(
          `[data-player="${CSS.escape(e.actor ?? "")}"]`,
        ),
        other = document.querySelector(
          `[data-player="${CSS.escape(e.target ?? "")}"]`,
        ),
        center = document.querySelector(".deal-piles");
      const hand =
        e.actor === s.yourPlayerId
          ? document.querySelector(".deal-hand")
          : seat;
      const source =
        e.type === "draw"
          ? center
          : e.type === "steal"
            ? other
            : ["bank", "property", "action"].includes(e.type)
              ? hand
              : seat;
      const dest =
        e.type === "draw"
          ? hand
          : e.type === "payment"
            ? other
            : e.type === "steal"
              ? seat
              : e.type === "bank"
                ? seat?.querySelector(".deal-bank")
                : e.type === "property"
                  ? seat?.querySelector(".deal-groups")
                  : attack
                    ? other
                    : center;
      if (!source || !dest) continue;
      const a = source.getBoundingClientRect(),
        b = dest.getBoundingClientRect();
      const node = document.createElement("div");
      node.className = `deal-flight ${e.type === "no" ? "is-no" : ""} ${attack ? "is-attack" : ""}`;
      node.setAttribute("aria-hidden", "true");
      const graphic = e.card
        ? Array.from(document.querySelectorAll(".deal-card-svg")).find((el) =>
            el.getAttribute("aria-label")?.startsWith(`${e.card!.title}, `),
          )
        : null;
      if (e.type === "no" || e.type === "set" || e.type === "payment")
        node.textContent =
          e.type === "no" ? "NO" : e.type === "set" ? "✦" : "M";
      else {
        const svg = graphic ?? center?.querySelector(".deal-card-svg");
        if (svg) node.append(svg.cloneNode(true));
      }
      node.style.left = `${a.x + a.width / 2}px`;
      node.style.top = `${a.y + Math.min(a.height / 2, 70)}px`;
      document.body.append(node);
      const animation = node.animate(
        [
          { transform: "translate(-50%,-50%) scale(.7)", opacity: 0.3 },
          {
            transform: `translate(${b.x + b.width / 2 - a.x - a.width / 2}px, ${b.y + Math.min(b.height / 2, 70) - a.y - Math.min(a.height / 2, 70)}px) rotate(12deg)`,
            opacity: 1,
          },
          { opacity: 0 },
        ],
        { duration: 450, easing: "cubic-bezier(.2,.7,.3,1)" },
      );
      animation.onfinish = () => node.remove();
      effects.push({ node, animation });
      if (attack || e.type === "steal") {
        const notice = document.createElement("div");
        notice.className = "deal-effect-notice";
        notice.setAttribute("aria-hidden", "true");
        notice.textContent = `${attack ? "↗ " : "⇄ "}${e.message}`;
        document.body.append(notice);
        const animation = notice.animate(
          [
            { opacity: 0, transform: "translate(-50%, -12px) scale(.94)" },
            {
              opacity: 1,
              transform: "translate(-50%, 0) scale(1)",
              offset: 0.12,
            },
            { opacity: 1, offset: 0.8 },
            { opacity: 0, transform: "translate(-50%, -8px)" },
          ],
          { duration: 2100 },
        );
        animation.onfinish = () => notice.remove();
        effects.push({ node: notice, animation });
      }
    }
    return () => {
      for (const e of effects) {
        e.animation.cancel();
        e.node.remove();
      }
    };
  }, [s.events, s.yourPlayerId]);
  return null;
}
export function Deadline({ s, receivedAt }: { s: DealView; receivedAt: number }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const deadline = s.pending?.deadline ?? s.turnDeadline;
  if (!deadline) return null;
  return (
    <span className="deal-countdown">
      {Math.max(
        0,
        Math.ceil((deadline - s.serverNow - (tick - receivedAt)) / 1000),
      )}
      s · {s.pending ? "response" : "turn"}
    </span>
  );
}
