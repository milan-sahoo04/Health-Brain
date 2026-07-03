import { useEffect, useState } from "react";
import {
  getPatients,
  createPatient,
  renamePatient,
  deletePatient,
  type Patient,
} from "../../lib/api";

interface PatientSidebarProps {
  selectedPatientId: string | null;
  onSelect: (patientId: string) => void;
  refreshSignal: number;
}

export function PatientSidebar({
  selectedPatientId,
  onSelect,
  refreshSignal,
}: PatientSidebarProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPatientId, setNewPatientId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function loadPatients() {
    setLoading(true);
    try {
      const data = await getPatients();
      setPatients(data.patients);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load patients");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPatients();
  }, [refreshSignal]);

  async function handleAddPatient(e: React.FormEvent) {
    e.preventDefault();
    if (!newPatientId.trim()) return;

    setCreating(true);
    setError(null);
    try {
      const { id } = await createPatient(newPatientId.trim());
      setNewPatientId("");
      await loadPatients();
      onSelect(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create patient");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(p: Patient) {
    setEditingId(p.id);
    setEditValue(p.id);
    setConfirmDeleteId(null);
  }

  async function handleSaveEdit(originalId: string) {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === originalId) {
      setEditingId(null);
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const { id } = await renamePatient(originalId, trimmed);
      setEditingId(null);
      await loadPatients();
      if (selectedPatientId === originalId) onSelect(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename patient");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await deletePatient(id);
      setConfirmDeleteId(null);
      await loadPatients();
      if (selectedPatientId === id) onSelect("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete patient");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <aside className="w-72 bg-[#10151F] h-screen flex flex-col text-[#DCE0E8]">
      <div className="p-5 border-b border-white/10">
        <h1 className="font-serif text-xl tracking-tight text-white">
          Health Brain
        </h1>
        <p className="text-[11px] uppercase tracking-widest text-[#6B7280] mt-1">
          Patient Chart Index
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {loading && (
          <p className="text-xs text-[#6B7280] px-3 py-2">Loading…</p>
        )}

        {!loading && patients.length === 0 && (
          <p className="text-xs text-[#6B7280] px-3 py-2">No patients yet.</p>
        )}

        {patients.map((p) => {
          const isSelected = selectedPatientId === p.id;
          const isEditing = editingId === p.id;
          const isConfirmingDelete = confirmDeleteId === p.id;

          return (
            <div
              key={p.id}
              className={`group rounded-md border-l-2 transition-colors ${
                isSelected
                  ? "bg-white/6 border-[#5FA37B]"
                  : "border-transparent hover:bg-white/3"
              }`}
            >
              {isEditing ? (
                <div className="px-3 py-2 space-y-1.5">
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit(p.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="w-full bg-[#0A0D14] border border-white/15 rounded px-2 py-1 text-sm font-mono text-white focus:outline-none focus:border-[#5FA37B]"
                  />
                  <div className="flex gap-2 text-xs">
                    <button
                      onClick={() => handleSaveEdit(p.id)}
                      disabled={savingEdit}
                      className="text-[#5FA37B] hover:text-[#7FC69B] font-medium disabled:opacity-50"
                    >
                      {savingEdit ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-[#6B7280] hover:text-[#9CA3AF]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between px-3 py-2">
                  <button
                    onClick={() => onSelect(p.id)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div
                      className={`font-mono text-sm truncate ${
                        isSelected ? "text-white font-medium" : "text-[#C5CAD4]"
                      }`}
                    >
                      {p.id}
                    </div>
                    <div className="text-[11px] text-[#6B7280]">
                      {p.eventCount} event{p.eventCount === 1 ? "" : "s"}
                    </div>
                  </button>

                  {isConfirmingDelete ? (
                    <div className="flex items-center gap-1.5 text-[11px] shrink-0">
                      <button
                        onClick={() => handleDelete(p.id)}
                        disabled={deletingId === p.id}
                        className="text-[#D97757] hover:text-[#E89478] font-medium disabled:opacity-50"
                      >
                        {deletingId === p.id ? "…" : "Confirm"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[#6B7280] hover:text-[#9CA3AF]"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                      <button
                        onClick={() => startEdit(p)}
                        title="Rename patient"
                        className="text-[11px] text-[#C97B3D] hover:text-[#DB9958]"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(p.id)}
                        title="Delete patient"
                        className="text-[11px] text-[#B3492F] hover:text-[#CC5A3D]"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form
        onSubmit={handleAddPatient}
        className="p-3 border-t border-white/10 space-y-2"
      >
        <input
          value={newPatientId}
          onChange={(e) => setNewPatientId(e.target.value)}
          placeholder="New patient ID"
          className="w-full bg-[#0A0D14] border border-white/15 rounded-md px-3 py-1.5 text-sm font-mono text-white placeholder:text-[#4B5563] focus:outline-none focus:border-[#5FA37B]"
        />
        {error && <p className="text-xs text-[#E89478]">{error}</p>}
        <button
          type="submit"
          disabled={creating}
          className="w-full bg-[#3F7D58] hover:bg-[#4A9268] disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-md transition-colors"
        >
          {creating ? "Adding…" : "+ Add Patient"}
        </button>
      </form>
    </aside>
  );
}
