/**
 * Neo4j's driver returns integer-valued properties as {low, high} Integer
 * objects, not plain JS numbers, when they exceed the safe-integer range
 * handling threshold for certain driver configs — we saw this concretely
 * with k.versionCount in M7.2's retrieval output. This normalizes either
 * shape to a plain number, safe to call on values that are already plain
 * numbers too.
 */
export function toNumberSafe(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof (value as any).toNumber === "function")
    return (value as any).toNumber();
  return Number(value);
}
