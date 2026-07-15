export type EvidenceType =
  | "temporal_alignment"
  | "confounder"
  | "graph_structural";
export type EvidencePolarity = "supporting" | "contradicting";

export interface Evidence {
  id: string;
  patientId: string;
  evidenceType: EvidenceType;
  description: string;
  sourceEventIds: string[];
  sourceNodeIds: string[];
  sourceRelationshipIds: string[];
  polarity: EvidencePolarity;
  weight: number; // 0-1, this item's contribution weight
  strength: number; // magnitude of the observed effect
  recency: number; // 0-1, same decay convention as correlationEngine.ts
  frequency: number; // 0-1, normalized occurrence count
  consistency: number; // 0-1, direction-agreement ratio
  confidenceContribution: number; // placeholder here — finalized by ConfidenceScorer in M5.3
  createdAt: string;
}
