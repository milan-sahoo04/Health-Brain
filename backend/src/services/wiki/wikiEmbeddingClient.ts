const VECTOR_SERVICE_URL =
  process.env.VECTOR_SERVICE_URL ?? "http://localhost:8003";

export interface EmbedSectionResult {
  sectionId: string;
  status: "embedded" | "skipped_unchanged";
  vectorId?: string;
  embeddingVersion?: string;
}

export async function embedSection(
  sectionId: string,
  content: string,
  checksum: string,
  patientId: string,
  sectionKey: string,
  title: string,
): Promise<EmbedSectionResult> {
  const res = await fetch(`${VECTOR_SERVICE_URL}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sectionId,
      content,
      checksum,
      patientId,
      sectionKey,
      title,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Vector service error (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as EmbedSectionResult;
}
