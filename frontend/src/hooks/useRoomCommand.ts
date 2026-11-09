import { useRef, useState } from 'react';
import { BACKEND_BASE, request } from '../api';
import { CommandSender } from '../lib/commandSender';

/** Complements useGameConnection; it does not create another connection or infer authority. */
export function useRoomCommand<A>({ gameId, token, refresh, setBusy, setError, afterCommit }: {
  gameId: string;
  token?: string;
  refresh(): Promise<unknown>;
  setBusy(value: boolean): void;
  setError(value: string): void;
  afterCommit?(action: A): Promise<void>;
}) {
  const sender = useRef(new CommandSender<A>());
  const [retry, setRetry] = useState<A | null>(null);
  const send = async (action: A) => token ? sender.current.send(action, {
    execute: submitted => request(`${BACKEND_BASE}/api/game/${gameId}/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(submitted), signal: AbortSignal.timeout(12_000),
    }),
    afterCommit, refresh,
    start: () => { setBusy(true); setError(''); setRetry(null); },
    failed: (error, pending) => { setError(error instanceof Error ? error.message : 'Connection failed'); setRetry(pending); },
    settled: () => setBusy(false),
  }) : false;
  return { send, retry };
}
