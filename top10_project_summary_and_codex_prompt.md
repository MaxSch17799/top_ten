# Top 10 (party game) — project summary + Codex build prompt

## 1) Project summary (what you want)

You want a **retro-styled web app (PWA)** that runs on **iOS + Android + PC** and is shareable via a **link + QR code**.

### Game idea (Top 10)
- Up to **10 total players** per session (host included).
- Each round:
  - Exactly **one “round host”** (rotates each round).
  - Every player gets a **unique secret number from 1–10** (even if fewer than 10 players, you still draw from 1–10).
  - The round host gets **3 candidate prompts/questions** from a selected question bank.
  - The round host reads one prompt out loud; everyone answers according to their secret number; the host guesses ordering IRL.
- **Only the session host has controls**: start round 1, next round, add player, end game.
- **Lobby is open link**: anyone with the URL/QR can join until full.
- Players must enter a **nickname (max 20 chars)**.
- The host sees a list like: `2) Max`, `3) Dave`, … and can **reorder player order only before Round 1** (including moving themselves).
- **Refresh/reopen should not kick players**: they should come back as the same nickname/slot automatically.
- **Leaving is not a thing**:
  - After Round 1 starts, slots stay reserved (if someone disappears, the host can keep going or start a new game).
  - Host can still **Add player** (if <10), but new players join as **“pending”** and become active **starting next round**.
- Game ends if host presses **End game**, or if host is disconnected for **>10 minutes** after the game has started.

### Platforms + hosting
- Frontend hosted on **Cloudflare Pages** (static build).
- Backend kept lightweight using **Cloudflare Workers + Durable Objects** (per-game state) and **WebSockets** for low-request realtime updates.
  - Workers/Pages Functions share the **100k requests/day** free quota for server-side requests; static Pages requests don’t count.  
  - Durable Objects are the recommended coordination point for multiplayer + WebSockets.

## 2) Implementation plan (high level)

### Why WebSockets (request budget)
Polling every 5 seconds with 10 players becomes thousands of requests/hour. WebSockets keep it closer to:
- 1 request to connect per client (upgrade),
- then realtime messages travel over that connection without extra HTTP requests.

You can still implement **polling as a fallback** (every 5s) if WebSocket fails.

### Split of responsibility
**Frontend does:**
- All UI, retro styling, PWA installability.
- Loads question bank JSON files (static).
- Generates and shows QR codes (join links).
- Stores player token locally for refresh/rejoin.

**Backend does (minimum necessary):**
- Create games, track players, nicknames, ordering.
- Enforce max 10 players.
- Maintain state machine: lobby → active → ended.
- Per-round: pick round host (from host-defined order), deal unique numbers 1–10, pick 3 questions (send question IDs), and store chosen prompt (optional).
- Handle reconnect (player token resumes same slot).
- Handle pending players + “activate on next round”.
- Enforce host-only controls + host disconnect timeout.

## 3) State machine (server truth)

### Game phases
- `LOBBY` (round = 0): joining allowed, reorder allowed.
- `ACTIVE` (round >= 1): joining allowed only if <10; new joiners become `PENDING` until next round.
- `ENDED`: show “Game ended”.

### Round logic
- round host index = `order[(round - 1) % activePlayerCount]` where `order` is the host-defined ordering list (player IDs).
- On round start:
  - shuffle numbers [1..10], assign first N unique to players in `ACTIVE` status (exclude pending until next round).
  - choose 3 prompts (IDs) from bank for that round host.
  - optionally store “selectedPromptId” once host picks one.

### Disconnect rules
- Every player has `lastSeenTs`.
- Host has `hostLastSeenTs`.
- If phase is ACTIVE and `now - hostLastSeenTs > 10 minutes` ⇒ auto END.

## 4) Data model (Durable Object storage)

Suggested DO schema (in memory + persisted):
- `gameId: string`
- `seed: string`
- `questionBankId: string`
- `phase: "LOBBY" | "ACTIVE" | "ENDED"`
- `createdAt, updatedAt: number`
- `round: number`
- `players: Record<playerId, {`
  - `playerId: string`
  - `nickname: string`
  - `role: "HOST" | "PLAYER"`
  - `status: "ACTIVE" | "PENDING"`
  - `joinedAt: number`
  - `lastSeenAt: number`
  - `connected: boolean`
  - `roundNumber?: number` (secret number assigned this round)
  - `seatLabel?: number` (only for display: 1..10 based on current order list)
`}>`
- `order: string[]` (playerIds in host-defined order; host can reorder only in LOBBY)
- `pendingJoinQueue: string[]` (optional; or rely on status field)
- `roundHostPlayerId: string | null`
- `roundAssignments: Record<playerId, number>` (secret numbers this round)
- `roundPromptsByRound: Record<number, { hostPlayerId: string, promptIds: string[], chosenPromptId?: string }>`
- `version: number` (increment on any state change for polling diff)

## 5) API + WebSocket protocol (minimal)

