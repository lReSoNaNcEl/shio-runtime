# Разбор ревью conversational motion, baseline 1025d9a

## Architecture Review

До кода перечитаны Avatar ownership и semantic embodiment в ARCHITECTURE.md.
Подтверждено: resolveAnimationTags и semantic fallback присваивают layer по usage,
а не kind выбранного профиля; presence может подавить procedural body до 24%.
Также подтверждено: старые living fixtures искусственно задают intent, а их pass
допускает prepare без stroke и измеренного движения. Они не доказывают выбор LLM.

Уточнение к ревью: отсутствие emotion → communicative gesture является deliberate
контрактом. Angry не даёт права угадывать disagree, happy не означает greeting.
Связь semantic gestureHint → gesture:* уже существует. Исправление должно улучшить
её выбор настоящей LLM, не вводить второй смысловой selector из эмоций или ключевых слов.

## Порядок работ

1. Сначала в canonical architecture записана поправка authority и qualification.
2. Regression реального presence/fallback authority и semantic gesture selection;
   исправить все resolver paths по canonical kind, без новых owners.
3. Уточнить bounded typed visual decision: естественный смысловой жест допустим
   в обычном объяснении/сравнении/реакции, отсутствие gesture тоже допустимо.
4. Новый реальный Chat qualification без замены createReply и без forced gestureHint:
   короткий разговор, объяснение, явное приветствие, эмоциональная реакция, idle.
   Записать actual joint excursions, видимый stroke и непрерывный 5-minute trace.
5. Проверить availability/readiness на реальных входах, затем focused/full checks.

Повороты, Fish, release flow и архитектурное разбиение Avatar вне этого исправления.
Artistic limits не увеличиваются вслепую: сначала actual displacement на текущем rig.

## Проверки и приёмка

Изменения реализованы; результаты ниже. Численный pass не объявляется визуальным
успехом. Финальная разговорная приёмка остаётся FAIL.

## Реальный repro короткой реплики

Первый five-minute trace: explanation, explicit greeting и celebrate имеют actual
stroke и движение кисти ~4 cm в stroke / ~40 cm от исходной позы. Но ordinary
получил ARDY_AUDIBLE_UNDERRUN: общий pass отклонён. Видео также показывает обрезанную
кадром часть приветствующей ладони; это отдельное ограничение читаемости.
Повторный короткий реальный разговор воспроизвёл prepare-only без stroke. В коде
подтверждено: валидный typed выбор существует уже после planning, но удерживается
до первого prose. До изменения Main в architecture отдельно записано раннее
speech-bound preparation только для direct-answer без инструментов; PCM/cleanup
границы сохраняются. Никакой успех по prepare-only не засчитывается.

Последнее указание пользователя: камеру не трогать. Автоматическое расширение
отменено целиком, включая делегаты Avatar/Controller, helper и его тесты.
Проверка видимости остаётся строгой в неизменённом кадре: обрезанная ладонь
не превращается в PASS. Прогон с автоматическим расширением не квалифицирует
окончательную версию; требуется новый прогон без движения камеры.

## Реализованные исправления

- Kind фактически выбранного профиля определяет authority во всех четырёх путях
  resolver, включая cooldown fallback и semantic think → presence. Composer повторно
  проверяет именно применённый профиль; ожидающий gesture не подавляет presence.
- В существующем typed planning prompt разрешён уместный смысловой жест в обычном
  объяснении, сравнении и реакции. Второго semantic router нет.
- Direct-answer без инструментов может раньше начать только speech-bound preparation.
  Stroke по-прежнему ждёт consumed PCM; empty/failure/cancellation очищают предложение.
- Conversational qualification availability считается по подходящим разговорным
  профилям. Draft turn не дискредитирует qualified жесты и не становится доступным.
- Новый `--conversation-cases` не подменяет createReply и не вводит gestureHint.
  Фиксируются настоящие события LLM, PCM, фазы, final joints, raw Overlay hands,
  видимость пальцев, stage dynamics и camera invariance. Старые living fixtures
  явно обозначены transport/executor tests, не визуальной приёмкой разговора.

## Финальный прогон без движения камеры

Артефакты: `apps/desktop/motion/.artifacts/joint-2026-10-27T19-39-43-650Z/`.
Изолированное настоящее Electron Chat + Overlay, пользовательская VRM, реальный
Character LLM, Fish и ARDY; Preview не монтировался. Длительность 300.8 s.

| Сценарий | Настоящий hint / профиль | Final hand excursion | Движение в stroke | Результат |
| --- | --- | --- | --- | --- |
| Короткое общение | greeting / greet_wave_soft | 39.9 cm | 4.2 cm | Ответ и gesture execution есть; ладонь обрезана |
| Объяснение | explain / explain_one_palm | 36.4 cm | 2.0 cm | FAIL: видимость |
| Явное приветствие | greeting / greet_wave_soft | 39.2 cm | 3.9 cm | FAIL: видимость |
| Радостная реакция | celebrate / celebrate_petite | 38.9 cm | 3.6 cm | FAIL: видимость |
| Возврат к покою | think → presence | N/A | N/A | Ответ завершён, затем presence_poised / base |

Во всех четырёх gesture executions наблюдались prepare, stroke, hold, recover и
потребление настоящего PCM. Motion errors в этом прогоне — 0. Presence с gesture
authority — 0. Измеренный idle chest excursion — 10.1 mm. Последние 16 samples
за секунду: presence_poised, base, PCM ended. Позже добавленный автоматический
критерий returnedToPresence соответствует этому наблюдению; он не выдаётся за
отдельный заново запущенный прогон.

Камера за весь прогон: position delta 0, quaternion delta 0, FOV delta 0.
Raw Overlay hand excursion подтверждён, но visibleStrokeFraction = 0 у выразительных
кейсов: пальцы уходят за край неизменённого кадра. Это видно и на извлечённых stroke
кадрах. Общий report.passed = false; критерий не ослаблялся ради зелёного результата.

Raw MediaRecorder: 18 737 кадров, средние 62.28 FPS. Экспорт
`conversation-60fps.mp4`: H.264 60/1 FPS + реальное AAC audio, 300.782 s;
audio offset −14 ms, peak −9.1 dB. Синхронизированная trace находится в report.json.
Прогон с расширением камеры `joint-2026-10-27T19-29-41-216Z` superseded и не
квалифицирует выбранный пользователем вариант.

## Проверки и оставшиеся ограничения

- desktop:check, desktop:format:check, desktop:imports:check, typecheck, build — PASS.
  Biome содержит только три прежних info в нетронутом motion-ab/run.cjs.
- desktop:test:regression — 134 files / 617 tests PASS после отмены camera changes.
  Предыдущий запуск под одновременной нагрузкой build/live/checks получил timeout
  нетронутого turn test; отдельный полный запуск прошёл без изменения timeout.
- Рабочий клиент перезапущен из production build; окно Chat открылось, «Системы
  работают», выбранный Face сохранён. UI камеры не менялся. Живые avatar/speech
  проверки выполнены изолированным прогоном выше, не подменой пользовательского чата.

Визуальная читаемость в неизменённом узком кадре не принята. Natural/AAA качество и
сохранение художественной динамики на разных VRM не доказаны одной joint trace.
Ранее в двух retained прогонах был ARDY_AUDIBLE_UNDERRUN; его причина не установлена
и отдельное исправление не заявляется. Последующий успешный transport не закрывает
этот дефект. Повороты остаются draft; Fish, safety limits и release flow не менялись.
