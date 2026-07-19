export { enMessages } from './en'
export { ruMessages, type TranslationKey } from './ru'

import { enMessages } from './en'
import { ruMessages } from './ru'

export const messages = {
  ru: ruMessages,
  en: enMessages,
} as const
