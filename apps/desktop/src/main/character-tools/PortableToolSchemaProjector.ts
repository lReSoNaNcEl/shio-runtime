import type { ProviderSchemaCapabilities } from '../../shared/llm'

/**
 * Projects canonical Zod Draft 7 output to the conservative JSON Schema subset
 * shared by the supported OpenAI-compatible function-call endpoints. Runtime Zod
 * parsing remains the authoritative validation boundary.
 */
const SIMPLE_TYPES = new Set(['object', 'array', 'integer', 'number', 'string', 'boolean'])

export class PortableToolSchemaProjector {
  project(
    schema: Record<string, unknown>,
    capabilities: ProviderSchemaCapabilities = { oneOf: true },
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
    if (alternatives?.length) {
      const projectedAlternatives = alternatives.flatMap((value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? [this.projectNode(value as Record<string, unknown>, capabilities)]
          : [],
      )
      if (capabilities.oneOf !== false) projected.oneOf = projectedAlternatives
      else this.mergePortableAlternatives(projected, projectedAlternatives)
    }
    return projected
  }

  private mergePortableAlternatives(
    target: Record<string, unknown>,
    alternatives: readonly Record<string, unknown>[],
  ): void {
    if (alternatives.length === 0) return
    const types = [...new Set(alternatives.map(({ type }) => type).filter(Boolean))]
    if (!target.type && types.length === 1 && typeof types[0] === 'string') target.type = types[0]

    const requiredSets = alternatives.map(({ required }) =>
      Array.isArray(required)
        ? required.filter((value): value is string => typeof value === 'string')
        : [],
    )
    const required = requiredSets[0]?.filter((key) =>
      requiredSets.slice(1).every((keys) => keys.includes(key)),
    )
    if (!target.required && required?.length) target.required = required

    const propertyMaps = alternatives.map(({ properties }) =>
      properties && typeof properties === 'object' && !Array.isArray(properties)
        ? (properties as Record<string, unknown>)
        : {},
    )
    const propertyKeys = [...new Set(propertyMaps.flatMap((properties) => Object.keys(properties)))]
    const fallbackProperties = Object.fromEntries(
      propertyKeys.map((key) => [
        key,
        this.mergePortableProperty(propertyMaps.flatMap((properties) => properties[key] ?? [])),
      ]),
    )
    if (propertyKeys.length > 0) {
      const existing =
        target.properties &&
        typeof target.properties === 'object' &&
        !Array.isArray(target.properties)
          ? (target.properties as Record<string, unknown>)
          : {}
      target.properties = { ...fallbackProperties, ...existing }
    }

    if (
      target.additionalProperties === undefined &&
      alternatives.every(({ additionalProperties }) => additionalProperties === false)
    ) {
      target.additionalProperties = false
    }
  }

  private mergePortableProperty(values: readonly unknown[]): Record<string, unknown> {
    const records = values.filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value),
    )
    if (records.length === 0) return {}
    if (records.length === 1 || records.every((value) => this.sameSchema(value, records[0]))) {
      return { ...records[0] }
    }
    const enumerated = records.flatMap((value) =>
      'const' in value ? [value.const] : Array.isArray(value.enum) ? value.enum : [],
    )
    if (enumerated.length === records.length) return { enum: [...new Set(enumerated)] }
    return {}
  }

  private sameSchema(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
    return JSON.stringify(left) === JSON.stringify(right)
  }
}
