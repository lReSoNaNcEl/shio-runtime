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

// ---- LLM chat (OpenAI-compatible: Groq, Cerebras, GitHub Models, OpenRouter, Mistral)
// Intentionally lenient: content may be null/absent (reasoning-only turns,
// tool calls, or error envelopes). We validate *shape* here and enforce the
// "non-empty string content" business rule in parseChatCompletion(), so a bad
// response surfaces as a readable Runtime error instead of a raw Zod crash.
// Some providers (e.g. Mistral's Magistral reasoning models) return
// `message.content` not as a plain string but as an array of typed content
// parts - a chain-of-thought "thinking" block plus a "text" block. Accepting
// both shapes here keeps this a shared protocol concern instead of a
// per-provider hack; parseChatCompletion() flattens either shape uniformly.
const ContentPartSchema = z
  .object({
    type: z.string().optional(),
    text: z.string().optional(),
  })
  .passthrough()

export const ChatCompletionSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullish(),
            message: z
              .object({
                role: z.string().optional(),
                content: z.union([z.string(), z.array(ContentPartSchema)]).nullish(),
                // Reasoning models expose their chain-of-thought separately.
                reasoning: z.string().nullish(),
                reasoning_content: z.string().nullish(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .passthrough()
      .nullish(),
    error: z.unknown().optional(),
  })
  .passthrough()
export type ChatCompletion = z.infer<typeof ChatCompletionSchema>

// ---- LLM model catalogs -----------------------------------------------------
// Groq exposes an OpenAI-compatible `/models` endpoint: { data: [{ id, ... }] }
export const GroqModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() }).passthrough()),
})
export type GroqModelsResponse = z.infer<typeof GroqModelsResponseSchema>

// Cerebras: GET https://api.cerebras.ai/public/v1/models -> { data: [{ id, ... }] }
export const CerebrasModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() }).passthrough()),
})
export type CerebrasModelsResponse = z.infer<typeof CerebrasModelsResponseSchema>

// GitHub Models catalog: GET https://models.github.ai/catalog/models
// -> [{ id, name, ... }]
export const GithubModelsResponseSchema = z.array(
  z
    .object({
      id: z.string(),
      name: z.string().optional(),
    })
    .passthrough(),
)
export type GithubModelsResponse = z.infer<typeof GithubModelsResponseSchema>

// OpenRouter: GET https://openrouter.ai/api/v1/models -> { data: [ ... ] }
export const OpenRouterModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    context_length: z.number().optional(),
    pricing: z
      .object({
        prompt: z.string().optional(),
        completion: z.string().optional(),
        image: z.string().optional(),
        request: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
export type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>

export const OpenRouterModelsResponseSchema = z.object({
  data: z.array(OpenRouterModelSchema),
})
export type OpenRouterModelsResponse = z.infer<typeof OpenRouterModelsResponseSchema>

// Mistral: GET https://api.mistral.ai/v1/models -> { data: [{ id, ... }] }
export const MistralModelSchema = z
  .object({
    id: z.string(),
    object: z.string().optional(),
    created: z.number().optional(),
    owned_by: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough()
export type MistralModel = z.infer<typeof MistralModelSchema>

export const MistralModelsResponseSchema = z
  .object({
    object: z.string().optional(),
    data: z.array(MistralModelSchema),
  })
  .passthrough()
export type MistralModelsResponse = z.infer<typeof MistralModelsResponseSchema>
