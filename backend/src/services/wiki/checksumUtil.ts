import { createHash } from "crypto";

export function computeChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
