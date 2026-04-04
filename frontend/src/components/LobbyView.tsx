import { useEffect, useMemo, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import QRCode from 'qrcode';
import type { PlayerSummary, SerializedStateForPlayer } from '../lib/types';

interface LobbyViewProps {
  state: SerializedStateForPlayer;
  joinUrl: string;
  onStartRound: () => Promise<void>;
  onReorder: (order: string[]) => Promise<void>;
  onOpenInvite: () => void;
  actionError?: string | null;
  warningActive?: boolean;
  warningLabel?: string | null;
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
      {...attributes}
      {...listeners}
      className={`player-row sortable ${player.status === 'PENDING' ? 'pending' : ''} ${isDragging ? 'dragging' : ''}`}
    >
      <span className="drag-handle" aria-hidden>
        =
      </span>
      <span className="seat-label">{player.seatLabel ? `${player.seatLabel})` : '-'}</span>
      <span className="nickname">
        {player.nickname}
        {player.role === 'HOST' && <span className="host-tag"> (Host)</span>}
      </span>
    </div>
  );
}

function PlayerRow({ player }: { player: PlayerSummary }) {
  return (
    <div className={`player-row simple ${player.status === 'PENDING' ? 'pending' : ''}`}>
      <span className="seat-label">{player.seatLabel ? `${player.seatLabel})` : '-'}</span>
      <span className="nickname">
        {player.nickname}
        {player.role === 'HOST' && <span className="host-tag"> (Host)</span>}
      </span>
    </div>
  );
}

function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export default function LobbyView({
  state,
  joinUrl,
  onStartRound,
  onReorder,
  onOpenInvite,
  actionError,
  warningActive,
  warningLabel,
}: LobbyViewProps) {
  const [localOrder, setLocalOrder] = useState<string[]>(state.order);
  const [qr, setQr] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const isHost = state.yourRole === 'HOST';
  const reorderEnabled = isHost && state.phase === 'LOBBY';

  useEffect(() => {
    if (!isHost || !joinUrl) {
      return;
    }
    void QRCode.toDataURL(joinUrl, {
      margin: 1,
      color: { dark: '#39ff14', light: '#07070f' },
    }).then(setQr);
  }, [isHost, joinUrl]);

  const displayOrder = sameOrder(localOrder, state.order) ? localOrder : state.order;

  const orderedPlayers = useMemo(() => {
    return displayOrder
      .map((playerId) => state.players.find((player) => player.playerId === playerId))
      .filter((player): player is PlayerSummary => Boolean(player));
  }, [displayOrder, state.players]);

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!reorderEnabled) {
      return;
    }
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const oldIndex = displayOrder.indexOf(active.id as string);
    const newIndex = displayOrder.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }
    const nextOrder = arrayMove(displayOrder, oldIndex, newIndex);
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
          {!isHost && (
            <button className="ghost" onClick={onOpenInvite}>
              Add player
            </button>
          )}
        </div>
      </header>
      {isHost && (
        <div className="card invite-inline">
          <h3>Invite players</h3>
          {qr && <img src={qr} alt="Join link QR code" className="qr" />}
          <p className="footnote">Game code: {state.gameId}</p>
          <div className="invite-link">
            <input readOnly value={joinUrl} />
          </div>
        </div>
      )}
      <div className="card">
        {warningActive && warningLabel && <p className="warning-banner">{warningLabel}</p>}
        {reorderEnabled ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={displayOrder} strategy={verticalListSortingStrategy}>
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
          <p>Players: {state.activeCount} / {state.maxPlayers}</p>
          {state.pendingCount > 0 && <p className="footnote">{state.pendingCount} pending player(s) will join next round.</p>}
        </div>
        {actionError && <p className="error">{actionError}</p>}
        {isHost && (
          <div className="button-row">
            <button className="primary" onClick={onStartRound}>
              Start Round 1
            </button>
          </div>
        )}
      </div>
    </section>
  );
}



