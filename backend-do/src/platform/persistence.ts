/** A command's room value and next alarm form one durable commit. */
export class RoomCommitError extends Error {
  constructor(cause: unknown) {
    super('Could not confirm the action. Reconnect or retry the same action.', { cause });
    this.name = 'RoomCommitError';
  }
}

export async function commitRoom(storage: DurableObjectStorage, key: string, state: unknown, alarm: number | null): Promise<void> {
  try {
    const snapshot = structuredClone(state);
    await storage.transaction(async transaction => {
      await transaction.put(key, snapshot);
      if (alarm === null) await transaction.deleteAlarm();
      else await transaction.setAlarm(alarm);
    });
  } catch (cause) {
    throw new RoomCommitError(cause);
  }
}

export function reconnectClients(clients: Map<string, Set<WebSocket>>) {
  const sockets = [...clients.values()].flatMap(group => [...group]);
  for (const group of clients.values()) group.clear();
  clients.clear();
  for (const socket of sockets) {
    try { socket.close(1011, 'Reconnect to confirm game state'); } catch { /* already disconnected */ }
  }
}
