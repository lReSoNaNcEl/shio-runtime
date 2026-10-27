# Реализация фазовых движений — 26 октября 2026

Статус: программная реализация, детерминированная проверка и частичная live-проверка. По последующему явному запросу пользователя выполнены реальные Electron/ARDY/Fish/LipSync/Blink checks; выявлены runtime и визуальные дефекты, описанные в [live-отчёте](LIVE-SPEECH-MOTION-2026-10-26.md). Полная художественная квалификация не выполнена; все 28 профилей имеют `qualification.state: draft`. Этот отчёт не заменяет каноническую архитектуру и не объявляет этапы визуальной приёмки завершёнными.

## Architecture Review

Реализация следует четырём planned motion/prompt/speech/secondary sections в `ARCHITECTURE.md`. Фазовый исполнитель находится в Body Animation Domain существующего Avatar Runtime; один Main-owned ARDY Adapter сохраняет отдельное окружение. AudioPlayer остаётся источником consumed PCM clock. Facial, gaze, ears/tail и Spring owners сохранены, Overlay получает готовую композицию. Speech HTTP 2.1 и stream protocol 2 не изменены. Новых Runtime, Action или произвольных avatar tools нет.

Архитектурное решение и исходный план уже были записаны до реализации. Исходное ревью и пользовательские рабочие изменения сохранены. Проверки baseline, исправление lifecycle, миграция контракта, prompting, подключение фаз и намеренная смена каталога выполнены последовательно в отдельных областях работы; это не behavior-preserving refactoring.

## Что реализовано

- Канонический motion contract v2: 28 новых стоячих профилей, две кисти и все пальцы в prepare/stroke/hold/recover, роли рук, normalized rig calibration, planted support/root policies, transition graph, ограничения вариаций и qualification. Нет сидения и старых clip/file записей. Производные pack и точный TS union синхронизируются из контракта.
- Строгий Main/worker handshake и проверка model/source/catalog/skeleton/format, execution/phase/revision, avatar generation, seed, clock/playback, continuity anchor и stride. Именованные heel/toe contacts ограничены диапазоном [0,1]. Worker сохраняет историю и использует phase conditioning и двусторонние foot end-effector anchors; semantic completion не объявляется worker.
- MotionPhaseExecution различает подготовку, акцент, удержание и возврат. Readiness не равна completion; diagnostics не меняет состояние. Завершение требует общего выхода кистей/пальцев и тела; failure/timeout/supersede/cancel не выдаются за completed.
- Все источники используют общий body executor. Pending intents ограничены двумя, истекают по catalog TTL и supersede по family. Защищённая фаза не блокирует speech/admission. Возможен проверенный direct continuation для совместимых рук при малой скорости; остальные маршруты используют достижимый recovery. Подготовка нового hand score начинается из фактически применённой формы.
- Реальный blend проходит до model port и влияет на композицию. Wrist refinement включён в общий target до smoothing; отдельного накапливающего writer нет. Пальцы и запястья используют общий phase progress без случайной независимой смены точной формы. Required finger chains проверяются для обеих рук.
- Preparation до audible start ограничена preparation. Речевые фазы и scheduler используют consumed source samples; buffering удерживает тело/кисти/пальцы. Producer complete не подменяет playback complete. Просроченный акцент не ускоряется вслед за речью. Recovery использует bounded local clock и не ждёт нового GPU horizon; генераторные результаты старой фазы отвергаются.
- Stop отменяет owned inference, отклоняет pending promises и инвалидирует старые callbacks. Визуальная отмена удерживает последнюю допустимую позу; Overlay не запускает собственный recovery/generator. После procedural composition выполняется body safety до единственного установленного VRM update path, включая Spring Bones.
- Character protocol v2 даёт ранний внутренний intent до safe text commit. Prompt, schema, final/incremental parsers и typed stream согласованы по одному semantic vocabulary. Late intent ограничен future-only/TTL; чужие turn callbacks не получают authority. Внутренние markers не выходят в chat, TTS/history. Emotion delivery не выбирает коммуникативный акт.
- Availability поступает от существующего Avatar owner через валидируемую health projection в Main Composer. Полный catalog/poses/hand curves в prompt не передаются; обязательный протокол сохраняется целиком при насыщении бюджета. Draft gestures доступны для ручного Preview, автоматический запуск требует qualified. Совместимое presence сохраняет технический fallback; наличие draft не означает художественной готовности.
- Spectrum 2 библиотека отделяет selected от running, содержит поиск/группы/availability, фазы, route, diagnostics, Play/variation/Stop/recovery, цепочки 3–5 намерений и камеры обеих кистей. Новые строки имеют RU/EN, presentation использует semantic theme tokens.
- Qualification tooling задаёт 28×12 фиксированных cases, VRM0/1, пять camera views, transition/preservation cases и нормированные thresholds. План и реальные evidence остаются раздельными; автоматическая фиксация кадров не объявляет художественную приёмку.

