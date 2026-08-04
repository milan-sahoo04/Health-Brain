import { PromptPayload } from "../builders/promptBuilder";

/**
 * M9.7: the integration CONTRACT between M9 (retrieval) and M10
 * (reasoning). This interface defines what any future LLM adapter must
 * implement — M9 defines the shape, M10 provides the real implementation.
 *
 * M9 NEVER calls a real LLM. This boundary exists specifically so
 * swapping StubLLMAdapter for a real OllamaAdapter (or any other
 * provider) is a dependency-injection change, not a pipeline change.
 */
export interface ReasoningResult {
  status: "ok" | "not_implemented" | "error";
  message: string;
  // Deliberately no "answer" field here — M9 must never define, imply,
  // or shape what a real answer would look like. That contract belongs
  // to M10, which will extend or replace ReasoningResult as needed once
  // real reasoning is designed.
}

export interface LLMReasoningPort {
  invokeReasoning(prompt: PromptPayload): Promise<ReasoningResult>;
}
