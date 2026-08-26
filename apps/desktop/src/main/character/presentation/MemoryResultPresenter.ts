import type { UiLocale } from '../../../shared/localization'
import type { CharacterToolVerifiedOutcome } from '../../character-tools'

type GameVerifiedOutcome = Extract<CharacterToolVerifiedOutcome, { kind: `game.${string}` }>

function isGameOutcome(outcome: CharacterToolVerifiedOutcome): outcome is GameVerifiedOutcome {
  return ['game.start', 'game.pause', 'game.resume', 'game.stop', 'game.status'].includes(
    outcome.kind,
  )
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
  if (isGameOutcome(outcome)) return presentGameOutcome(outcome, locale)
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

function presentGameOutcome(outcome: GameVerifiedOutcome, locale: UiLocale): string {
  if (locale === 'ru') {
    if (outcome.outcome !== 'success')
      return presentGameFailureRu(outcome.errorCode, outcome.outcome)
    if (outcome.kind === 'game.start') {
      if (outcome.state === 'waiting-user')
        return '[calm]Игровая сессия приостановлена и ждёт твоего вмешательства.'
      return '[happy]Игровая сессия запущена — я уже играю.'
    }
    if (outcome.kind === 'game.pause') return '[calm]Поставила игру на паузу.'
    if (outcome.kind === 'game.resume') return '[happy]Продолжаю играть.'
    if (outcome.kind === 'game.stop') return '[calm]Остановила игровую сессию.'
    return `[calm]Состояние игровой сессии: ${outcome.state ?? 'неизвестно'}.`
  }
  if (outcome.outcome !== 'success') return presentGameFailureEn(outcome.errorCode, outcome.outcome)
  if (outcome.kind === 'game.start') {
    if (outcome.state === 'waiting-user')
      return '[calm]The game session is paused and waiting for your intervention.'
    return '[happy]The game session has started — I am playing now.'
  }
  if (outcome.kind === 'game.pause') return '[calm]I paused the game.'
  if (outcome.kind === 'game.resume') return '[happy]I am continuing the game.'
  if (outcome.kind === 'game.stop') return '[calm]I stopped the game session.'
  return `[calm]Game session state: ${outcome.state ?? 'unknown'}.`
}

function presentGameFailureRu(
  code: string | undefined,
  outcome: GameVerifiedOutcome['outcome'],
): string {
  if (code === 'GAME_SURFACE_NOT_FOUND')
    return '[calm]Не нашла на текущей странице безопасную игровую область.'
  if (code === 'GAME_SURFACE_SELECTION_REQUIRED')
    return '[calm]На странице несколько игровых областей — нужно выбрать одну.'
  if (code === 'GAME_SESSION_ACTIVE') return '[calm]Игровая сессия уже запущена.'
  if (code === 'GAME_SCOPE_CHANGED')
    return '[calm]Страница изменилась до запуска игры, поэтому я остановилась.'
  if (code === 'GAME_CAPABILITY_UNAVAILABLE' || code === 'BROWSER_GAME_UNAVAILABLE')
    return '[calm]Управление браузерной игрой сейчас недоступно.'
  if (outcome === 'permission-denied') return '[calm]Запуск игровой сессии не был разрешён.'
  return '[calm]Не получилось безопасно запустить игровую сессию.'
}

function presentGameFailureEn(
  code: string | undefined,
  outcome: GameVerifiedOutcome['outcome'],
): string {
  if (code === 'GAME_SURFACE_NOT_FOUND')
    return '[calm]I could not find a safe game surface on the current page.'
  if (code === 'GAME_SURFACE_SELECTION_REQUIRED')
    return '[calm]There are several game surfaces on the page, so one must be selected.'
  if (code === 'GAME_SESSION_ACTIVE') return '[calm]A game session is already running.'
  if (code === 'GAME_SCOPE_CHANGED')
    return '[calm]The page changed before the game started, so I stopped.'
  if (code === 'GAME_CAPABILITY_UNAVAILABLE' || code === 'BROWSER_GAME_UNAVAILABLE')
    return '[calm]Browser game control is currently unavailable.'
  if (outcome === 'permission-denied') return '[calm]The game session was not authorized.'
  return '[calm]I could not safely start the game session.'
}
