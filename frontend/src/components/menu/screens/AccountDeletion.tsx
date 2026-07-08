// frontend/src/components/menu/screens/AccountDeletion.tsx
import { useState } from "react";
import { deletePatient } from "../../../lib/api";

export function AccountDeletion({ patientId }: { patientId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    try {
      await deletePatient(patientId);
      setDeleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account");
    }
  }

  if (deleted) {
    return <p className="text-sm text-slate-600 px-3 py-4">Account deleted.</p>;
  }

  if (!confirming) {
    return (
      <div className="px-3 py-4">
        <p className="text-sm text-slate-600 mb-3">
          This permanently deletes patient <strong>{patientId}</strong> and
          every event logged for them. This cannot be undone.
        </p>
        <button
          onClick={() => setConfirming(true)}
          className="text-sm font-medium text-red-600 hover:text-red-700"
        >
          Delete my account
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-4 space-y-2">
      <p className="text-sm text-slate-600">
        Type <strong>{patientId}</strong> to confirm permanent deletion.
      </p>
      <input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleDelete}
          disabled={confirmText !== patientId}
          className="bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium px-3 py-1.5 rounded-md"
        >
          Permanently delete
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-slate-500 hover:text-slate-700 text-sm px-3 py-1.5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
