# Разговорный выбор и исполнение жестов

## Architecture Review

Target decision: ARCHITECTURE.md, «Typed conversational gesture decision and preparation», сначала записан как planned 27 October 2026, после реализации отмечен implemented с отдельным ограничением live-проверки. Сохраняются владельцы: Character LLM выбирает semantic intent; Main валидирует существующий план; Avatar Runtime выбирает профиль и исполняет кости/кисти; AudioPlayer владеет consumed PCM; Overlay получает ту же позу. OpenRouter, HTTP Speech API, квоты, настройки провайдера и retry policy не меняются. Новых LLM-запросов для жестов не добавляется.

## Подтверждённое RCA

- В сохранённом production preflight ответы OpenRouter были настоящими, но greeting/shy cases не имели ни одного typed intent и ни одного исполняемого жеста. Свободный текст и список возможностей не являются выбором движения.
- Пользователь получил видимый [fox-paw]. Это не emotion и не допустимый internal intent envelope; существующий фильтр оставляет такую строку в prose.
- AvatarController сохраняет раннее намерение, но конкретный профиль разрешается только в opening при startSpeaking. prepareSpeaking выбирает обычную presence. Каноническая подготовка gesture занимает 1800–2200 ms, поэтому короткая речь может закончиться до stroke.
- future-only intent не проходит opening gate и не выбирается в later holding/emphasis. Предыдущая квалификация библиотеки не проверяла эту conversational цепочку полностью.

## Последовательность Work Items

1. **WI A — canonical decision.** Добавить ограниченное nullable embodiment в существующий typed planning result; включить в тот же prompt/schema актуальные Avatar facts. Отделить invalid visual data от tool authority, без повторных запросов ради жеста. Передавать решение только с первым реальным Character text, удерживать при tool-first round и отбрасывать при failure/cancel. Совместимость: старый envelope используется только при отсутствии нового решения. Проверить настоящий production tool loop с локальным deterministic provider и неизменное число model calls.
2. **WI B — preparation/adoption.** Подготовить один early semantic gesture до PCM, затем принять тот же execution при начале речи. Проверить duplicate updates, собственный cooldown, new turn, manual preview, model replacement, cancelled/ended speech и отсутствие преждевременного stroke.
3. **WI C — late boundary.** Один fresh future-only proposal допускается на следующей доступной speaking boundary, сохраняя protected stroke и actual runtime eligibility. Проверить однократность, отсутствие replay и release на speech end.
4. **WI D — containment and prompt.** Убирать [fox-paw] и другие canonical gesture literals из streamed/final chat/TTS без выдачи им authority. Сохранять quoted code, escaped literals, Markdown links и split invariance. Уточнить выбор действия при прямом запросе и честность списка доступных жестов.
5. **WI E — validation/report.** Focused regressions после каждого owner fix; затем Biome/typecheck/build и подходящий общий regression. По просьбе пользователя live/provider tests не запускать, клиент/API не перезапускать. Сохранить параллельную migration работу, не создавать commit.

План сверён с target decision до изменения implementation code. Новая visual metadata не заменяет Tool Requirement, plannedTools, Action Runtime или существующую проверку Avatar availability.

## Что изменено

WI A–E выполнены в коде и проверены локально 27 October 2026. Решение о жесте включено в существующий typed planning result. Явное null авторитетно; невалидное или недоступное намерение не вызывает дополнительного запроса ради visual metadata. Пустой ответ и tool-only round не передают жест через итоговую metadata. Ошибка до prose и отмена не выпускают подготовленное намерение в поток.

AvatarController начинает одну speech-bound подготовку с первым безопасным Character text; AvatarPlaybackCoordinator при начале речи принимает тот же объект pending playback, сохраняя execution и seed. Повторные speaking/emotion updates не перезапускают opening. Future-only intent допускается один раз при активном consumed PCM на разрешённой hold/terminal границе. Protected stroke, buffering, завершённый звук и finishingSpeech не разрешают новый поздний жест. Release удаляет совпадающую speech preparation из фактической очереди GeneratedBodyPlayback и переводит уже активную подготовку в recovery. Отдельных костных, лицевых или Overlay writers не добавлено.

