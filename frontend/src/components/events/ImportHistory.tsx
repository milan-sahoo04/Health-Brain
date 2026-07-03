import { useEffect, useState } from "react";
import {
  getImportBatches,
  deleteImportBatch,
  type ImportBatch,
} from "../../lib/api";

interface ImportHistoryProps {
  refreshSignal: number;
  onBatchDeleted?: () => void;
}

export function ImportHistory({
  refreshSignal,
  onBatchDeleted,
}: ImportHistoryProps) {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getImportBatches();
      setBatches(data.batches);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load import history",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [refreshSignal]);

  async function handleDelete(batchId: string) {
    setDeletingId(batchId);
    try {
      await deleteImportBatch(batchId);
      setBatches((prev) => prev.filter((b) => b.batchId !== batchId));
      setConfirmId(null);
      onBatchDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete batch");
    } finally {
      setDeletingId(null);
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleString();
  }

  if (loading)
    return <p className="text-sm text-[#8A8577]">Loading import history…</p>;
  if (error) return <p className="text-sm text-[#B3492F]">Error: {error}</p>;
  if (batches.length === 0)
    return <p className="text-sm text-[#8A8577]">No imports yet.</p>;

  return (
    <ul className="space-y-2">
      {batches.map((batch) => {
        const isConfirming = confirmId === batch.batchId;
        return (
          <li
            key={batch.batchId}
            className="border-l-2 border-[#6B7280] rounded-r-lg bg-white shadow-sm px-4 py-3 flex justify-between items-center gap-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#1B2430]">
                <span className="font-mono">{batch.eventCount}</span> events →{" "}
                <span className="font-mono">{batch.patientIds.join(", ")}</span>
              </p>
              <p className="text-[11px] text-[#8A8577] mt-0.5">
                {formatTime(batch.importedAt)}
              </p>
            </div>

            {isConfirming ? (
              <div className="flex items-center gap-2 text-xs shrink-0">
                <span className="text-[#8A8577]">Undo import?</span>
                <button
                  onClick={() => handleDelete(batch.batchId)}
                  disabled={deletingId === batch.batchId}
                  className="text-[#B3492F] hover:text-[#CC5A3D] font-medium disabled:opacity-50"
                >
                  {deletingId === batch.batchId ? "…" : "Confirm"}
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  className="text-[#6B7280] hover:text-[#9CA3AF]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmId(batch.batchId)}
                className="text-xs text-[#B3492F] hover:text-[#CC5A3D] font-medium shrink-0"
              >
                Undo Import
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
