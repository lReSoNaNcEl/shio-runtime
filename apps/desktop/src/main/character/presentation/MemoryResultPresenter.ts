import type { UiLocale } from '../../../shared/localization'
import type { CharacterToolVerifiedOutcome } from '../../character-tools'

type BrowserUseOutcome = Extract<
  CharacterToolVerifiedOutcome,
  { kind: `browser.use${string}` | 'browser.use' }
>

function isBrowserUseOutcome(outcome: CharacterToolVerifiedOutcome): outcome is BrowserUseOutcome {
  return outcome.kind.startsWith('browser.use')
}

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
  if (isBrowserUseOutcome(outcome)) return presentBrowserUseOutcome(outcome, locale)
  if (outcome.kind === 'thread.open') {
    return locale === 'ru'
      ? `[calm]Хорошо, оставлю тему «${outcome.topic}» открытой ненадолго.`
      : `[calm]Okay, I will keep “${outcome.topic}” open for a while.`
  }
  if (outcome.kind === 'thread.resolve') {
    return locale === 'ru'
      ? `[calm]Закрыла короткую тему «${outcome.topic}».`
      : `[calm]I closed the short-lived thread “${outcome.topic}”.`
  }
  if (locale === 'ru') {
    if (outcome.kind === 'goal.create') {
      return `[calm]Договорились — сохранила «${outcome.title}» среди наших намерений.`
    }
    if (outcome.kind === 'goal.update') {
      if (outcome.status === 'completed') return `[calm]Отметила «${outcome.title}» завершённой.`
      if (outcome.progressPercent !== undefined) {
        return `[calm]Обновила измеримый прогресс «${outcome.title}» до ${outcome.progressPercent}%.`
      }
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
    if (outcome.progressPercent !== undefined) {
      return `[calm]I updated the measurable progress for “${outcome.title}” to ${outcome.progressPercent}%.`
    }
    return `[calm]I updated our intention “${outcome.title}”.`
  }
  if (outcome.kind === 'memory.store') return '[calm]Done — I saved this to long-term memory.'
  if (outcome.kind === 'memory.update') return '[calm]Done — I updated the long-term memory record.'
  return '[calm]Done — I removed the record from long-term memory.'
}

function presentBrowserUseOutcome(outcome: BrowserUseOutcome, locale: UiLocale): string {
  if (outcome.outcome !== 'success') {
    if (locale === 'ru') {
      if (outcome.outcome === 'permission-denied')
        return '[calm]Сессия управления браузером не была разрешена.'
      if (outcome.outcome === 'cancelled')
        return '[calm]Управление браузером отменено, все удерживаемые клавиши и кнопки отпущены.'
      return `[calm]Не удалось безопасно выполнить управление браузером${outcome.errorCode ? `: ${outcome.errorCode}` : '.'}`
    }
    if (outcome.outcome === 'permission-denied')
      return '[calm]The browser control session was not authorized.'
    if (outcome.outcome === 'cancelled')
      return '[calm]Browser control was cancelled and all held inputs were released.'
    return `[calm]I could not safely complete browser control${outcome.errorCode ? `: ${outcome.errorCode}` : '.'}`
  }
  if (locale === 'ru') {
    if (outcome.state === 'waiting-user')
      return '[calm]Сессия браузера сохранена и ждёт твоего вмешательства.'
    if (outcome.kind === 'browser.usePause') return '[calm]Поставила управление браузером на паузу.'
    if (outcome.kind === 'browser.useResume') return '[calm]Продолжаю работу в браузере.'
    if (outcome.kind === 'browser.useStop') return '[calm]Остановила управление браузером.'
    if (outcome.kind === 'browser.use') return '[calm]Сессия управления браузером запущена.'
    return `[calm]Состояние управления браузером: «${outcome.state ?? 'нет активной сессии'}».`
  }
  if (outcome.state === 'waiting-user')
    return '[calm]The browser session is retained and waiting for your intervention.'
  if (outcome.kind === 'browser.usePause') return '[calm]I paused browser control.'
  if (outcome.kind === 'browser.useResume') return '[calm]I am continuing the browser task.'
  if (outcome.kind === 'browser.useStop') return '[calm]I stopped browser control.'
  if (outcome.kind === 'browser.use') return '[calm]The browser control session has started.'
  return `[calm]Browser control state: “${outcome.state ?? 'no active session'}”.`
}
