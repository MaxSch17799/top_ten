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
      setState(null);
      setWsStatus('idle');
      sinceVersionRef.current = 0;
      stopPolling();
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    sinceVersionRef.current = 0;
    setWsStatus('connecting');
    const ws = new WebSocket(buildWsUrl(gameId, playerToken));
    wsRef.current = ws;
    ws.onopen = () => {
      setWsStatus('open');
      setLastError(null);
      stopPolling();
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
      startPolling();
    };
    ws.onclose = () => {
      setWsStatus((current) => (current === 'open' ? 'closed' : current));
      startPolling();
    };

    void fetchLatestState();
    startPolling();

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      stopPolling();
    };
  }, [gameId, playerToken, fetchLatestState, startPolling, stopPolling]);

  useEffect(() => {
    if (wsStatus === 'open') {
      stopPolling();
    }
  }, [stopPolling, wsStatus]);

  return {
    state,
    wsStatus,
    lastError,
    requestState: fetchLatestState,
  };
}
