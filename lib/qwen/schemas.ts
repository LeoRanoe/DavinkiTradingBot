import { z } from "zod";

/**
 * Structured Qwen output. Every note is tagged so the UI and downstream
 * logic can distinguish a stated fact from an interpretation - market
 * numbers must always come from deterministic code, never from the model,
 * so FACT notes here are expected to restate/summarize inputs we already
 * computed, not introduce new numbers.
 */
export const qwenNoteSchema = z.object({
  kind: z.enum(["FACT", "INTERPRETATION", "EDUCATIONAL_NOTE", "RISK"]),
  text: z.string().min(1).max(600),
});

export const qwenSignalExplanationSchema = z.object({
  summary: z.string().min(1).max(400),
  notes: z.array(qwenNoteSchema).min(1).max(8),
  lesson: z.string().min(1).max(400).optional(),
});

export const qwenTradeReviewSchema = z.object({
  summary: z.string().min(1).max(400),
  observations: z.array(z.string().min(1).max(400)).max(6),
  hypotheses: z.array(z.string().min(1).max(400)).max(4),
  confidence: z.number().min(0).max(1),
  dataLimitations: z.array(z.string().min(1).max(300)).max(6),
});

export type QwenNote = z.infer<typeof qwenNoteSchema>;
export type QwenSignalExplanation = z.infer<typeof qwenSignalExplanationSchema>;
export type QwenTradeReview = z.infer<typeof qwenTradeReviewSchema>;
