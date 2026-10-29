import { useCallback, useEffect, useRef, useState } from 'react';
import { buildWsUrl, fetchGameState } from '../api';
import type { SerializedStateForPlayer } from '../lib/types';

type Status = 'idle' | 'connecting' | 'open' | 'closed' | 'error';
type VersionedState = { gameId: string; version: number };

export function useGameConnection<
  T extends VersionedState = SerializedStateForPlayer,
>({ gameId, playerToken }: { gameId: string; playerToken?: string }) {
  const identity = `${gameId}:${playerToken ?? ''}`;
  const [snapshot, setSnapshot] = useState<{
    state: T;
    identity: string;
    receivedAt: number;
  } | null>(null);
  const [wsStatus, setWsStatus] = useState<Status>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!playerToken) return;
    let disposed = false;
    let version = 0;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let attempts = 0;
    let lastMessageAt = Date.now();
    const accept = (payload: T) => {
      if (disposed || payload.gameId !== gameId || payload.version < version)
        return;
      version = payload.version;
      setSnapshot({ state: payload, identity, receivedAt: Date.now() });
      setLastError(null);
    };
    const refresh = async () => {
      try {
        const payload = await fetchGameState<T>({
          gameId,
          token: playerToken,
          sinceVersion: version,
        });
        if (!disposed) setLastError(null);
        if (payload) accept(payload);
      } catch (error) {
        if (!disposed)
          setLastError(
            error instanceof Error ? error.message : 'Connection failed',
          );
      }
    };
    refreshRef.current = refresh;
    const connect = () => {
      if (disposed) return;
      if (retry !== undefined) {
        clearTimeout(retry);
        retry = undefined;
      }
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING)
      )
        return;
      setWsStatus('connecting');
      socket = new WebSocket(buildWsUrl(gameId, playerToken));
      const ws = socket;
      ws.onopen = () => {
        if (!disposed) {
          attempts = 0;
          lastMessageAt = Date.now();
          setWsStatus('open');
          void refresh();
        }
      };
      ws.onmessage = (event) => {
        lastMessageAt = Date.now();
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'STATE' && data.payload) accept(data.payload as T);
        } catch {
          /* ignore malformed messages */
        }
      };
      ws.onerror = () => {
        if (!disposed) {
          setWsStatus('error');
          ws.close();
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        socket = null;
        setWsStatus('closed');
        retry = window.setTimeout(
          connect,
          Math.min(30_000, 1000 * 2 ** attempts++),
        );
      };
    };
    const wake = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        connect();
      }
    };
    const poll = window.setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) void refresh();
    }, 5000);
    const ping = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        if (Date.now() - lastMessageAt > 90_000) {
          socket.close();
          return;
        }
        socket.send('{"type":"PING"}');
      }
    }, 30_000);
    connect();
    void refresh();
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      disposed = true;
      if (retry !== undefined) clearTimeout(retry);
      clearInterval(poll);
      clearInterval(ping);
      socket?.close();
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [gameId, identity, playerToken]);
  const requestState = useCallback(() => refreshRef.current(), []);
  return {
    state:
      playerToken && snapshot?.identity === identity ? snapshot.state : null,
    receivedAt: snapshot?.identity === identity ? snapshot.receivedAt : 0,
    wsStatus: playerToken ? wsStatus : ('idle' as Status),
    lastError: playerToken ? lastError : null,
    requestState,
  };
}
