/**
 * Configurable, not hardcoded — per the approved M6.3 architecture. The
 * strategy itself is swappable, not just the threshold number, since
 * "absolute vs relative" is a genuinely open question until real
 * multi-version data exists to evaluate against (M6's own architecture
 * review, Section 1, Decision 1).
 */
export type VersioningStrategy = "absolute" | "relative";

export interface VersioningPolicy {
  strategy: VersioningStrategy;
  threshold: number;
}

/**
 * Default policy — a starting point, not a finalized business rule.
 * Absolute strategy chosen as the default only because it's simpler to
 * reason about with the small amount of real version data we'll have
 * initially; NOT a claim that absolute is architecturally superior.
 */
export const DEFAULT_VERSIONING_POLICY: VersioningPolicy = {
  strategy: "absolute",
  threshold: 0.15,
};

/**
 * Pure function — testable in isolation, no I/O. Both strategies live
 * here so swapping which one is active is a config change, not a
 * call-site change anywhere else in the codebase.
 */
export function isSignificantChange(
  oldConfidence: number,
  newConfidence: number,
  policy: VersioningPolicy,
): { significant: boolean; delta: number } {
  const absoluteDelta = Math.abs(newConfidence - oldConfidence);

  if (policy.strategy === "absolute") {
    return {
      significant: absoluteDelta >= policy.threshold,
      delta: absoluteDelta,
    };
  }

  // relative strategy: delta as a fraction of the OLD confidence.
  // Guards against divide-by-zero when oldConfidence is 0 — treated as
  // "always significant" in that edge case, since any nonzero new
  // confidence is an infinite relative change from zero.
  if (oldConfidence === 0) {
    return { significant: newConfidence !== 0, delta: absoluteDelta };
  }
  const relativeDelta = absoluteDelta / oldConfidence;
  return {
    significant: relativeDelta >= policy.threshold,
    delta: relativeDelta,
  };
}
