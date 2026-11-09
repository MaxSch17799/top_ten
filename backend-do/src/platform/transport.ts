import { RoomCommitError } from './persistence.js';

export type RoomClients = Map<string, Set<WebSocket>>;

/** The modern room protocol. Top 10 retains its separate legacy response headers. */
export function roomJson(request: Request, data: unknown, status = 200): Response {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Player-Token,X-Host-Token',
    },
  });
}

/** Project separately for every identity, including the read-only display. */
export function broadcastViews(clients: RoomClients, project: (id: string) => unknown, allowed = (_id: string) => true) {
  for (const [id, sockets] of clients) {
    if (!allowed(id)) {
      for (const socket of sockets) socket.close(1008, 'Removed from lobby');
      clients.delete(id);
      continue;
    }
    const message = JSON.stringify({ type: 'STATE', payload: project(id) });
    for (const socket of sockets) {
      try { socket.send(message); }
      catch { try { socket.close(); } catch { /* already closed */ } }
    }
  }
}

/** Keep membership separate from game-specific presence/deadline changes. */
export function addSocket(clients: RoomClients, id: string, socket: WebSocket): Set<WebSocket> {
  const sockets = clients.get(id) ?? new Set<WebSocket>();
  if (sockets.size >= 3) {
    const oldest = sockets.values().next().value!;
    sockets.delete(oldest);
    oldest.close(1000, 'Replaced');
  }
  sockets.add(socket);
  clients.set(id, sockets);
  return sockets;
}

/** A late close from an invalidated connection must not disconnect its replacement. */
export function removeSocket(clients: RoomClients, id: string, sockets: Set<WebSocket>, socket: WebSocket): boolean {
  if (clients.get(id) !== sockets) return false;
  sockets.delete(socket);
  return true;
}

/** Presence writes need the same recovery as HTTP writes, even after a socket closes. */
export function runSocketMutation(ctx: DurableObjectState, operation: () => Promise<void>, invalidate: () => void) {
  ctx.waitUntil(ctx.blockConcurrencyWhile(async () => {
    try { await operation(); }
    catch (error) {
      if (error instanceof RoomCommitError) invalidate();
      else throw error;
    }
  }).catch(error => { console.error('Socket presence update failed', error); }));
}
