import { z } from 'zod'

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

export const GroqModelsResponseSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        capabilities: z
          .object({
            vision: z.boolean().optional(),
            reasoning: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
        architecture: z
          .object({
            input_modalities: z.array(z.string()).optional(),
            modality: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  ),
})

export const CerebrasModelsResponseSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        name: z.string().optional(),
        capabilities: z
          .object({
            vision: z.boolean().optional(),
            reasoning: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  ),
})

export const GithubModelsResponseSchema = z.array(
  z
    .object({
      id: z.string(),
      name: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
      supported_input_modalities: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    })
    .passthrough(),
)

export const OpenRouterModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    context_length: z.number().optional(),
    architecture: z
      .object({
        input_modalities: z.array(z.string()).optional(),
        output_modalities: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    supported_parameters: z.array(z.string()).optional(),
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

export const MistralModelSchema = z
  .object({
    id: z.string(),
    object: z.string().optional(),
    created: z.number().optional(),
    owned_by: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    capabilities: z
      .object({
        vision: z.boolean().optional(),
        reasoning: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    architecture: z
      .object({
        input_modalities: z.array(z.string()).optional(),
        modality: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export const MistralModelsResponseSchema = z
  .object({
    object: z.string().optional(),
    data: z.array(MistralModelSchema),
  })
  .passthrough()
