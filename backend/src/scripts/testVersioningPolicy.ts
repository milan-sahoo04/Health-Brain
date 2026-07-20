import { isSignificantChange } from "../services/knowledge/versioningPolicy";

console.log(
  "Case 1 (absolute, delta 0.20, threshold 0.15):",
  isSignificantChange(0.3, 0.5, { strategy: "absolute", threshold: 0.15 }),
);
console.log(
  "Case 2 (absolute, delta 0.05, threshold 0.15):",
  isSignificantChange(0.3, 0.35, { strategy: "absolute", threshold: 0.15 }),
);
console.log(
  "Case 3 (relative, ~66.7% change, threshold 50%):",
  isSignificantChange(0.3, 0.5, { strategy: "relative", threshold: 0.5 }),
);
console.log(
  "Case 4 (relative, zero-division guard):",
  isSignificantChange(0, 0.1, { strategy: "relative", threshold: 0.5 }),
);