SafeCharacterStreamFilter убирает canonical bracketed gesture literals, сохраняя Markdown links, code и escaping. Он не превращает эти строки в intent. Подавление действует и в parseEmotionalReply, через который проходят видимый ответ и сохранённая conversation history.

## Root Cause

Список движений и текстовый [fox-paw] не являлись typed intent. Даже полученное намерение разрешалось только при старте речи, теряя время подготовки; позднее намерение пропускалось opening gate без альтернативного speaking boundary. Повторные state/emotion updates могли начинать новый speaking session. Прежняя физическая квалификация библиотеки не покрывала эти ошибки conversational transport/execution.

## Почему фикс работает

Семантическое решение передаётся отдельно от prose в том же существующем Character вызове. Физическая подготовка получает время до PCM; начало речи продолжает тот же принятый запрос, обходя только повторную проверку собственного cooldown. Исполнение остаётся у существующего body owner. Срок и turn identity проверяются независимо от фонового Behavior intent. Очередь освобождается у своего владельца, поэтому отменённая подготовка не может начаться после восстановления предыдущего движения.

## Файлы

- `apps/desktop/src/shared/character-tools/contracts.ts`: nullable visual decision.
- `apps/desktop/src/main/character-tools/CharacterToolLoop.ts`: prompt/schema, независимая валидация metadata, безопасная передача, empty/failure/cancellation containment.
- `apps/desktop/src/main/orchestrator.ts`: единый availability snapshot и приоритет typed decision над inline markers.
- `apps/desktop/src/main/character/prompting/CharacterPrompt.ts`: выбор semantic gesture при явном запросе, согласование prose с typed proposal.
- `apps/desktop/src/renderer/avatar/AvatarController.ts`, `AvatarPlaybackCoordinator.ts`: preparation, adoption, поздняя граница, release и отсутствие replay.
- `apps/desktop/src/renderer/avatar/rendering/three/VrmModel.ts`, `GeneratedBodyPlayback.ts`: release совпадающей pending speech preparation у body owner.
- `apps/desktop/src/shared/character-stream/SafeCharacterStreamFilter.ts`: containment literals без authority.
- `tests/integration/embodiment-stream.test.ts`, `tests/unit/avatar/conversational-gesture.test.ts`, `tests/unit/avatar/phase-playback-regressions.test.ts`, `tests/unit/character-response/gesture-literal-containment.test.ts`: production-owner regressions.

## Проверки

Добавлено 20 deterministic cases. Зафиксированы red → green для typed plan, ранней/поздней подготовки, replay после preview, literal containment, expiry с Behavior intent и пустой итоговой metadata. Последний общий прогон: **508/508 tests, 113/113 files**.

Успешны `npm run desktop:check`, `npm run desktop:format:check`, `npm run desktop:imports:check`, `npm run typecheck`, `npm run desktop:test:regression`, `npm run build`. Логи последнего прогона: `tmp/conversational-gesture-{check,format,imports,typecheck,regression,build}-final.log`. Финальный renderer artifact: `out/renderer/assets/index-D6EC1jgH.js`. Speech Worklet verified сборочным guard.

## Ограничения

Live Electron, Fish, ARDY и provider qualification для этого исправления не запускались по просьбе пользователя. Клиент/API не перезапускались. Deterministic provider doubles проверяют реальную transport/owner цепочку, но не доказывают качество semantic selection конкретной удалённой модели или визуальное качество конкретного живого исполнения. OpenRouter, настройки, retries и число плановых model calls не менялись; новые live model calls не выполнялись. Для ручной проверки нужен запуск обновлённой сборки пользователем. Параллельные migration/legacy-cleanup изменения сохранены и проверены общей регрессией. Commit/push не создавались.
