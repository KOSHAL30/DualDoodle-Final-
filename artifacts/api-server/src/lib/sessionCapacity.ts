export const ALLOWED_CAPACITIES = [2, 3, 4] as const;
export type SessionCapacity = (typeof ALLOWED_CAPACITIES)[number];

export function parseRequestedCapacity(value: unknown): SessionCapacity | null {
  if (value === undefined || value === null || value === "") return 2;
  const n = typeof value === "string" ? Number(value) : value;
  if (n === 2 || n === 3 || n === 4) return n;
  return null;
}

/** Safe default for stored/legacy documents. Invalid values become 2. */
export function normalizeMaxPlayers(value: unknown): SessionCapacity {
  if (value === 2 || value === 3 || value === 4) return value;
  if (value === "2" || value === "3" || value === "4") {
    return Number(value) as SessionCapacity;
  }
  return 2;
}

export function capacityExpr() {
  return {
    $cond: {
      if: { $in: [{ $ifNull: ["$maxPlayers", 2] }, [2, 3, 4]] },
      then: { $ifNull: ["$maxPlayers", 2] },
      else: 2,
    },
  };
}
