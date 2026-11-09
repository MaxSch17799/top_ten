import { useEffect, useState } from "react";
import { type UnoView } from "../../../../shared/uno";
import { type Act } from "./types";

export function Results({
  s,
  act,
  busy,
  receivedAt,
}: {
  s: UnoView;
  act: Act;
  busy: boolean;
  receivedAt: number;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const result = s.result,
    done = s.phase === "COMPLETED";
  return (
    <section className="uno-results" aria-live="polite">
      <p className="eyebrow">
        {done ? "Final standings" : `Round ${s.round} complete`}
      </p>
      <h2>
        {done
          ? s.winners.length
            ? `${s.winners.map((id) => s.players.find((p) => p.playerId === id)?.nickname).join(" & ")} ${s.winners.length > 1 ? "win" : "wins"}!`
            : "Game ended"
          : result?.winner
            ? `${s.players.find((p) => p.playerId === result.winner)?.nickname} wins the round!`
            : "Round drawn"}
      </h2>
      {result?.winner && <p>+{result.points} points this round</p>}
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Points</th>
            <th>Rounds won</th>
            <th>Hand points</th>
          </tr>
        </thead>
        <tbody>
          {[...s.players]
            .sort((a, b) => b.score - a.score)
            .map((p) => (
              <tr key={p.playerId}>
                <th>{p.nickname}</th>
                <td>{p.score}</td>
                <td>{p.wins}</td>
                <td>{result?.remaining[p.playerId] ?? "—"}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {!done && (
        <>
          <p>
            Next round in{" "}
            {Math.max(
              0,
              Math.ceil(
                ((s.nextRoundAt ?? 0) -
                  s.serverNow -
                  Math.max(0, now - receivedAt)) /
                  1000,
              ),
            )}
            s
          </p>
          {s.yourRole !== "DISPLAY" && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void act("next")}
            >
              Next round now
            </button>
          )}
        </>
      )}
      {s.history.length > 1 && (
        <details>
          <summary>Round history</summary>
          {s.history.map((r) => (
            <p key={r.round}>
              Round {r.round}:{" "}
              {s.players.find((p) => p.playerId === r.winner)?.nickname ??
                "Draw"}{" "}
              · {r.points} points
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
