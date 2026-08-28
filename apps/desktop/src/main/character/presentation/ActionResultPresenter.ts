import type { DesktopWorkflowActionResult } from '../../../shared/actions'
import type { UiLocale } from '../../../shared/localization'

function safeRuntimeVersionFact(result: DesktopWorkflowActionResult) {
  return result.execution?.presentationFacts?.find(
    (fact) => fact.kind === 'runtime-version' && fact.sensitivity === 'safe',
  )
}

function successfulActionFallback(
  result: DesktopWorkflowActionResult,
  locale: UiLocale,
  browserAction: boolean,
): string {
  const browser = result.execution?.browser
  if (browser) {
    if (browser.verification !== 'verified' && browser.verification !== 'not-required') {
      return locale === 'ru'
        ? '[calm]Я выполнила действие в браузере, но не смогла надёжно подтвердить, что страница отреагировала как ожидалось.'
        : '[calm]I performed the browser interaction, but I could not reliably confirm that the page reacted as expected.'
    }
    if (browser.operation === 'open' && browser.resultingUrl) {
      return locale === 'ru'
        ? `[calm]Готово — открыта страница ${browser.resultingUrl}.`
        : `[calm]Done—the page ${browser.resultingUrl} is open.`
    }
    if (browser.operation === 'click') {
      const target = browser.targetName ? ` «${browser.targetName}»` : ''
      return locale === 'ru'
        ? `[calm]Готово — элемент${target} на странице нажат.`
        : `[calm]Done—the${target ? ` ${browser.targetName}` : ''} element was clicked.`
    }
    if (browser.operation === 'switch-tab') {
      return locale === 'ru'
        ? '[calm]Готово — переключилась на нужную вкладку.'
        : '[calm]Done—I switched to the requested tab.'
    }
    if (browser.operation === 'observe') {
      return locale === 'ru'
        ? '[calm]Готово — прочитала текущую страницу.'
        : '[calm]Done—I read the current page.'
    }
    if (browser.operation === 'tabs') {
      return locale === 'ru'
        ? '[calm]Готово — проверила открытые вкладки.'
        : '[calm]Done—I checked the open tabs.'
    }
  }
  if (browserAction) {
    return result.execution?.verification === 'verified' ||
      result.execution?.verification === 'not-required'
      ? locale === 'ru'
        ? '[calm]Готово — действие в браузере выполнено, и изменение страницы подтверждено.'
        : '[calm]Done—the browser action completed and the page change was verified.'
      : locale === 'ru'
        ? '[calm]Я выполнила действие в браузере, но не смогла надёжно подтвердить новое состояние страницы.'
        : '[calm]I performed the browser action, but I could not reliably confirm the new page state.'
  }

  const version = safeRuntimeVersionFact(result)
  if (version) {
    return locale === 'ru'
      ? `[calm]У тебя ${version.label} версии ${version.value}. Вполне бодрая — терминал подтвердил без лишней драмы.`
      : `[calm]You have ${version.label} ${version.value}. Perfectly lively—the terminal confirmed it without any drama.`
  }

  return locale === 'ru'
    ? '[calm]Готово, команда отработала успешно. Даже терминал сегодня решил со мной не спорить.'
    : '[calm]Done—the command completed successfully. Even the terminal knew better than to argue with me today.'
}

