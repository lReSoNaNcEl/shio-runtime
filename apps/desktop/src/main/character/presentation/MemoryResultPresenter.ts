import type { UiLocale } from '../../../shared/localization'
import type { CharacterToolVerifiedOutcome } from '../../character-tools'

export function memoryLoopFailure(locale: UiLocale): string {
  return locale === 'ru'
    ? '[calm]Не смогла безопасно завершить работу с долговременной памятью. Попробуй сформулировать запрос ещё раз.'
    : '[calm]I could not safely finish the long-term memory operation. Please try phrasing the request again.'
}

export function verifiedToolOutcomeFallback(
  outcome: CharacterToolVerifiedOutcome | undefined,
  locale: UiLocale,
): string | null {
  if (!outcome) return null
  if (locale === 'ru') {
    if (outcome.kind === 'goal.create') {
      return `[calm]Договорились — сохранила «${outcome.title}» среди наших намерений.`
    }
    if (outcome.kind === 'goal.update') {
      if (outcome.status === 'completed') return `[calm]Отметила «${outcome.title}» завершённой.`
      if (outcome.progressPercent !== undefined)
        return `[calm]Обновила измеримый прогресс «${outcome.title}» до ${outcome.progressPercent}%.`
      return `[calm]Обновила нашу договорённость «${outcome.title}».`
    }
    if (outcome.kind === 'memory.store')
      return '[calm]Готово — сохранила это в долговременной памяти.'
    if (outcome.kind === 'memory.update')
      return '[calm]Готово — обновила запись в долговременной памяти.'
    return '[calm]Готово — удалила запись из долговременной памяти.'
  }
  if (outcome.kind === 'goal.create') {
    return `[calm]Agreed — I saved “${outcome.title}” among our intentions.`
  }
  if (outcome.kind === 'goal.update') {
    if (outcome.status === 'completed') return `[calm]I marked “${outcome.title}” complete.`
    if (outcome.progressPercent !== undefined)
      return `[calm]I updated the measurable progress for “${outcome.title}” to ${outcome.progressPercent}%.`
    return `[calm]I updated our intention “${outcome.title}”.`
  }
  if (outcome.kind === 'memory.store') return '[calm]Done — I saved this to long-term memory.'
  if (outcome.kind === 'memory.update') return '[calm]Done — I updated the long-term memory record.'
  return '[calm]Done — I removed the record from long-term memory.'
}
