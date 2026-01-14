import { useEffect, useMemo, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PlayerSummary, SerializedStateForPlayer } from '../lib/types';

interface LobbyViewProps {
  state: SerializedStateForPlayer;
  onStartRound: () => Promise<void>;
  onEndGame: () => Promise<void>;
  onReorder: (order: string[]) => Promise<void>;
  onOpenInvite: () => void;
  actionError?: string | null;
}

function SortablePlayerRow({ player }: { player: PlayerSummary }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: player.playerId,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`player-row ${player.status === 'PENDING' ? 'pending' : ''} ${isDragging ? 'dragging' : ''}`}
    >
      <span className="drag-handle" {...attributes} {...listeners} aria-hidden>
        =
      </span>
      <span className="seat-label">{player.seatLabel ? `${player.seatLabel})` : '—'}</span>
      <span className="nickname">
        {player.nickname}
        {player.role === 'HOST' ? ' (Host)' : ''}
      </span>
      <span className="status-label">{player.status === 'PENDING' ? 'pending' : 'active'}</span>
    </div>
  );
}

function PlayerRow({ player }: { player: PlayerSummary }) {
  return (
    <div className={`player-row ${player.status === 'PENDING' ? 'pending' : ''}`}>
      <span className="drag-handle" aria-hidden>
        •
      </span>
      <span className="seat-label">{player.seatLabel ? `${player.seatLabel})` : '—'}</span>
      <span className="nickname">
        {player.nickname}
        {player.role === 'HOST' ? ' (Host)' : ''}
      </span>
      <span className="status-label">{player.status === 'PENDING' ? 'pending' : 'active'}</span>
    </div>
  );
}

export default function LobbyView({ state, onStartRound, onEndGame, onReorder, onOpenInvite, actionError }: LobbyViewProps) {
  const [localOrder, setLocalOrder] = useState<string[]>(state.order);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const isHost = state.yourRole === 'HOST';
  const reorderEnabled = isHost && state.phase === 'LOBBY';

  useEffect(() => {
    setLocalOrder(state.order);
  }, [state.order]);

  const orderedPlayers = useMemo(() => {
    return localOrder
      .map((playerId) => state.players.find((player) => player.playerId === playerId))
      .filter((player): player is PlayerSummary => Boolean(player));
  }, [localOrder, state.players]);

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!reorderEnabled) {
      return;
    }
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const oldIndex = localOrder.indexOf(active.id as string);
    const newIndex = localOrder.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }
    const nextOrder = arrayMove(localOrder, oldIndex, newIndex);
    setLocalOrder(nextOrder);
    await onReorder(nextOrder);
  };

  return (
    <section className="game-view">
      <header className="game-header">
        <div>
          <p className="eyebrow">Lobby</p>
          <h2>Seat order</h2>
        </div>
        <div className="button-row">
          <button className="ghost" onClick={onOpenInvite}>
            Add player
          </button>
          {isHost && (
            <button className="primary" onClick={onStartRound}>
              Start Round 1
            </button>
          )}
        </div>
      </header>
      <div className="card">
        {reorderEnabled ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={localOrder} strategy={verticalListSortingStrategy}>
              {orderedPlayers.map((player) => (
                <SortablePlayerRow key={player.playerId} player={player} />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          <div className="player-stack">
            {orderedPlayers.map((player) => (
              <PlayerRow key={player.playerId} player={player} />
            ))}
          </div>
        )}
        <div className="lobby-meta">
          <p>
            Active players: {state.activeCount} / {state.maxPlayers}
          </p>
          {state.pendingCount > 0 && <p className="footnote">{state.pendingCount} pending player(s) will join next round.</p>}
        </div>
        {actionError && <p className="error">{actionError}</p>}
        {isHost && (
          <div className="button-row">
            <button className="secondary" onClick={onOpenInvite}>
              Add player
            </button>
            <button className="ghost" onClick={onEndGame}>
              End game
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
