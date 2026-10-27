# Living Character Motion Engine — план и журнал проверки

## Architecture Review

Решение сначала записано в `ARCHITECTURE.md`, раздел Phased motion composition.
Сверены ownership Avatar/Main/AudioPlayer/Mixer и отсутствие новых Runtimes.
HEAD: `52ff4a8abc5cc5a8366511c4b50cb15fc939b449`; ветка соответствует ТЗ.
SOMA30: `244215084b22fcd29ab743017330e87411fe168a`, 30 FPS, horizon/history 60.
Рабочее дерево перед работой чистое. Fish/ASR и внешние Runtime вне scope.

## План исполнения

| WI | Изменение | Архитектурная граница | Проверка |
| --- | --- | --- | --- |
| 1 | Парный replay одинаковых реальных horizons, stage/bone/frame metrics | Локальная qualification; никаких poses в Health | Реальный source, фиксированные seed/rig, baseline артефакт |
| 2 | Один адаптивный temporal filter, сохранение stroke | Body composer; PCM clock и swept safety | Скорость, лаг, ускорение, граница horizons, delayed frames |
| 3 | Разделение artistic amplitude и anatomical projection | Retargeting + существующий safety | Actual-rig контакты, elbows/wrists/knees, VRM0/1 |
| 4 | Фазовые сроки и совместимые продолжения | Существующий MotionPhaseExecution | Pending/recovery/speech cancellation regressions |
| 5 | Контролируемое сравнение conditioning | Один Main-owned worker, allowlisted profiles | Source-only A/B отдельно от renderer |
| 6 | Canonical typed full-body profile/intent | Тот же catalog и Body Domain | Строгие validators, неизвестные параметры отвергаются |
| 7 | Чередование опоры, heading, IK | Body Domain; bounded fallback | Foot drift, reachability, contact acquisition |
| 8 | Один оборот и фактический terminal outcome | Semantic intent → body executor | CW/CCW, отмена, другой seed, реальная VRM |
| 9 | Сохранение presence и отдельных channels | Существующие процедурные/лицевые owners | Idle/speaking, springs, gaze, LipSync |
| 10 | Stage projection и Overlay | Primary composer → presentation consumer | Пропуски frames, stale identities, replacement |
| 11 | Раздельные временные измерения | Main Adapter/worker/renderer | Реальная GPU нагрузка, без слепой смены precision |

План проверен на соответствие решению до изменений поведения. WI1–3 выполняются
раньше расширения support class. После каждого WI — focused проверки. Художественная
приёмка отделена от численной. Push/merge не выполняются.

## Что изменено

Реализованы replay одинакового SOMA source по стадиям, единый velocity-aware filter,
разделение художественной амплитуды и анатомических ограничений, typed turn contract
и адаптивный планировщик текущей стойки. Приоритетный разговорный дефект исправляется
отдельно: bounded retry, local breath projection, немедленная подготовка speech gesture,
сохранение committed forecast при старте PCM и отдельный срок post-accent hold.
Ни одна численная проверка не объявляет художественную приёмку пройденной.

## Root Cause (если был баг)

Изначальный renderer каскадировал slerp/rate limits и final safety, ослабляя source
динамику. Отдельные live RCA обычного разговора: бессрочная блокировка после failure,
отсутствие Overlay body projection без lease, speech gesture за presence_thinking,
обратный phase request после принятого forecast и ошибочный 400 ms deadline для hold.
В демонстрации эмоций три positive delivery могли сводиться к одному happy лицу;
у текущей VRM0 нет surprised morph, хотя canonical emotion поддерживается протоколом.

## Почему фикс работает

Временная фильтрация имеет одного владельца и исходную скорость как feedforward;
геометрические ограничения остаются последним safety. Разговорный body owner может
восстановиться после cleanup и публикует своё дыхание без генератора. Speech gesture
не расходует всю audible реплику на предыдущий presence; phase requests монотонны.
Мимика проверяется по фактическому expressionManager output обеих VRM и PCM cue,
не по словам персонажа, названию профиля или наличию LLM emotion tag.

## Файлы

`GeneratedBodyPlayback.ts`, `GeneratedBodySafety.ts`, `AdaptiveMotionFilter.ts`,
`ProceduralTurnPlanner.ts`, `TurnInPlaceMotion.ts`, shared motion/intent schemas,
`CharacterPrompt.ts`, Main publication validation, qualification scripts и регрессии.

