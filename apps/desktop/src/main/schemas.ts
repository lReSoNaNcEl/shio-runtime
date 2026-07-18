import { z } from 'zod'

// ---- Speech backend --------------------------------------------------------
export const HealthSchema = z.object({
  status: z.string(),
  asr: z.object({ status: z.string() }).partial().passthrough().optional(),
  engines: z
    .object({
      f5: z.object({ status: z.string(), mode: z.string() }).partial().passthrough().optional(),
    })
    .partial()
    .passthrough()
    .optional(),
})
export type Health = z.infer<typeof HealthSchema>

export const RecognizeSchema = z.object({
  text: z.string(),
  segments: z
    .array(
      z.object({
        text: z.string(),
        start: z.number(),
        end: z.number(),
        duration: z.number().optional(),
      }),
    )
    .optional(),
  language: z.string().optional(),
  language_probability: z.number().optional(),
})
export type Recognize = z.infer<typeof RecognizeSchema>
