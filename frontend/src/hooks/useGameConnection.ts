import { useCallback, useEffect, useRef, useState } from 'react';
import { buildWsUrl, fetchGameState } from '../api';
import type { SerializedStateForPlayer } from '../lib/types';

type WebSocketStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

interface UseGameConnectionProps {
  gameId: string;
  playerToken?: string;
}

interface UseGameConnectionResult {
  state: SerializedStateForPlayer | null;
  wsStatus: WebSocketStatus;
  lastError: string | null;
  requestState: () => Promise<void>;
}

export function useGameConnection({ gameId, playerToken }: UseGameConnectionProps): UseGameConnectionResult {
  const [state, setState] = useState<SerializedStateForPlayer | null>(null);
  const [wsStatus, setWsStatus] = useState<WebSocketStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const sinceVersionRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<number | null>(null);
  const pingRef = useRef<number | null>(null);

  const fetchLatestState = useCallback(async () => {
    if (!playerToken) {
      return;
    }
    try {
      const payload = await fetchGameState({
        gameId,
        token: playerToken,
        sinceVersion: sinceVersionRef.current,
      });
      if (payload) {
        sinceVersionRef.current = payload.version;
        setState(payload);
      }
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Failed to load state');
    }
  }, [gameId, playerToken]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const stopPinging = useCallback(() => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
  }, []);

  const startPinging = useCallback(() => {
    if (pingRef.current || typeof window === 'undefined') {
      return;
    }
    pingRef.current = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'PING' }));
      }
    }, 60_000);
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current || !playerToken || typeof window === 'undefined') {
      return;
    }
    pollRef.current = window.setInterval(() => {
      void fetchLatestState();
    }, 5000);
  }, [fetchLatestState, playerToken]);

  useEffect(() => {
    if (!playerToken) {
      sinceVersionRef.current = 0;
      stopPolling();
      stopPinging();
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    sinceVersionRef.current = 0;
    const ws = new WebSocket(buildWsUrl(gameId, playerToken));
    wsRef.current = ws;
    ws.onopen = () => {
      setWsStatus('open');
      setLastError(null);
      stopPolling();
      startPinging();
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?.type === 'STATE' && message.payload) {
          const payload = message.payload as SerializedStateForPlayer;
          sinceVersionRef.current = payload.version;
          setState(payload);
        }
      } catch (error) {
        console.error('ws payload', error);
      }
    };
    ws.onerror = () => {
      setWsStatus('error');
      setLastError('Realtime connection failed');
      stopPinging();
      startPolling();
    };
    ws.onclose = () => {
      setWsStatus((current) => (current === 'open' ? 'closed' : current));
      stopPinging();
      startPolling();
    };

    void fetchLatestState();
    startPolling();

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      stopPolling();
      stopPinging();
    };
  }, [gameId, playerToken, fetchLatestState, startPinging, startPolling, stopPinging, stopPolling]);

  useEffect(() => {
    if (wsStatus === 'open') {
      stopPolling();
    }
  }, [stopPolling, wsStatus]);

  const hasFreshState = state?.gameId === gameId;
  const effectiveState = playerToken && hasFreshState ? state : null;
  const effectiveWsStatus: WebSocketStatus = !playerToken
    ? 'idle'
    : !hasFreshState || wsStatus === 'idle'
      ? 'connecting'
      : wsStatus;
  const effectiveLastError = playerToken && hasFreshState ? lastError : null;

  return {
    state: effectiveState,
    wsStatus: effectiveWsStatus,
    lastError: effectiveLastError,
    requestState: fetchLatestState,
  };
}