### Auth model
- Host gets `hostToken`.
- Each player gets `playerToken`.
- Tokens are random strings stored in DO.
- Frontend stores token in `localStorage` to reattach after refresh.

### HTTP endpoints (Pages Functions or Worker router)
- `POST /api/game/create`
  - body: `{ hostNickname, seed?, questionBankId }`
  - returns: `{ gameId, hostToken, joinUrl }`
- `POST /api/game/:gameId/join`
  - body: `{ nickname }`
  - returns: `{ playerId, playerToken, role }` or `{ error:"FULL" }`
  - if phase ACTIVE and round>=1: player joins as `PENDING`
- `POST /api/game/:gameId/reorder` (host only, LOBBY only)
  - body: `{ hostToken, order: playerId[] }`
- `POST /api/game/:gameId/startRound1` (host only)
- `POST /api/game/:gameId/nextRound` (host only)
- `POST /api/game/:gameId/end` (host only)

#### Poll fallback (optional)
- `GET /api/game/:gameId/state?token=...&sinceVersion=...`
  - returns `{ version, state, yourRole, yourSecretNumber, roundHost, lobbyList... }`

### WebSocket endpoint
- `GET /api/game/:gameId/ws?token=...` (upgrade)
- Server pushes events:
  - `STATE` (full state snapshot you’re allowed to see)
  - `LOBBY_UPDATE`
  - `ROUND_START` (includes your secret number; host gets prompt IDs)
  - `ROUND_META` (e.g., chosen prompt ID)
  - `GAME_ENDED`
- Client messages:
  - `PING` (keepalive / lastSeen)
  - `HOST_CHOOSE_PROMPT` (host only, optional)
  - `HOST_ACTION` (start/next/end) (or keep as HTTP posts only)

## 6) Frontend UI screens (routes)

- `/` Landing
  - buttons: **Host Game**, **Join Game**
- `/host`
  - host nickname (max 20)
  - seed (optional, random button)
  - question bank dropdown
  - Start → shows QR for join URL and “Go to lobby”
- `/g/:gameId`
  - if no token: prompt nickname entry (max 20) and Join
  - Lobby view:
    - Players see: waiting screen
    - Host sees:
      - join QR, player list, drag reorder (LOBBY only), “Start Round 1”
      - top menu: Add player (QR), End game
  - Game view:
    - everyone sees giant number + round number
    - host sees giant number + “Next Round” button + top menu

Retro style:
- pixel font (Press Start 2P style), dark background, neon accents, thick borders, scanline/CRT subtle animation, chunky buttons.

## 7) Cloudflare deployment strategy (recommended)

Important Cloudflare constraint:
- You **cannot create/deploy** the Durable Object *from within* a Pages project; you create a separate DO Worker and then bind it to the Pages project.

Two good setups:

### Setup A (simple + same domain): Pages + Pages Functions (API) + separate DO Worker
- Frontend: Cloudflare Pages
- API: Pages Functions at `/api/*`
- DO: separate Worker that defines the DO class; Pages project binds to its DO namespace.

### Setup B (simplest code): Frontend on Pages, backend on `workers.dev`
- Backend Worker (router + DO) served via `yourname.workers.dev`
- Frontend calls it with CORS.
- Join QR still points to Pages; frontend knows backend base URL.

(For your use case, **Setup A** is nicest for “one link”.)

---

# 3) Copy-paste prompt for Codex (build the full project)

> Paste everything below into Codex as-is.

## Codex prompt

You are building a complete, deployable Cloudflare project for a retro-styled “Top 10” party game web app (PWA) with lightweight backend.
Output must include:
1) A repo folder tree
2) Full code for every file (grouped by file path with fenced code blocks)
3) Step-by-step deployment instructions for Cloudflare Pages + Durable Objects + optional WebSocket fallback.

### Hard requirements
- Works on iOS Safari, Android Chrome, and desktop browsers.
- “Host game” flow:
  - Host enters nickname (<=20 chars)
  - Optional seed (blank ⇒ random)
  - Select question bank (start with one bank file)
  - Create game ⇒ show join URL + QR code
- “Join game” flow:
  - Open join link or scan QR
  - Enter nickname (<=20 chars)
  - Join lobby if capacity <10 else show “Game is full”
- Lobby:
  - Open link joining (no approval)
  - Host sees list like `1) HostNick`, `2) Max`, … (seat labels derived from current order list)
  - Host can drag/drop reorder ONLY before round 1 (in lobby). Host can move themselves.
  - Only host has controls: start round 1 / next round / add player / end game
- Game:
  - Up to 10 players total
  - Every round deals unique secret numbers from 1..10 to active players (even if players <10)
  - Round host rotates by host-defined player order: round 1 => order[0], round 2 => order[1], ...
  - Round host gets 3 question options each round (IDs), can optionally pick one to “lock” it
  - Other players only see their secret number (big)
  - Host sees their secret number + controls at bottom, plus a top menu
- Add player mid-game:
  - Host can show QR for the same join link
  - If joined while round>=1, player becomes `PENDING` and becomes ACTIVE at the next round change
