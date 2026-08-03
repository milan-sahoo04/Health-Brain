import { RetrievalContext, ContextKnowledgeItem } from "./contextBuilder";

export interface PromptPayload {
  systemPrompt: string | null;
  contextPrompt: string | null;
  userQuestion: string;
  estimatedTokenCount: number;
  promptTruncated: boolean; // NEW — true if items were dropped to fit maxPromptTokens
  status: "ok" | "no_relevant_context";
  metadata: {
    patientId: string;
    retrievalVersion: string;
    promptVersion: string;
  };
}

/**
 * M9.6: pluggable token estimator, per the "configurable, not coupled to
 * one model" requirement. Swapping models later means swapping the
 * function passed in, not changing PromptBuilder's logic.
 */
export type TokenEstimator = (text: string) => number;

/**
 * Default estimator: ~4 characters per token, a widely-used rough
 * approximation for English text across most tokenizers (GPT/Llama-
 * family included). This is a DOCUMENTED PLACEHOLDER, not a real
 * tokenizer — there's no established JS tokenizer for Qwen3/Ollama at
 * time of writing. Replace via the estimator parameter once a real one
 * is available for the target model, without touching this file's logic.
 */
export const approximateTokenEstimator: TokenEstimator = (text: string) =>
  Math.ceil(text.length / 4);

const PROMPT_VERSION = "m9.6-v1";
const RETRIEVAL_VERSION = "m9.5-v1";

const BASE_SYSTEM_PROMPT = `You are assisting with a personal health knowledge system. Follow these rules strictly:
- Use only the supplied context below. Do not invent facts.
- State uncertainty explicitly when evidence is insufficient or confidence is low.
- Cite the supporting Knowledge and Evidence IDs for any claim you reference.
- If no relevant context is provided, state that explicitly rather than answering from general knowledge.
- Do not answer questions outside the scope of the provided patient context.`;

/**
 * Renders one ContextKnowledgeItem into the hierarchical text format
 * specified: claim, confidence, supporting sections, supporting evidence,
 * with explicit Knowledge/Evidence ID citations preserved per item.
 */
function formatKnowledgeItem(
  item: ContextKnowledgeItem,
  index: number,
): string {
  const sectionNames = item.sourceSections
    .map((id) => id.split(":").pop() ?? id)
    .map(
      (key) =>
        key.charAt(0).toUpperCase() +
        key
          .slice(1)
          .replace(/([A-Z])/g, " $1")
          .trim(),
    );

  const evidenceLines = item.evidence
    .map(
      (e, i) =>
        `  Evidence ${i + 1} (${e.polarity}, strength ${e.strength.toFixed(2)}):\n    ${e.description}`,
    )
    .join("\n");

  return [
    `Knowledge ${index + 1}`,
    "-".repeat(`Knowledge ${index + 1}`.length),
    `Claim:`,
    `  ${item.claim}`,
    ``,
    `Confidence:`,
    `  ${item.confidence.toFixed(2)} (${item.confidenceTrend})`,
    ``,
    `Supporting Sections:`,
    ...sectionNames.map((n) => `  - ${n}`),
    ``,
    `Supporting Evidence:`,
    evidenceLines,
    ``,
    `Provenance:`,
    `  Knowledge ID: ${item.knowledgeId}`,
    `  Evidence IDs: ${item.provenance.evidenceIds.join(", ")}`,
  ].join("\n");
}

function formatContext(context: RetrievalContext): string {
  const header = `Patient: ${context.patientId}\n`;
  const items = context.rankedKnowledge
    .map((item, i) => formatKnowledgeItem(item, i))
    .join("\n\n");
  return `${header}\n${items}`;
}

/**
 * M9.6: pure transformation, RetrievalContext (M9.5) -> PromptPayload.
 * Never calls an LLM, never generates an answer, never modifies or
 * re-ranks evidence — strictly formatting + budget enforcement.
 *
 * On status "no_relevant_context", short-circuits and returns a null
 * prompt rather than building an empty-context request — prevents M10
 * from ever sending a request with nothing real to ground it, per the
 * explicit hallucination-risk decision.
 */
export function buildPrompt(
  context: RetrievalContext,
  tokenEstimator: TokenEstimator = approximateTokenEstimator,
  maxPromptTokens: number = 4000,
): PromptPayload {
  const baseMetadata = {
    patientId: context.patientId,
    retrievalVersion: RETRIEVAL_VERSION,
    promptVersion: PROMPT_VERSION,
  };

  if (context.status === "no_relevant_context") {
    return {
      status: "no_relevant_context",
      systemPrompt: null,
      contextPrompt: null,
      userQuestion: context.query,
      estimatedTokenCount: 0,
      promptTruncated: false,
      metadata: baseMetadata,
    };
  }

  const systemPrompt = BASE_SYSTEM_PROMPT;
  let contextPrompt = formatContext(context);

  const systemTokens = tokenEstimator(systemPrompt);
  const questionTokens = tokenEstimator(context.query);
  let contextTokens = tokenEstimator(contextPrompt);

  // Prompt-level budget enforcement: if system + context + question
  // exceeds maxPromptTokens, drop lowest-hybridScore Knowledge items
  // from the FORMATTED CONTEXT (not from RetrievalContext itself, which
  // stays immutable — PromptBuilder must never modify retrieved
  // evidence, per the explicit constraint). rankedKnowledge is already
  // sorted descending by hybridScore from M9.4/M9.5, so items are
  // dropped from the end.
  let items = [...context.rankedKnowledge];
  const originalCount = items.length;
  while (
    items.length > 1 &&
    systemTokens + contextTokens + questionTokens > maxPromptTokens
  ) {
    items = items.slice(0, -1);
    contextPrompt = formatContext({ ...context, rankedKnowledge: items });
    contextTokens = tokenEstimator(contextPrompt);
  }
  const promptTruncated = items.length < originalCount;

  const estimatedTokenCount = systemTokens + contextTokens + questionTokens;

  return {
    status: "ok",
    systemPrompt,
    contextPrompt,
    userQuestion: context.query,
    estimatedTokenCount,
    promptTruncated,
    metadata: baseMetadata,
  };
}
