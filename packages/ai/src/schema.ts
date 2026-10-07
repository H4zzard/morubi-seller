import { z } from 'zod';
import { strategyTypes } from '@morubi/intelligence';

export const generationOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    guidance: z.string().trim().min(1).max(280),
    suggestedQuestion: z.string().trim().min(1).max(240).nullable(),
    warning: z.string().trim().min(1).max(180).nullable(),
    rationale: z.string().trim().min(1).max(240),
    tone: z.enum(['DIRECT', 'CONSULTATIVE', 'EMPATHETIC']),
    strategy: z.enum(strategyTypes)
  })
  .strict();

export const deepSeekChatResponseSchema = z.object({
  model: z.string().min(1),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable(),
        message: z.object({ content: z.string().nullable() })
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative()
    })
    .optional()
});
