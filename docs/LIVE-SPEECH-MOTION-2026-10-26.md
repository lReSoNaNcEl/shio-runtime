# Live-проверка TTS, ARDY, LipSync и Blink — 26 октября 2026

> Уточнение модели: runner наследовал пользовательский `vrmPath`, поэтому утверждение о bundled Green Fox в исходном описании неточно. Live использовал выбранную VRM0 с 51 humanoid bone, SHA-256 `bac0c6eb597e3840241f0d319f7cfeace0621a0b198129aa778fd76aba1a4fac`. Последующие исправления и повторная проверка документируются в `ANIMATION-QUALITY-RESULT-2026-10-26.md`; результаты этого старого прогона не переписываются как успешные.

Статус: проверка реального Electron, Fish S2 Pro и ARDY выполнена; общая приёмка **не пройдена**. Совместная нагрузка выявила `ARDY_AUDIBLE_UNDERRUN`. Работающий генератор и корректная передача пальцев не доказывают художественное соответствие жеста описанию.

## Architecture Review

Конфликта с канонической архитектурой нет. Один Main-owned ARDY Adapter использует отдельное motion-окружение; AudioPlayer владеет consumed PCM clock; AvatarExpressionMixer остаётся единственным финальным facial writer. Overlay получает готовую композицию. Самостоятельный Speech API и HTTP 2.1 / stream protocol 2 не изменены.

## Среда и изоляция

- Windows, Desktop `0.1.0-alpha.6`, Electron `43.1.1`, RTX 5090 32 GB.
- Реальный Fish S2 Pro на CUDA, ревизия `1de9996b6be38b745688de084d87a5633f714e4e`, source revision `541566932abbaebcb0a40e562a1f846738383f38`; API уже работал на `127.0.0.1:8000` до проверки.
- ARDY source `e706e27acc88070918308a10922b8f7174d0825e`, motion revision `9acbfc61f93fb5fd392019a7487c3d7bf4f74e6d`, Python 3.12.13, Torch 2.11.0+cu128. Source и model caches не редактировались.
- Целевая bundled-модель Green Fox. Проверялся реальный renderer и отдельное окно Overlay.
- Отдельный `userData` в `tmp/shio-joint-*`; настройки пользователя не менялись. В тестовом профиле Alive выключен. Тестовое приложение закрывается владельцем runner; существующий пользовательский API не останавливается.

## Что изменено

Во время live-проверки исправлены два несовпадения с pinned ARDY constraints: frame/joint index pairs должны оставаться на CPU, а CUDA constraint values — иметь `float32`. До исправления настоящий GPU warmup падал на смешении CPU/CUDA, затем Float/Double.

В body playback сохранены уже принятые горизонты при переключении на audible clock без смены физической фазы. Ожидание первой готовой порции новой фазы удерживает применённую позу; после реального underrun нет догоняющего скачка cursor. Восстановлен выход из завершённого recovery у loop presence. Техническое ожидание новой фазы показывается как `loading`; ошибки underrun продолжают регистрироваться.

Qualification runner дополнен component smoke, bounded blink evidence, снимками реальной речи, subset фиксированных seeds и проверками актуальных Spectrum-контролов. Ожидаемая отмена старого владельца при reload renderer больше не прерывает ожидание загрузки замены. Проверка не превращает это исключение в разрешение игнорировать ошибки inference.

## Root Cause

Подтверждённые причины устранённых сбоев: несовместимые device/dtype у pinned constraint API; очистка готовых горизонтов при одной лишь смене clock domain; ранний выход coordinator для любого loop presence, включая уже завершённое recovery.

Оставшийся сбой совместной нагрузки подтверждён живыми данными: после начала Fish PCM ARDY inference достигает 560.71 ms при горизонте 8 кадров / 400 ms. В этот момент появляется `ARDY_AUDIBLE_UNDERRUN`; единичное значение общего статуса Main `ready` не отменяет renderer error. Это доказательство пропуска срока в измеренном сценарии, а не завершённый анализ GPU scheduler.

