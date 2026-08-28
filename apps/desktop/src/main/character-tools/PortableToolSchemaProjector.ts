/**
 * Projects canonical Zod Draft 7 output to the conservative JSON Schema subset
 * shared by the supported OpenAI-compatible function-call endpoints. Runtime Zod
 * parsing remains the authoritative validation boundary.
 */
export interface ProviderSchemaCapabilities {
  oneOf?: boolean
}

const SIMPLE_TYPES = new Set(['object', 'array', 'integer', 'number', 'string', 'boolean'])

export class PortableToolSchemaProjector {
  project(
    schema: Record<string, unknown>,
    capabilities: ProviderSchemaCapabilities = {},
  ): Record<string, unknown> {
    return this.projectNode(schema, capabilities)
  }

  private projectNode(
    source: Record<string, unknown>,
    capabilities: ProviderSchemaCapabilities,
  ): Record<string, unknown> {
    const projected: Record<string, unknown> = {}
    if (typeof source.type === 'string' && SIMPLE_TYPES.has(source.type)) {
      projected.type = source.type
    }
    if ('const' in source) projected.const = source.const
    if (Array.isArray(source.enum)) projected.enum = [...source.enum]
    if (typeof source.minimum === 'number') projected.minimum = source.minimum
    if (typeof source.maximum === 'number') projected.maximum = source.maximum
    if (typeof source.additionalProperties === 'boolean') {
      projected.additionalProperties = source.additionalProperties
    }
    if (Array.isArray(source.required)) {
      projected.required = source.required.filter(
        (value): value is string => typeof value === 'string',
      )
    }
    if (
      source.properties &&
      typeof source.properties === 'object' &&
      !Array.isArray(source.properties)
    ) {
      projected.properties = Object.fromEntries(
        Object.entries(source.properties as Record<string, unknown>).flatMap(([key, value]) =>
          value && typeof value === 'object' && !Array.isArray(value)
            ? [[key, this.projectNode(value as Record<string, unknown>, capabilities)]]
            : [],
        ),
      )
    }
    if (source.items && typeof source.items === 'object' && !Array.isArray(source.items)) {
      projected.items = this.projectNode(source.items as Record<string, unknown>, capabilities)
    }
    const alternatives = Array.isArray(source.oneOf)
      ? source.oneOf
      : Array.isArray(source.anyOf)
        ? source.anyOf
        : undefined
    if (alternatives?.length && capabilities.oneOf !== false) {
      projected.oneOf = alternatives.flatMap((value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? [this.projectNode(value as Record<string, unknown>, capabilities)]
          : [],
      )
    }
    return projected
  }
}
