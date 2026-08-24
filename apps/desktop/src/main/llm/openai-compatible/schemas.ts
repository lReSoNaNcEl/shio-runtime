import { z } from 'zod'

const ContentPartSchema = z
  .object({
    type: z.string().optional(),
    text: z.string().optional(),
  })
  .passthrough()

const ToolCallSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    type: z.literal('function').optional(),
    function: z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(/^[A-Za-z0-9_.-]+$/),
        arguments: z.string().max(20_000),
      })
      .strict(),
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
                tool_calls: z.array(ToolCallSchema).max(16).nullish(),
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
            tool_calling: z.boolean().optional(),
            function_calling: z.boolean().optional(),
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

export const CloudflareModelsResponseSchema = z
  .object({
    success: z.boolean(),
    errors: z.array(z.unknown()).optional(),
    messages: z.array(z.unknown()).optional(),
    result: z.array(
      z
        .object({
          id: z.string().optional(),
          source: z.union([z.number(), z.string()]).optional(),
          name: z.string(),
          description: z.string().optional(),
          task: z
            .object({
              id: z.string().optional(),
              name: z.string(),
              description: z.string().optional(),
            })
            .passthrough(),
          properties: z
            .array(
              z
                .object({
                  property_id: z.string(),
                  value: z.unknown(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    ),
    result_info: z
      .object({
        count: z.number().int().nonnegative().optional(),
        page: z.number().int().positive().optional(),
        per_page: z.number().int().positive().optional(),
        total_count: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

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
        tool_calling: z.boolean().optional(),
        function_calling: z.boolean().optional(),
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
