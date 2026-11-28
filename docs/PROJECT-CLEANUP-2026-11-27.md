# Очистка проекта на codex/desktop-companion-v1

## Architecture Review

Проверены исходники Desktop, API, launcher, repository scripts и квалификационные сценарии. Вызовы оставшихся PowerShell-функций подтверждены. HTTP-контракт Desktop–API, доменные владельцы Runtime и авторизация IPC сохраняются. Диагностика использует тип состояния владельца AvatarController и продолжает выдавать те же поля. Настройки Main переиспользуют общие поля AppSettings, явно заменяя публичные LLM-настройки и opaque VRM handles внутренним представлением.

## Что изменено

Полностью удалены четыре файла.

| Файл | Строк | Основание |
| --- | ---: | --- |
| `apps/desktop/src/main/alive/AliveRuntime.ts` | 4 | Пустой наследник AliveFacade. Composition, IPC и тест используют AliveFacade напрямую. |
| `apps/desktop/qualifications/motion-ab/cdp.cjs` | 121 | Экспорт connectOwned без импортов и вызывающего кода. |
| `apps/desktop/qualifications/motion-ab/record.cjs` | 104 | Экспорт recordPage без импортов и вызывающего кода. |
| `apps/desktop/qualifications/speech-motion/capture-dynamics.py` | 146 | Старый capture-скрипт импортировал удалённые backend.py, research.py и phase_prompt. Ссылок из текущих команд и документации нет. |

Из действующих файлов удалены следующие части.

- Controller — невостребованная проекция `health`, её `toLegacyHealth`, неиспользуемый `publishAvatarState`, старые `STATUS_LABELS`, `HealthState` и два ключа перевода в обеих локалях. Shell использует свою текущую проекцию Runtime Health.
- Orchestrator — неиспользуемый аргумент `_speechRuntimeCompatibility`, 22 соответствующих аргумента в composition, тестах и квалификациях, а также фиктивные SpeechClient-импорты и объекты в тестах.
- Runtime и Plugin API — невостребованные `listTools`, `isIdle`, `getBrowserComputerUseProvider`, `computerUseObservationSnapshot`, `influenceSnapshot`, `isCanonicalToolName`, `hasProvider`, `ownerOf`, `getWebSearchProvider`, `isPaused`, `getLimit`, `setOverlayCameraView`, `getMirrorState`, `checkNow`, `speechEnded`, `isContinuousEnabled` и три старых метода чтения avatar mapping из EmotionRegistry.
- ToolInfluenceSnapshot — дублирующий `evidenceOrigins`. Журнал получает тот же список из существующего `evidence`.
- WorldContextSnapshot — устаревший дубликат `userIdleMs`. Снимок Main использует `globalUserIdleMs`; ограниченный отчёт renderer об активности сохраняет свой исходный контракт.
- Типы — повторные поля AvatarRuntimeDebugState, RuntimeDebugSnapshot и AppConfig заменены выводом из существующих типов. Удалены неиспользуемые ShellActionExecution, BrowserComputerUseState, BrowserReactiveAnchor, BrowserReactiveControlPrimitive, ComputerUseSemanticObservation, DesktopAutomationAdapter, EmbodimentIntensity, CharacterResponseIntent, MotionHandTarget, PluginCapability и ProjectConnectorStatus.
- API — невостребованные EmotionParser, EmotionTranslator, create_emotion_config, get_health_state, collect_chunks, detect_language, default_voice и обёртка voices.resolve_reference. Реестры EmotionRegistry и VoiceRegistry обслуживают текущие маршруты напрямую.
- Команды — удалён неиспользуемый alias `test:llm-live`. Live LLM qualification запускается через `qualify:llm`.

## Root Cause

N/A для рефакторинга. Старые обёртки и отдельные инструменты остались после смены владельцев и motion backend. Для capture-dynamics подтверждены отсутствующие импортируемые модули.

## Почему фикс работает

Удаляемые методы проверены по всем исходникам, тестам, квалификациям и командам. Вывод типов устраняет повторные объявления. Удаление аргумента Orchestrator проверено во всех 22 местах создания через синтаксическое дерево. Миграции сохранённых настроек и containment старых протокольных маркеров продолжают обслуживать существующие данные и ответы провайдеров.

## Файлы и объём

Сравнение выполнено с состоянием рабочего дерева в начале этого прохода, после предыдущей очистки. Считаются физические строки исходников, включая комментарии и пустые строки. Отчёт и сгенерированные build-артефакты в сокращение кода не входят.

| Область | Чистое сокращение строк |
| --- | ---: |
| Desktop production | 301 |
| API production | 92 |
| Desktop tests | 41 |
| Desktop qualifications | 374 |
| Desktop package scripts | 1 |
| Всего | 809 |

## Проверки

Прошли полная регрессия Desktop — 1 142 теста в 189 файлах, 76 тестов API, TypeScript, Biome, форматирование, импорты, Ruff и сборка. Дополнительный TypeScript-проход с noUnusedLocals и noUnusedParameters прошёл для Main и renderer. Через FastAPI TestClient проверены ответы 200 и JSON для `/health`, `/voices` и `/emotions`.

## Ограничения

Live Electron, реальные ASR/TTS и публичные браузерные квалификации в этом проходе не запускались. Biome сообщает десять прежних предупреждений, API-тесты — предупреждение PyTorch о deprecated torch.jit.load. Состояние проверено до коммита, изменения находятся в рабочем дереве ветки.

## Дополнительный проход по unit-тестам

По разделу Test architecture из `ARCHITECTURE.md` сценарии остались в детерминированном наборе Vitest. В рабочем коде приложения правок за этот проход нет.

- Удалены `test-kit.test.ts`, общий экспорт `tests/support/index.ts` и хелперы `TestClock`, `TestEventCollector`, `Eventually`. Единственным потребителем трёх хелперов был тест самого набора. Интеграционные тесты импортируют действующий `createTempDirectory` напрямую, как тесты уже импортировали `createDeferred`.
- Из `runtime-invariants.test.ts` удалены ручные счётчики и печать результатов. Прежний runner завершал тест успешно даже при счётчике ошибок больше нуля. Все 18 сценариев теперь дают отдельный результат Vitest, проверяют ожидаемые состояния и для нарушений подтверждают диагностическое предупреждение.
- `prompt-budget.test.ts` использует один насыщенный контекст для проверки общего лимита, резерва секций и компактности проекций. Отсутствие старых Goal Awareness-инструкций проверяет интеграционный тест Conversation Thread Runtime. `speech-polish.test.ts` использует стандартные проверки Vitest для произношения, разметки, идемпотентности и безопасного fallback. Из него удалены сравнения исходных полей с самим собой.
- Точные значения диапазона спокойных рук проверяет `standing-arm-range.test.ts` через вызываемую функцию. Из `expressiveness-profile.test.ts` удалена повторная проверка этих значений.

Относительно рабочего дерева до этого прохода `apps/desktop/tests` сократился на 318 физических строк TypeScript и пять файлов. Из них 244 строки и один файл приходятся на unit-тесты (7 155 → 6 911 строк), ещё 74 строки и четыре файла — на тестовые хелперы. Изменения отчёта в расчёт не входят.

Прошли полная регрессия Desktop в headless-режиме (1 160 тестов в 188 файлах), быстрый набор после финальной правки (435 тестов), TypeScript, Biome, форматирование, импорты и сборка. Biome сообщает десять прежних предупреждений за пределами изменённых файлов. Live Electron и проверки внешних сайтов остались за пределами этого прогона тестового кода.
