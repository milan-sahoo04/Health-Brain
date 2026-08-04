import { PromptPayload } from "../builders/promptBuilder";
import { LLMReasoningPort, ReasoningResult } from "./llmReasoningPort";

/**
 * M9.7: stub implementation of LLMReasoningPort. Performs NO inference,
 * NO prompt execution, NO parsing, NO reasoning of any kind — exists
 * purely to prove the adapter seam is wired correctly end-to-end.
 *
 * M10 replaces this with a real adapter (e.g. OllamaAdapter) implementing
 * the SAME LLMReasoningPort interface — the GraphRAG pipeline (M9.1-M9.6)
 * requires zero changes when that swap happens.
 */
export class StubLLMAdapter implements LLMReasoningPort {
  async invokeReasoning(prompt: PromptPayload): Promise<ReasoningResult> {
    return {
      status: "not_implemented",
      message: "Reasoning is implemented in M10.",
    };
  }
}
