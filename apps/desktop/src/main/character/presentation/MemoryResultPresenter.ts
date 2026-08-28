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
  if (outcome.actionOutcome !== 'success') {
    if (locale === 'ru') {
      if (outcome.actionOutcome === 'permission-denied')
        return '[calm]Сессия управления браузером не была разрешена.'
      if (outcome.actionOutcome === 'cancelled')
        return '[calm]Управление браузером отменено, все удерживаемые клавиши и кнопки отпущены.'
      return `[calm]${browserUseFailure(outcome.errorCode, locale)}`
    }
    if (outcome.actionOutcome === 'permission-denied')
      return '[calm]The browser control session was not authorized.'
    if (outcome.actionOutcome === 'cancelled')
      return '[calm]Browser control was cancelled and all held inputs were released.'
    return `[calm]${browserUseFailure(outcome.errorCode, locale)}`
  }
  if (locale === 'ru') {
    if (outcome.state === 'waiting-user')
      return '[calm]Сессия браузера сохранена и ждёт твоего вмешательства.'
    if (outcome.projection === 'session-paused')
      return '[calm]Поставила управление браузером на паузу.'
    if (outcome.projection === 'session-resumed') return '[calm]Продолжаю работу в браузере.'
    if (outcome.projection === 'session-stopped') return '[calm]Остановила управление браузером.'
    if (outcome.projection === 'goal-completed') return '[calm]Готово.'
    if (outcome.projection === 'session-started') {
      return outcome.actionCount && outcome.actionCount > 0
        ? '[calm]Работаю с сайтом.'
        : '[calm]Запустила управление браузером, сейчас разбираюсь со страницей.'
    }
    return `[calm]Состояние управления браузером: «${outcome.state ?? 'нет активной сессии'}».`
  }
  if (outcome.state === 'waiting-user')
    return '[calm]The browser session is retained and waiting for your intervention.'
  if (outcome.projection === 'session-paused') return '[calm]I paused browser control.'
  if (outcome.projection === 'session-resumed') return '[calm]I am continuing the browser task.'
  if (outcome.projection === 'session-stopped') return '[calm]I stopped browser control.'
  if (outcome.projection === 'goal-completed') return '[calm]Done.'
  if (outcome.projection === 'session-started') {
    return outcome.actionCount && outcome.actionCount > 0
      ? '[calm]I am working with the site.'
      : '[calm]I started browser control and am assessing the page now.'
  }
  return `[calm]Browser control state: “${outcome.state ?? 'no active session'}”.`
}

function browserUseFailure(errorCode: string | undefined, locale: UiLocale): string {
  const ru = {
    COMPUTER_USE_MODEL_INVALID_RESPONSE: 'Не смогла разобрать текущий визуальный ответ модели.',
    COMPUTER_USE_MODEL_SCHEMA_MISMATCH:
      'Не смогла согласовать визуальный ответ модели с текущей страницей.',
    COMPUTER_USE_COMPLETION_UNVERIFIED:
      'Не смогла надёжно подтвердить завершение задачи в браузере.',
    COMPUTER_USE_LEASE_EXPIRED: 'Сработал безопасный лимит времени управления браузером.',
  } as const
  const en = {
    COMPUTER_USE_MODEL_INVALID_RESPONSE: 'I could not parse the current visual model response.',
    COMPUTER_USE_MODEL_SCHEMA_MISMATCH:
      'I could not validate the visual model response for the current page.',
    COMPUTER_USE_COMPLETION_UNVERIFIED:
      'I could not reliably verify that the browser task was complete.',
    COMPUTER_USE_LEASE_EXPIRED: 'The browser-control safety lease expired.',
  } as const
  const selected = locale === 'ru' ? ru : en
  return (
    selected[errorCode as keyof typeof selected] ??
    (locale === 'ru'
      ? 'Не смогла завершить управление браузером из-за ошибки текущей сессии.'
      : 'I could not finish browser control because the current session failed.')
  )
}
