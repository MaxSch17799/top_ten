import { useCallback, useEffect, useRef, useState } from 'react';
import type { JustOneAction, JustOneView } from '../../../shared/justOne';
import type { SessionData } from '../lib/types';
import { BACKEND_BASE, request } from '../api';

// Save privately before the deadline; the server alarm commits the latest saved text.
export function useDraftSync({
  state,
  session,
  type,
  payload,
  enabled = true,
  receivedAt,
}: {
  state: JustOneView;
  session: SessionData;
  type: 'draft-clues' | 'draft-guess';
  payload: Record<string, unknown>;
  enabled?: boolean;
  receivedAt: number;
}) {
  const content = JSON.stringify(payload);
  const [saved, setSaved] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const flushRef = useRef(() => {});
  const { gameId, generation, round, phase } = state;
  const { playerToken } = session;
  const deadline = state.deadline;
  const clockOffset = state.serverNow - receivedAt;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let pending = false;
    let complete = false;
    let retry: number | undefined;
    const action: JustOneAction = {
      id: crypto.randomUUID(),
      type,
      generation,
      round,
      phase,
      payload: JSON.parse(content),
    };
    const save = () => {
      if (disposed || pending || complete) return;
      pending = true;
      queue.current = queue.current
        .catch(() => undefined)
        .then(async () => {
          if (disposed) return;
          await request(`${BACKEND_BASE}/api/game/${gameId}/action`, {
            method: 'POST',
            keepalive: true,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${playerToken}`,
            },
            body: JSON.stringify(action),
          });
          if (!disposed) {
            complete = true;
            setSaved(content);
            setFailed(null);
          }
        })
        .catch(() => {
          if (!disposed) {
            setFailed(content);
            retry = window.setTimeout(save, 1500);
          }
        })
        .finally(() => {
          pending = false;
        });
    };
    flushRef.current = save;
    // Stop debouncing near the deadline so a final edit is sent immediately.
    const delay =
      deadline !== null && deadline - (Date.now() + clockOffset) <= 1500
        ? 0
        : 250;
    const timer = window.setTimeout(save, delay);
    const hide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('online', save);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', hide);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(retry);
      window.removeEventListener('online', save);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [
    clockOffset,
    content,
    deadline,
    enabled,
    gameId,
    generation,
    phase,
    playerToken,
    round,
    type,
  ]);
  return {
    status:
      saved === content
        ? 'Draft saved'
        : failed === content
          ? 'Draft not synced — reconnect before time runs out'
          : 'Saving draft…',
    flush: useCallback(() => flushRef.current(), []),
    markDirty: useCallback(() => {
      setSaved(null);
      setFailed(null);
    }, []),
  };
}
