const MIN_OCCURRENCE_COUNT = 2; // pair must co-occur at least twice to be worth reporting
const MIN_CONFIDENCE_TO_REPORT = 0.5; // A predicts B at least half the time it appears

export interface AssociationRule {
  itemA: string;
  itemB: string;
  direction: `${string} -> ${string}`; // human-readable, e.g. "Symptoms:Fatigue -> Medication:Metformin"
  support: number; // 0-1, how common the pair is overall
  confidence: number; // 0-1, P(B | A)
  lift: number; // >1 = positive association, ~1 = coincidence, <1 = negative association
  occurrenceCount: number;
  totalTransactions: number;
}

function countSingleItems(transactions: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    for (const item of transaction) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  return counts;
}

function countPairs(transactions: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    // Every unique unordered pair within this one transaction
    for (let i = 0; i < transaction.length; i++) {
      for (let j = i + 1; j < transaction.length; j++) {
        const [a, b] = [transaction[i], transaction[j]].sort();
        const key = `${a}|${b}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Mines all pairwise association rules from a set of transactions.
 * Returns TWO rules per qualifying pair (A -> B and B -> A), since
 * confidence is directional even though support and lift are symmetric.
 */
export function mineAssociationRules(
  transactions: string[][],
): AssociationRule[] {
  if (transactions.length === 0) return [];

  const singleCounts = countSingleItems(transactions);
  const pairCounts = countPairs(transactions);
  const total = transactions.length;

  const rules: AssociationRule[] = [];

  for (const [pairKey, pairCount] of pairCounts.entries()) {
    if (pairCount < MIN_OCCURRENCE_COUNT) continue;

    const [itemA, itemB] = pairKey.split("|");
    const countA = singleCounts.get(itemA) ?? 0;
    const countB = singleCounts.get(itemB) ?? 0;
    if (countA === 0 || countB === 0) continue;

    const support = pairCount / total;
    const lift = support / ((countA / total) * (countB / total));

    // A -> B
    const confidenceAtoB = pairCount / countA;
    if (confidenceAtoB >= MIN_CONFIDENCE_TO_REPORT) {
      rules.push({
        itemA,
        itemB,
        direction: `${itemA} -> ${itemB}`,
        support,
        confidence: confidenceAtoB,
        lift,
        occurrenceCount: pairCount,
        totalTransactions: total,
      });
    }

    // B -> A
    const confidenceBtoA = pairCount / countB;
    if (confidenceBtoA >= MIN_CONFIDENCE_TO_REPORT) {
      rules.push({
        itemA: itemB,
        itemB: itemA,
        direction: `${itemB} -> ${itemA}`,
        support,
        confidence: confidenceBtoA,
        lift,
        occurrenceCount: pairCount,
        totalTransactions: total,
      });
    }
  }

  return rules.sort((a, b) => b.lift - a.lift);
}
