import { CategoricalItem } from "./categoricalItemExtractor";

const TRANSACTION_WINDOW_DAYS = 3; // items within this many days of each other count as "co-occurring"

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24),
  );
}

/**
 * Clusters a chronological list of categorical items into "transactions" —
 * groups of items that happened close together in time. Uses simple
 * gap-based clustering: walk through items in date order, start a new
 * transaction whenever the gap since the last item exceeds the window.
 *
 * This turns a patient's timeline into the same shape Association Rule
 * Mining expects: a list of "baskets," each containing a set of item names.
 */
export function buildTransactions(items: CategoricalItem[]): string[][] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));

  const transactions: string[][] = [];
  let currentTransaction = new Set<string>();
  let lastDate = sorted[0].date;

  for (const item of sorted) {
    if (
      daysBetween(lastDate, item.date) > TRANSACTION_WINDOW_DAYS &&
      currentTransaction.size > 0
    ) {
      transactions.push(Array.from(currentTransaction));
      currentTransaction = new Set();
    }
    currentTransaction.add(item.item); // Set dedupes repeated items within one window
    lastDate = item.date;
  }

  if (currentTransaction.size > 0) {
    transactions.push(Array.from(currentTransaction));
  }

  return transactions;
}
