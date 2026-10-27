import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { StructuredModelResponseParser } from '../../../src/main/browser-control/computer-use/StructuredModelResponseParser'

const fixtureSchema = z
  .object({
    type: z.enum(['click', 'wait']),
    observationId: z.string(),
  })
  .strict()

const parser = new StructuredModelResponseParser(fixtureSchema, 'fixture-decision')

describe('StructuredModelResponseParser', () => {
  it('accepts exactly one raw or json-fenced object', () => {
    const expected = { type: 'wait' as const, observationId: 'observation-1' }
    expect(parser.parse(JSON.stringify(expected))).toEqual(expected)
    expect(parser.parse(`\n\`\`\`json\n${JSON.stringify(expected)}\n\`\`\`\n`)).toEqual(expected)
  })

  it('rejects prose extraction and reports bounded Zod diagnostics', () => {
    expect(() =>
      parser.parse('Sure:\n{"type":"wait","observationId":"observation-1"}'),
    ).toThrowError(expect.objectContaining({ code: 'COMPUTER_USE_MODEL_INVALID_RESPONSE' }))

    try {
      parser.parse('{"type":"unknown","observationId":"observation-1"}')
      throw new Error('schema mismatch fixture was accepted')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'COMPUTER_USE_MODEL_SCHEMA_MISMATCH',
        diagnostic: {
          expectedSchema: 'fixture-decision',
          issues: [{ path: ['type'], code: 'invalid_value' }],
        },
      })
      expect(JSON.stringify(error)).not.toContain('unknown')
    }
  })
})
