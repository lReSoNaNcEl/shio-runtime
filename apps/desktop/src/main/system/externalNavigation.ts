import { z } from 'zod'

export const externalHttpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        url.hostname.length > 0 &&
        !url.username &&
        !url.password
      )
    } catch {
      return false
    }
  }, 'Only absolute HTTP(S) URLs without embedded credentials are allowed')
  .transform((value) => new URL(value).toString())