## Root Cause

Старый путь ARDY сохранял клиповую модель управления. Controller объявлял playing до readiness, diagnostic getter переводил его в idle, а queue принимала это за завершение. Blend терялся перед model port. Generic one-shot duration не проверяла возвращение рук. Речевой scheduler продвигался по render delta; точные finger poses зависели от старых profile ID и применялись к обеим рукам.

## Почему исправление работает

Readiness, phase и outcome теперь явные и привязаны к execution identity. Единственный body owner применяет выбранные часы ко всем каналам руки и проверяет выход. Main, worker и renderer отвергают несовместимые планы. Физически защищённый переход остаётся внутри Avatar и не задерживает независимые audio/facial owners.

## Файлы

Основные области: `contracts/motion.v1.json`, `scripts/sync-motion.mjs`, `apps/desktop/src/shared/motion`, `apps/desktop/motion`, `src/main/motion`, `src/main/character/prompting`, shared character-response/character-stream, renderer Avatar/body/hand/Preview и speech presentation ports. Регрессии находятся в `apps/desktop/tests/unit/avatar`, `tests/unit/character-response` и integration suites. Qualification находится в `apps/desktop/qualifications/speech-motion`.

## Проверки

Baseline до реализации: 14 файлов, 73 теста прошли. Итоговые проверки: TypeScript (Main/renderer/tests), build со speech assets verification, desktop:check, desktop:format:check, desktop:imports:check, motion:catalog:check и 42 Python-теста прошли. Полный итоговый regression: 108 файлов, 376 тестов прошли. Ранние нестабильные Browser Control прогоны повторены отдельно и в полном наборе; последний полный прогон успешен. Изменяемая область проходит diff whitespace check; общий git diff --check дополнительно отмечает существующую пустую строку на EOF в apps/api/README.md, который в этой работе не менялся.

После обратной связи пользователя экран дополнительно перестроен: компактный Spectrum ListView, отдельная правая карточка выбранного движения, высокий центральный viewport, одна причина ошибки с явным retry и недоступные Stop/recovery без активного исполнения. Все технические значения сохранены в сворачиваемой панели. Обновлены UI architecture guard и qualification selectors. Изолированный headless-стенд проверяет actual React component/CSS в светлой и тёмной темах на 1000, 1440 и 1920 px; контроллер и canvas в нём подменены, реальная модель не загружается.

Последующий live-разбор пользовательской дрожи выявил feedback между ограничителями и базовой позой. Исправление и непрерывные before/after измерения описаны в [отчёте стабильности](ANIMATION-STABILITY-FIX-2026-10-26.md). Узкая проверка трёх профилей проходит; художественная семантика всех движений по-прежнему не принята. Последний полный regression: 108 файлов, 381 тест прошёл.

## Ограничения и незавершённая приёмка

- Live Electron и реальные ARDY/Fish inference проверены в ограниченном сценарии. Четыре профиля sampled с seed 17; полная матрица 28×12, visual RU/EN semantic provider cases и художественная проверка целевых VRM0/VRM1 не завершены. Совместная Fish-нагрузка выявила `ARDY_AUDIBLE_UNDERRUN`; детали и измеренные задержки записаны в live-отчёте. Требования реальных Spring chains/colliders, костюма/волос/хвоста, foot drift и wrist/root seams ещё не подтверждены.
- Синтетические тесты проверяют controller/transport/composition, но не доказывают качество сгенерированной траектории или физики конкретной модели. Нормализованная калибровка и консервативные anatomical constraints не заменяют модельную приёмку костюма.
- Поэтому этапы 7–8 ТЗ по художественной квалификации и переключению qualified default остаются открыты. Профили не помечены qualified автоматически. Статус planned architecture не превращён в заявление о доказанных визуальных гарантиях.
- На первом этапе пользователь выбрал оставить код без live. После отдельного явного запроса live qualification запущена; ранний изолированный UI-стенд остаётся только проверкой layout и не подменяет реальные evidence.
- Коммит и публикация не выполнялись.