- Refresh/reconnect:
  - Page refresh should not create a new slot; use localStorage token to reattach
- Leaving:
  - No “leave game” button
  - After round 1 starts, slots remain reserved; if someone disappears, game continues; host can add players if <10
- End game:
  - Host can end at any time
  - If host disconnected for >10 minutes after the game started => game auto-ends
- UI:
  - Retro style: pixel font, dark background, neon accents, chunky buttons
  - Mobile-first layout; large text for the number display

### Performance / request budget
- Prefer WebSockets (1 connection per client) for realtime updates; minimal HTTP calls.
- Provide a polling fallback every 5s if WebSocket fails.
- Do NOT spam requests; batch state updates; include a `version` number to support `sinceVersion`.

### Tech choices (use these)
- Frontend: React + Vite + TypeScript, deploy to Cloudflare Pages, PWA manifest + service worker (simple).
- QR generation: frontend-only (e.g., `qrcode` npm package).
- Backend: Cloudflare Workers + Durable Objects (one DO per gameId).
  - Use WebSocket hibernation API in DO if possible.
  - Persist state in DO storage.
- The question bank must be static JSON files in the frontend (public folder), and the backend should only send question IDs (or indices), not full text.

### Repo structure (required)
Create a mono-repo with:
- `/frontend` (Vite React app)
- `/backend-do` (Durable Object Worker that defines the DO class and namespace)
- Optionally `/pages-functions` or a documented way to serve API routes under the Pages project:
  - If you implement API inside the Pages project, place them in `/frontend/functions/api/...`
  - If you implement API as a worker on workers.dev, configure CORS and document the backend URL env var.

### Backend behavior (detailed)
- On create:
  - generate `gameId` short (like 6–8 chars)
  - generate `hostToken` random
  - create host player entry immediately (HOST)
  - set phase LOBBY, round 0
  - order list starts with host first
- Join:
  - reject if 10 total players already (including pending)
  - create playerId + playerToken, status ACTIVE if round==0 else PENDING
  - append player to order list at end (host can reorder only while round==0)
- Reorder:
  - host-only, only while round==0
  - validate order contains exactly current playerIds once each
- Start round 1:
  - host-only
  - set round=1, phase ACTIVE
  - call `dealRound()`
- Next round:
  - host-only
  - increment round
  - promote all PENDING players to ACTIVE
  - call `dealRound()`
- dealRound():
  - choose `roundHostPlayerId = order[(round-1) % activeCount]` (activeCount excludes pending)
  - shuffle [1..10], assign first N to ACTIVE players (N=activeCount)
  - choose 3 prompts deterministically based on seed + round + bankId (to survive reconnect), but random enough:
    - Load bank on frontend; backend should only send 3 prompt IDs from the bank list (you may keep a promptId list in backend by caching it once from a static list or embed it in DO config as generated indices).
    - Store the 3 prompt IDs in state per round so reconnecting host sees the same 3.
  - broadcast ROUND_START event to all connections.
- Host disconnect timeout:
  - Track host `lastSeenAt` (update on WS message or poll)
  - If ACTIVE and host lastSeen > 10min: set ENDED and broadcast GAME_ENDED.
  - Implement periodic alarm or check on each request/message.
- Security:
  - Tokens required for privileged actions.
  - Never send other players’ secret numbers to non-host clients.
  - Host may see player list, but not secret numbers of others.

### Frontend behavior (detailed)
- Store `gameId` + `token` + `playerId` in localStorage.
- On load `/g/:gameId`:
  - If token exists, try to connect with it.
  - Else prompt nickname and join.
- Show host vs player UI based on role returned by server.
- Lobby:
  - Host list includes seat label `index+1` in the current order.
  - Drag/drop reorder (react-beautiful-dnd or dnd-kit) only shown while round==0.
- Round screen:
  - Everyone sees their secret number in giant font.
  - Host also sees:
    - 3 prompts (by fetching `/question-banks/<id>.json` and matching prompt IDs)
    - “Next Round” button at bottom
    - top-right menu: Add player (shows QR), End game
- Add player:
  - show join QR (same URL).
- PWA:
  - manifest + icons (placeholders ok)
  - service worker caching of static assets and question bank JSON

### Provide a starter question bank
Create `frontend/public/question-banks/classic_v1.json` with at least 20 prompts, structure:
```json
{
  "id": "classic_v1",
  "name": "Classic",
  "version": 1,
  "questions": [
    { "id": "q001", "prompt": "..." }
  ]
}
```

### Deployment instructions you must include
- How to deploy frontend to Cloudflare Pages (build settings, output dir).
- How to deploy Durable Object worker with wrangler.
- How to bind the DO namespace to the Pages project (or how to configure the frontend with backend URL if using workers.dev).
- How to set environment variables/secrets needed (like BACKEND_URL).
- How to verify: create game, join with 2 phones, start round, next round, refresh a player, add a new player mid-game.

### Output format required
- Start with a folder tree
- Then for each file: a heading with the file path and a fenced code block with its contents
- Keep code complete and runnable without missing pieces.

(End of prompt.)

