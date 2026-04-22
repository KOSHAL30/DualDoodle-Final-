# Dual Doodle

A real-time collaborative drawing web app where two people share a split canvas and draw together live.

## Stack
- **Frontend** (`artifacts/dual-doodle`): React + Vite + TypeScript + Tailwind, wouter for routing, socket.io-client.
- **Backend** (`artifacts/api-server`): Express + Socket.io + Mongoose (MongoDB Atlas). JWT auth with bcrypt password hashing. Rate limited.
- **Database**: MongoDB Atlas (URI in `MONGODB_URI` secret).

## Key features
- Email/password signup + login (JWT in localStorage).
- Dashboard: create a session (6-char code) or join one. Saved drawings gallery with download/delete.
- Room: split-screen canvas — creator draws on the left half, joiner on the right.
  - Tools: pen, brush, eraser, line, rectangle, circle, triangle, flood fill.
  - Color palette + custom color picker, brush size 1–48px.
  - Undo (own last stroke), upload reference image (synced + 30% overlay), invite link copy.
  - Save: combined PNG to user history + auto-download.
  - End session button closes the room for both users.
- Real-time stroke sync via Socket.io with progress throttling. Strokes persist in MongoDB so a refresh rehydrates the canvas.

## Routing
The frontend lives at `/` (Dual Doodle artifact). The API + websocket lives at `/api/*` and `/socket.io` on the api-server artifact.

## Important files
- `artifacts/api-server/src/index.ts` — boots Mongo + HTTP + Socket.io.
- `artifacts/api-server/src/lib/socket.ts` — real-time draw handlers.
- `artifacts/api-server/src/routes/{auth,sessions}.ts` — REST endpoints.
- `artifacts/api-server/src/models/{User,Session,Drawing}.ts` — Mongoose schemas.
- `artifacts/dual-doodle/src/pages/Room.tsx` — main canvas + tools.
- `artifacts/dual-doodle/src/lib/{api,auth-context,socket}.ts` — client plumbing.

## Required secrets
- `MONGODB_URI` — Atlas connection string with database name `dualdoodle`.
- `JWT_SECRET` — secret used to sign auth tokens.
- `SESSION_SECRET` — reserved.