## Проверки

Проверены actual-rig planner, задержанные horizons/PCM, retry после failure и local
breath mirror. Реальная LLM + Fish + ARDY на настроенной VRM0: короткая реплика и
объяснение с жестами без motion errors; 60 s idle с 1689 наблюдаемыми source frames;
контролируемые happy/sad/angry доходят до primary и Overlay с весами ~0.54/0.68/0.72.
Артефакты всех failed прогонов сохранены; последняя квалификация и команды дописываются
ниже после завершения, а не заменяют предыдущие неудачи.

## Ограничения

Художественная приёмка поворота остаётся pending после отклонения пользователем.
Планировщик использует геометрический COM/ZMP proxy, а не неизвестные массы VRM.
Полная матрица разных rig/направлений/темпов и длительная GPU endurance ещё не закрыты.
Текущая VRM0 имеет очень слабый Joy morph (~1.6 mm max) и не имеет Surprised;
одинаковые labels или ненулевые веса сами по себе не гарантируют заметную эмоцию.

## Повторная доводка WI7–8 после визуального отклонения

Пользователь отклонил поворот как дёрганный. Численный pass контактов не является
приёмкой движения. Детерминированный production-body trace сохранён в
`apps/desktop/motion/.artifacts/living-motion/turn-before-review.json`: колени до
144 рад/с², первые пики на 0,13 с; при переменном dt показатели ухудшаются.
Выявлены жёсткая ранняя проекция root height, остановка таза в середине переноса
опоры и потеря остатка времени на границах шагов. Решение сначала добавлено в
canonical architecture. Следующий отдельный Work Item меняет только исполнение
поворота и его проверки: C2-перенос опоры, заранее допустимая глубина приседания,
непрерывный clock и проверки производных суставов на реальном rig. Исходные видео
и численные failures сохраняются; художественный статус остаётся pending/rejected.

## WI7–8: адаптивный планировщик вместо фиксированной последовательности

По прямому запросу пользователя схема «8 + 2 шага» отклонена. До изменения кода
в canonical architecture добавлено решение Pose-adaptive turn planning. Ownership
не меняется: planner рассчитывает данные, TurnInPlaceMotion исполняет их в едином
Body Domain. Первый шаг, опора, постановка, угол и длительность выбираются из текущей
позы и геометрии, следующий горизонт пересчитывается после подтверждённой посадки.

Порядок реализации: (1) калибровка стоп/ног и конечная оценка кандидатов с reach,
twist, clearance и упрощённой COM/ZMP-проверкой; (2) интеграция непрерывных сегментов,
actual-contact commit, остановки и восстановления; (3) регрессии изменённой стойки,
пропорций, начальной нагрузки и dt; (4) live VRM0/VRM1 и новая визуальная запись.
Число шагов ограничено только бюджетом безопасности. Массы и инерции VRM неизвестны:
баланс оценивается по геометрическому COM proxy, без заявления о полной динамике тела.
Код этого WI реализован; регрессии изменённой опоры, пропорций, cadence и отмены
проходят. Один live CW turn имеет физический pass, но не художественную приёмку.

Уточнение исполнения: проверка второго шага выявила цену синхронного перебора.
Сначала в architecture описан bounded incremental forecast: расчёт следующего
горизонта распределяется по render frames; усвоение возможно только после проверки
его goal и actual landing. План WI дополнен этим ограничением до изменения clock.

## Приоритетный дефект обычного разговора

Пользователь наблюдает рот/моргание без тела. В работающем dev-клиенте через Console
подтверждён `ARDY_generator-unavailable` для presence_restful и presence_speaking.
RCA: profileAvailability бессрочно блокирует любые автоматические попытки после
одного failure. Дополнительно capturePresentation требует lease, Main разрешает
только ARDY-owned lease, а Overlay намеренно не запускает второе дыхание. Поэтому
после потери генератора Overlay не получает и сохраняющееся локальное дыхание Main.

До кода в architecture добавлен отдельный recovery WI: bounded retry после cleanup,
явно local-проекция без выдуманного ARDY lease, строгая проверка sender/model/generation,
регрессии провайдера и дыхания, затем реальный разговор с Fish/ARDY и Overlay. Поворот
не служит доказательством исправления этого дефекта. Spring Bones пока не объявлены
повреждёнными: их фактическое обновление проверяется отдельно.

