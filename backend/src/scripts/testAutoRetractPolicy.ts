import {
  evaluateAutoRetract,
  DEFAULT_AUTO_RETRACT_POLICY,
} from "../services/knowledge/autoRetractDetection";

const enabledPolicy = { ...DEFAULT_AUTO_RETRACT_POLICY, enabled: true };

// Case 1: disabled by default -> never fires, even on a clear decline
console.log(
  "Case 1 (disabled by default):",
  evaluateAutoRetract(
    [
      { versionNumber: 1, confidence: 0.6 },
      { versionNumber: 2, confidence: 0.3 },
      { versionNumber: 3, confidence: 0.1 },
    ],
    DEFAULT_AUTO_RETRACT_POLICY,
  ),
);

// Case 2: enabled, genuine sustained decline below floor -> SHOULD fire
console.log(
  "Case 2 (enabled, sustained decline below floor):",
  evaluateAutoRetract(
    [
      { versionNumber: 1, confidence: 0.6 },
      { versionNumber: 2, confidence: 0.3 },
      { versionNumber: 3, confidence: 0.1 },
    ],
    enabledPolicy,
  ),
);

// Case 3: enabled, declining but NOT below floor -> should NOT fire
console.log(
  "Case 3 (enabled, declining but above floor):",
  evaluateAutoRetract(
    [
      { versionNumber: 1, confidence: 0.8 },
      { versionNumber: 2, confidence: 0.6 },
      { versionNumber: 3, confidence: 0.4 },
    ],
    enabledPolicy,
  ),
);

// Case 4: enabled, below floor but NOT consecutively declining (one uptick) -> should NOT fire
console.log(
  "Case 4 (enabled, below floor but not consistently declining):",
  evaluateAutoRetract(
    [
      { versionNumber: 1, confidence: 0.3 },
      { versionNumber: 2, confidence: 0.05 },
      { versionNumber: 3, confidence: 0.1 },
    ],
    enabledPolicy,
  ),
);

// Case 5: enabled, not enough version history yet -> should NOT fire
console.log(
  "Case 5 (enabled, insufficient history):",
  evaluateAutoRetract(
    [
      { versionNumber: 1, confidence: 0.6 },
      { versionNumber: 2, confidence: 0.1 },
    ],
    enabledPolicy,
  ),
);