## Почему фикс работает

Constraint API получает согласованные tensors. Clock switch сохраняет уже валидную физическую подготовку; смена самой фазы по-прежнему инвалидирует старые результаты. Recovery может вернуть presence в работу через существующий coordinator. Эти изменения не устранили все нарушения сроков под совместной Fish-нагрузкой, поэтому результат не объявляется полностью успешным.

## Файлы и evidence

- `apps/desktop/motion/backend.py`, `motion/tests/test_standing_constraints.py`.
- `apps/desktop/src/renderer/avatar/rendering/three/GeneratedBodyPlayback.ts`, `AvatarPlaybackCoordinator.ts`.
- `apps/desktop/tests/unit/avatar/{phase-playback-regressions,preview-playback,generated-motion}.test.ts`.
- `apps/desktop/qualifications/speech-motion/qualify.cjs`.
- `apps/desktop/motion/.artifacts/joint-2026-10-26T14-04-25-908Z/`: четыре профиля seed 17, пять камер, обе темы, фактические finger aggregates. Сам прогон прервался из-за прежней ошибки runner на reload; целиком успешным не считается.
- `apps/desktop/motion/.artifacts/joint-2026-10-26T15-07-47-726Z/`: повторный component smoke, реальные речь, LipSync, Blink и lifecycle; подробные метрики находятся в `report.json`.

## Проверки

`desktop:check`, `desktop:format:check`, `desktop:imports:check`, `typecheck`, `build` прошли. Focused Vitest: 22 файла, 117 тестов прошли; motion Python: 43 теста прошли. Ruff для изменённых Python-файлов прошёл.

Повторный component smoke завершился с `passed: false`: две реплики воспроизведены, но второй turn не содержал требуемого runner milestone `llm_connected`; сработал строгий отказ `No real Character provider stream`. Кроме этого, renderer сохранил `ARDY_AUDIBLE_UNDERRUN`. На длинной реплике consumed PCM составил 3 842 048 samples / 87.12 s, peak mouth 0.3294, max cue error 9.615 ms; на второй — 222 616 samples, peak mouth 0.2806. К концу наблюдения mouth вернулся к нулю. Runner прервался до трёх cancellation cases: их live-проверка не завершена и не объявляется успешной.

После пользовательского сообщения об изгибе и дрожи выполнена отдельная инструментальная проверка тела и исправление композиции. Сравнение baseline/after и точный scope находятся в [отчёте стабильности](ANIMATION-STABILITY-FIX-2026-10-26.md); этот результат не заменяет неуспешный joint Fish/ARDY smoke.

## Ограничения и визуальные дефекты

- `presence_poised`, `greet_wave_soft`, `explain_one_palm`, `peace_single` реально генерируются и потребляют кадры с seed 17. В Overlay присутствуют все 15 костей каждой кисти; у V-жеста различается форма указательного и безымянного пальцев. Это только техническая выборка.
- В просмотренных кадрах `peace_single` рука остаётся около бедра вместо плеча. У `greet_wave_soft` кадр stroke также не подтверждает обещанный подъём к плечу. Художественный pass не выставлен.
- Blink циклически возвращается к нулю, но наблюдаемый вес остаётся около 0.6; полное закрытие век не подтверждено. Параметры Blink в этой работе не менялись.
- Не выполнены 28×12 cases, отдельная матрица VRM0/VRM1, получасовой soak, полная проверка costume/hair/tail/colliders, измерения foot drift и семантическая приёмка всех профилей. Они остаются `draft`.
- Ненулевой mouth/RMS, consumed source samples и снимок рта подтверждают работу LipSync; это не фонетическая оценка точности висем и не экспертная оценка качества голоса на слух.
- Коммит, публикация и изменение qualification на `qualified` не выполнялись.
