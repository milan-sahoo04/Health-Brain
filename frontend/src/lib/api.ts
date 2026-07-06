import type { HealthEvent } from "./types";

const API_BASE = "http://localhost:4000";

export async function createEvent(event: HealthEvent) {
  const res = await fetch(`${API_BASE}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(
      errorBody.error || `Request failed with status ${res.status}`,
    );
  }

  return res.json();
}

export async function getPatientEvents(patientId: string) {
  const res = await fetch(`${API_BASE}/events/${patientId}`);

  if (!res.ok) {
    throw new Error(`Failed to fetch events for ${patientId}`);
  }

  return res.json() as Promise<{
    patientId: string;
    count: number;
    events: HealthEvent[];
  }>;
}

export interface GraphNode {
  id: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

export async function getPatientGraph(patientId: string) {
  const res = await fetch(`${API_BASE}/events/${patientId}/graph`);
  if (!res.ok) {
    throw new Error(`Failed to fetch graph for ${patientId}`);
  }
  return res.json() as Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
}

export interface Patient {
  id: string;
  eventCount: number;
}

export async function getPatients() {
  const res = await fetch(`${API_BASE}/patients`);
  if (!res.ok) throw new Error("Failed to fetch patients");
  return res.json() as Promise<{ patients: Patient[] }>;
}

export async function createPatient(id: string) {
  const res = await fetch(`${API_BASE}/patients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to create patient");
  }
  return res.json() as Promise<{ id: string }>;
}

export async function deleteEvent(patientId: string, eventId: string) {
  const res = await fetch(`${API_BASE}/events/${patientId}/${eventId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to delete event");
  }
  return res.json();
}

export async function updateEvent(
  patientId: string,
  eventId: string,
  event: HealthEvent,
) {
  const res = await fetch(`${API_BASE}/events/${patientId}/${eventId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to update event");
  }
  return res.json();
}

export interface BulkImportResult {
  message: string;
  createdCount: number;
  failedCount: number;
  results: { index: number; status: "created" | "failed"; error?: string }[];
}

export async function bulkImportEvents(events: unknown[]) {
  const res = await fetch(`${API_BASE}/events/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(events),
  });

  const body = await res.json();

  if (!res.ok && res.status !== 207) {
    throw new Error(body.error || "Bulk import failed");
  }

  return body as BulkImportResult;
}

export interface ImportBatch {
  batchId: string;
  eventCount: number;
  patientIds: string[];
  importedAt: string;
}

export async function getImportBatches() {
  const res = await fetch(`${API_BASE}/events/batches`);
  if (!res.ok) throw new Error("Failed to fetch import batches");
  return res.json() as Promise<{ batches: ImportBatch[] }>;
}

export async function deleteImportBatch(batchId: string) {
  const res = await fetch(`${API_BASE}/events/batch/${batchId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to delete batch");
  }
  return res.json() as Promise<{ message: string; deletedCount: number }>;
}

export async function renamePatient(id: string, newId: string) {
  const res = await fetch(`${API_BASE}/patients/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to rename patient");
  }
  return res.json() as Promise<{ id: string }>;
}

export async function deletePatient(id: string) {
  const res = await fetch(`${API_BASE}/patients/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to delete patient");
  }
  return res.json() as Promise<{ message: string }>;
}

export interface DistinctValues {
  eventTypes: string[];
  fieldNames: string[];
}

export async function getDistinctValues() {
  const res = await fetch(`${API_BASE}/events/distinct`);
  if (!res.ok) throw new Error("Failed to fetch distinct values");
  return res.json() as Promise<DistinctValues>;
}