const BROWSER_FAILURES: Partial<Record<string, Record<UiLocale, string>>> = {
  TARGET_NOT_FOUND: {
    ru: 'В текущем семантическом снимке я не смогла надёжно определить запрошенный элемент.',
    en: 'I could not reliably identify the requested element in the current semantic snapshot.',
  },
  TARGET_AMBIGUOUS: {
    ru: 'На странице несколько подходящих элементов — уточни, какой выбрать.',
    en: 'There are several matching elements on the page—tell me which one to use.',
  },
  TARGET_STALE: {
    ru: 'Страница успела измениться, поэтому старый элемент я нажимать не стала.',
    en: 'The page changed, so I did not click the stale element.',
  },
  NO_ACTIVE_SESSION: {
    ru: 'Сейчас нет активной страницы браузера.',
    en: 'There is no active browser page right now.',
  },
  DSH_MODEL_NOT_CONFIGURED: {
    ru: 'Сейчас недоступен модуль автоматического планирования браузерных действий.',
    en: 'Automatic planning for multi-step browser actions is currently unavailable.',
  },
  DSH_ACTION_LIMIT: {
    ru: 'Не смогла закончить задачу в пределах безопасного лимита браузерных действий.',
    en: 'I could not finish the task within the safe browser action limit.',
  },
  CLICK_FAILED: {
    ru: 'Не смогла нажать запрошенный элемент на странице.',
    en: 'I could not click the requested page element.',
  },
  INPUT_FAILED: {
    ru: 'Не смогла изменить запрошенное поле на странице.',
    en: 'I could not change the requested page field.',
  },
  NAVIGATION_FAILED: {
    ru: 'Не смогла открыть запрошенную страницу.',
    en: 'I could not open the requested page.',
  },
  OBSERVATION_FAILED: {
    ru: 'Не смогла прочитать текущее состояние страницы.',
    en: 'I could not read the current page state.',
  },
  BROWSER_UNAVAILABLE: {
    ru: 'Сейчас управление браузером недоступно.',
    en: 'Browser Control is currently unavailable.',
  },
  BROWSER_CONTROL_NEEDS_SETUP: {
    ru: 'Сейчас не получилось открыть браузерную сессию.',
    en: 'I could not open a browser session right now.',
  },
  DSH_REMOTE_ERROR: {
    ru: 'Автоматический проход по сайту сейчас не сработал.',
    en: 'Automatic navigation through the site did not work.',
  },
  DSH_REQUEST_TIMEOUT: {
    ru: 'Автоматический проход по сайту не успел завершиться вовремя.',
    en: 'Automatic site navigation did not finish in time.',
  },
  DSH_TRANSPORT_CLOSED: {
    ru: 'Автоматический проход по сайту неожиданно остановился.',
    en: 'Automatic site navigation stopped unexpectedly.',
  },
  SESSION_CLOSED: {
    ru: 'Текущая сессия браузера уже закрыта.',
    en: 'The current browser session is already closed.',
  },
}

const ACTION_HEADLINES: Record<UiLocale, Record<DesktopWorkflowActionResult['outcome'], string>> = {
  ru: {
    success: 'Команда завершилась, но подтверждённого результата не вернула.',
    failure: 'Команда споткнулась об ошибку.',
    'permission-denied': 'Не стала выполнять команду: ты не разрешил доступ.',
    timeout: 'Остановила команду по тайм-ауту — вечность ждать я не нанималась.',
    cancelled: 'Команда отменена. Терминал снова свободен.',
  },
  en: {
    success: 'The command finished without returning a verified result.',
    failure: 'The command tripped over an error.',
    'permission-denied': 'I left the command alone because you did not grant access.',
    timeout: 'I stopped the command at the timeout—I was not hired to wait forever.',
    cancelled: 'The command was cancelled. The terminal is free again.',
  },
}

export function presentActionResult(
  result: DesktopWorkflowActionResult,
  locale: UiLocale,
  browserAction = false,
): string {
  if (result.execution?.runtimeCompleted && result.execution.verification === 'unverified') {
    return locale === 'ru'
      ? '[calm]Действие выполнилось, но я не смогла надёжно подтвердить ожидаемый результат.'
      : '[calm]The action ran, but I could not reliably confirm the expected result.'
  }
  if (result.execution?.runtimeCompleted && result.execution.verification === 'failed') {
    return locale === 'ru'
      ? '[calm]Не получилось подтвердить ожидаемый результат — наблюдаемое состояние не совпало с ожиданием.'
      : '[calm]I could not confirm the expected result—the observed state did not match.'
  }
  if (result.outcome === 'success' && result.execution?.runtimeCompleted) {
    return successfulActionFallback(result, locale, browserAction)
  }
  const browserFailure = result.errorCode ? BROWSER_FAILURES[result.errorCode]?.[locale] : undefined
  return `[calm]${browserFailure ?? ACTION_HEADLINES[locale][result.outcome]}`
}
