import { Session } from "neo4j-driver";
import { retrieveCandidates } from "./retrievers/vectorRetriever";
import { expandFromSections } from "./graph/graphTraverser";
import { rankKnowledge } from "./ranking/hybridRanker";
import {
  buildRetrievalContext,
  RetrievalContext,
} from "./builders/contextBuilder";
import { buildPrompt, PromptPayload } from "./builders/promptBuilder";
import { LLMReasoningPort, ReasoningResult } from "./llm/llmReasoningPort";
import { StubLLMAdapter } from "./llm/stubLLMAdapter";

export interface GraphRAGRetrieveResult {
  patientId: string;
  question: string;
  context: RetrievalContext;
  prompt: PromptPayload;
  reasoning: ReasoningResult;
}

export interface GraphRAGOrchestratorOptions {
  topK?: number;
  contextCharacterBudget?: number;
  maxPromptTokens?: number;
  llmAdapter?: LLMReasoningPort; // dependency injection point for M10
}

/**
 * M9.7: wires M9.2-M9.6 into ONE production entrypoint. This is the
 * official retrieval pipeline — replaces the hand-chained debug routes
 * used to validate each stage individually (M9.2-M9.6).
 *
 * llmAdapter defaults to StubLLMAdapter, per the M9/M10 boundary — M10
 * injects a real adapter (e.g. new OllamaAdapter()) via
 * GraphRAGOrchestratorOptions.llmAdapter, with ZERO changes required
 * here or anywhere upstream in the pipeline.
 */
export async function runGraphRAGRetrieval(
  session: Session,
  patientId: string,
  question: string,
  options: GraphRAGOrchestratorOptions = {},
): Promise<GraphRAGRetrieveResult> {
  const {
    topK,
    contextCharacterBudget,
    maxPromptTokens,
    llmAdapter = new StubLLMAdapter(),
  } = options;

  const startTime = Date.now();

  const hits = await retrieveCandidates(question, patientId, topK);
  const sectionIds = hits.map((h) => h.sectionId);
  const retrieved = await expandFromSections(session, patientId, sectionIds);
  const ranked = rankKnowledge(retrieved, hits);
  const retrievalTimeMs = Date.now() - startTime;

  const context = buildRetrievalContext(
    question,
    patientId,
    ranked,
    hits,
    retrieved.length,
    retrievalTimeMs,
    contextCharacterBudget,
  );

  const prompt = buildPrompt(context, undefined, maxPromptTokens);
  const reasoning = await llmAdapter.invokeReasoning(prompt);

  return {
    patientId,
    question,
    context,
    prompt,
    reasoning,
  };
}
