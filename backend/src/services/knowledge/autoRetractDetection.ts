export interface AutoRetractPolicy {
  enabled: boolean;
  minConsecutiveDeclines: number;
  safetyFloor: number; // well below the 0.5 accept threshold — this only fires on genuine collapse
}

/**
 * M6.5.d: pure function, no I/O — same testability discipline as
 * isSignificantChange (M6.3.a). Takes a version history (oldest to
 * newest, matching /history's own ordering) and decides whether
 * sustained decline justifies auto-retraction.
 *
 * DISABLED BY DEFAULT (enabled: false) — per the architecture review,
 * this exists and is tested but does not fire in production until
 * explicitly turned on after observing real confidence trends over time.
 */
export const DEFAULT_AUTO_RETRACT_POLICY: AutoRetractPolicy = {
  enabled: false,
  minConsecutiveDeclines: 3,
  safetyFloor: 0.15,
};

export interface AutoRetractDecision {
  shouldRetract: boolean;
  reason: string | null;
}

export function evaluateAutoRetract(
  versions: { versionNumber: number; confidence: number }[],
  policy: AutoRetractPolicy = DEFAULT_AUTO_RETRACT_POLICY,
): AutoRetractDecision {
  if (!policy.enabled) {
    return { shouldRetract: false, reason: null };
  }
  if (versions.length < policy.minConsecutiveDeclines) {
    return { shouldRetract: false, reason: null };
  }

  const sorted = [...versions].sort(
    (a, b) => a.versionNumber - b.versionNumber,
  );
  const recent = sorted.slice(-policy.minConsecutiveDeclines);

  let consecutivelyDeclining = true;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].confidence >= recent[i - 1].confidence) {
      consecutivelyDeclining = false;
      break;
    }
  }

  const latestConfidence = recent[recent.length - 1].confidence;
  const belowFloor = latestConfidence < policy.safetyFloor;

  if (consecutivelyDeclining && belowFloor) {
    return {
      shouldRetract: true,
      reason: `Auto-retracted: confidence declined across ${policy.minConsecutiveDeclines} consecutive versions, reaching ${latestConfidence.toFixed(3)} (below safety floor ${policy.safetyFloor}).`,
    };
  }
  return { shouldRetract: false, reason: null };
}
