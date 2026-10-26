import type { IPlayer } from "../models/Session";

export function drawingCollaboratorLabel(players: readonly IPlayer[], ownerId: string): string {
  const collaborators = players
    .filter((player) => String(player.userId) !== ownerId)
    .map((player) => player.username.trim())
    .filter(Boolean);

  return collaborators.length > 0 ? collaborators.join(", ") : "Solo";
}
