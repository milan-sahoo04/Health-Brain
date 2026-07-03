import { useRef, useState } from "react";
import { bulkImportEvents, type BulkImportResult } from "../../lib/api";

interface BulkImportProps {
  onImported?: () => void;
}

export function BulkImport({ onImported }: BulkImportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  async function processFile(file: File) {
    setError(null);
    setResult(null);
    setFileName(file.name);
    setLoading(true);

    try {
      const text = await file.text();
      let parsed: unknown;

      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("File is not valid JSON.");
      }

      if (!Array.isArray(parsed)) {
        throw new Error(
          "JSON file must contain an array of events, e.g. [{...}, {...}]",
        );
      }

      const importResult = await bulkImportEvents(parsed);
      setResult(importResult);
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  return (
    <div className="border border-[#E4E1D8] rounded-lg p-5 bg-white shadow-sm space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border border-dashed rounded-md px-4 py-6 text-center cursor-pointer transition-colors ${
          dragActive
            ? "border-[#3F7D58] bg-[#3F7D58]/5"
            : "border-[#D8D4C8] hover:border-[#B8B3A3] bg-[#FAFAF7]"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
          disabled={loading}
          className="hidden"
        />
        <p className="text-sm text-[#1B2430] font-medium">
          {loading
            ? "Importing…"
            : fileName
              ? fileName
              : "Drop a JSON file here, or click to choose"}
        </p>
        <p className="text-[11px] text-[#8A8577] mt-1">
          Array of event objects — patientId, type, date, plus any fields
        </p>
      </div>

      {error && <p className="text-sm text-[#B3492F]">{error}</p>}

      {result && (
        <div className="text-sm border-t border-[#E4E1D8] pt-3">
          <p className="font-medium text-[#1B2430] flex items-center gap-2">
            <span
              className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ color: "#3F7D58", backgroundColor: "#3F7D5820" }}
            >
              {result.createdCount} created
            </span>
            {result.failedCount > 0 && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-full"
                style={{ color: "#B3492F", backgroundColor: "#B3492F1A" }}
              >
                {result.failedCount} failed
              </span>
            )}
          </p>
          {result.failedCount > 0 && (
            <ul className="mt-2 space-y-1">
              {result.results
                .filter((r) => r.status === "failed")
                .map((r) => (
                  <li key={r.index} className="text-xs text-[#B3492F]">
                    Item {r.index}: {r.error}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