Live repro `joint-2026-10-27T14-29-45-936Z` подтвердил вторую причину отсутствия
жестов: opening explain_one_palm успешно подготовлен Controller, но в body queue
перед ним остаётся presence_thinking. Весь audible ответ расходуется на presence
recovery/prepare/stroke. В architecture отдельно разрешён direct prepare из
interruptible presence для свежего speech-bound intent; обычные presence в очереди
уступают ему, текущий protected gesture и manual preview сохраняют свои границы.

## Дополнительный кейс: несколько эмоций в одной озвучке

Реальный пользовательский запрос на настроенной VRM0 воспроизведён через Mistral,
Fish и ARDY (`joint-2026-10-27T14-54-06-739Z`). LLM выдала excited/happy/amused:
три канонических delivery, но одна визуальная семья happy. Переходы audible доходят
до Avatar; это ещё не доказывает разнообразие лица или правильность Overlay.
До изменения prompt в architecture зафиксировано уточнение семантического контракта:
разыграть до трёх контрастных эмоций вместо перечисления. Следующий WI проверяет
реальный запрос и контролируемую последовательность happy/sad/angry по фактическим
VRM weights в primary и Overlay, с реальным PCM и видеозаписью.

Второй live прогон подтвердил happy/angry/sad в обеих VRM (weights ~0.54/0.72/0.68),
но поймал ARDY_STALE_PLAN при старте PCM во время прерывания thinking. Новый
детерминированный regression воспроизводит: Main уже принял hold forecast, renderer
сбрасывает его при clock rebinding и отправляет stroke. Architecture сначала
уточнена: committed forecast сохраняется до promotion/local recovery; Main validator
не ослабляется. Ошибочный live прогон сохранён, общий pass ему не присвоен.

## Итог текущего разговорного Work Item, 18:22 MSK

- `joint-2026-10-27T15-14-36-683Z/report.json`: pass. Два независимых повтора точного
  пользовательского запроса через настоящую Mistral/Fish/ARDY завершились без motion
  errors; happy и sad видны по actual weights обеих VRM. Контролируемая последовательность
  happy/sad/angry прошла все три семейства. Записаны primary face и Overlay, ~54 FPS.
- `joint-2026-10-27T15-17-53-415Z/report.json`: pass. Обычный Chat + Overlay, Avatar
  Preview ни разу не монтируется: три эмоции, короткое согласие и объяснение. Есть
  фактические жесты во время consumed PCM, дыхание ~8 mm, 325 Spring Bone joints
  обновляются; motion errors отсутствуют. Это отдельная проверка пользовательского
  сценария, а не вывод из успешного Debug Preview.
- `joint-2026-10-27T15-04-00-718Z/report.json`: общий failed сохранён. Его отдельный
  60 s idle прошёл (1689 source frames), а задержанный hold выявил ошибочное применение
  accent deadline. Исправление оставляет 400 ms для stroke и существующие 2500 ms
  provider budget для prepare/hold, с hold/rebase вместо catch-up.
- `desktop:test:regression`: 132 files / 606 tests pass. `typecheck`, `build`,
  `desktop:check`, `desktop:format:check`, `desktop:imports:check`, catalog check — pass.
  Biome оставляет 3 прежних информационных useTemplate в нетронутом motion-ab/run.cjs.
  Motion Python: 46 tests pass; Ruff check/format пяти затронутых Python files — pass.
- Production build запущен с обычным пользовательским профилем. Main PID 19544,
  окно Shio Runtime отвечает, UI сообщает «Системы работают»; Overlay снова включён.
  Старый Main закрыт без force; qualification workers/applications завершены.

Оставшиеся ограничения: Mistral может выдать больше трёх меток или выбрать одинаковые
визуальные семейства. Runtime сохраняет общий bounded budget и не обещает сыграть
четвёртую/пятую эмоцию; текущая VRM0 не реализует surprised и имеет слабый Joy morph.
Реальные два повтора доказывают переключение мимики, но не гарантированное соблюдение
LLM заданного порядка трёх эмоций. Перенастройка модели не маскируется renderer fallback.

Далее по исходному плану: художественная доводка адаптивного разворота после rejection,
полная матрица rig/CW/CCW/tempo/interruption, оставшаяся conditioning/GPU endurance
квалификация и визуальная приёмка. Draft turn не становится автоматически qualified.
