# Отчёт о реализации: живость персонажа и логическое ядро Shio

Ветка: `experiment/shio-autonomous-living-v1`. Базовый коммит: `94d3d52`
(плюс коммит ТЗ `55db7ab`). Документ ненормативный: он фиксирует реализацию
по `docs/SHIO-LIVING-EXPRESSIVENESS-AND-CORE-TZ-2026-10-30.md` и не меняет
архитектурный смысл `ARCHITECTURE.md`.

Общие ограничения всей работы:

- Работа выполнена автономно, без пользователя. Live Electron smoke, живые
  клипы и метрики M1–M12 **не сняты**: для них нужны запущенные Electron,
  Fish S2 Pro, MotionBricks и реальные LLM-провайдеры, а также визуальная
  оценка пользователя. Все «Приёмка» по живым клипам остаются открытыми.
- Гейты G1–G4 не авторизованы. WI-7 (G4), WI-14 (G1), флаг G2 и всё, что
  относится к G3, не реализованы.
- `ARCHITECTURE.md` и `AGENTS.md` не менялись.

## WI-1 Атрибуция ограничителей и профиль выразительности

### Architecture Review

- Avatar Runtime остаётся единственным владельцем костей; probe только
  наблюдает и ничего не пишет в позу.
- AvatarExpressionMixer остаётся единственным facial writer
  (существующий guard `ownership.test.ts` зелёный).
- Новый канал diagnostics не создан: атрибуция живёт в renderer Debug Preview
  и через IPC/Health не проецируется. Сырые позы в агрегат не попадают —
  только безразмерные доли и счётчики.
- Физические ограничения (контакты, шарниры, калибровка торса, скорости)
  остались у своих владельцев и в профиль не перенесены.

### Что изменено

- `renderer/avatar/MotionAttenuation.ts`: порт `MotionAttenuationProbe`
  (`report(stage, channel, requested, applied)` + флаг `active`), no-op probe,
  `MotionAttenuationAggregator` (окно 1 с, ring buffer на 8192 отчёта на
  typed arrays, топ-3 ограничителя по каналу, счётчик потерянных отчётов).
- Инструментированы слои: `standing-arm-range`, `recover-rest` (оба места
  выбора позы покоя), `body-safety.workspace|contact|hinge`, `adaptive-filter`,
  `head-authority`, `expression-mixer` (рот и брови), `lipsync-clamp`.
  Все вызовы закрыты проверкой `probe.active`; в production ничего не считается.
- `AdaptiveMotionFilter` ведёт счётчики причин ограничения: потолок скорости
  presence (1,6), потолок `MOTIONBRICKS_CONVERSATION_MAX_JOINT_SPEED`, кадры
  генерируемой presence на спокойной полосе (8 вместо 28), ограничение ускорения.
- Debug Preview: раскрывающаяся секция «Атрибуция ограничителей» на Spectrum 2
  (`Switch`, `TableView`, `Meter`), RU/EN. Сбор включается переключателем и
  выключается при закрытии вида.
- `renderer/avatar/tuning/expressivenessProfile.ts`: художественные пределы
  в одном месте. Перенесены литералы `standingArmRange` и обеих поз покоя;
  `lipSync.clamps`, пределы головы и posture shift подключены ссылками на
  существующие tuning-источники (без копий). Поведение не изменено.

### Root Cause

N/A (инструментирование и извлечение без изменения поведения).

### Почему фикс работает

Каждый слой сообщает «сколько запрошено / сколько применено» в своей
естественной мере (угол, скорость, сумма весов, доля длины руки). Агрегатор
сводит это к доле сохранённого движения, поэтому слои сравнимы между собой.

### Файлы

`MotionAttenuation.ts`, `AdaptiveMotionFilter.ts`, `GeneratedBodySafety.ts`,
`GeneratedBodyPlayback.ts`, `StandingMotionStyle.ts`, `VrmModel.ts`,
`HeadMotionRuntime.ts`, `AvatarExpressionMixer.ts`, `LipSync.ts`,
`AvatarFacialRuntime.ts`, `AvatarController.ts`, `AvatarRuntime.ts`,
`Controller.ts`, `MotionAttenuationPanel.tsx`, `AvatarPreviewView.tsx`,
`expressivenessProfile.ts`, локализация RU/EN; тесты
`motion-attenuation.test.ts`, `expressiveness-profile.test.ts`,
`living-embodiment.test.ts` (architecture), дополнения в
`adaptive-motion-filter.test.ts`, `facial-acting.test.ts`,
`speech-head-motion.test.ts`.

### Проверки

`desktop:check`, `desktop:format:check`, `desktop:imports:check`, `typecheck`,
`desktop:test:fast` (299), `desktop:test:regression` (789), `build` — PASS.

### Ограничения

- Не проверял live: панель на живом клипе не смотрел, M12 не замерял.
- Коммит 2 «тюнинг по данным атрибуции» не сделан: без живых данных тюнинг
  был бы угадыванием. Кандидаты по коду: `restAfterAct.quiet.retainedFraction`
  (0,15), `standingArmRange.quiet`, спокойная полоса presence (8).
- Веса эмоций `FacialProfile` и амплитуды `MicroMotionController` в профиль
  не перенесены: это крупные таблицы, их перенос — отдельный механический шаг.
- Счётчики фильтра накопительные с момента attach, а не оконные.

## WI-2 Стиль подачи (Delivery Style)

### Architecture Review

- Avatar Runtime по-прежнему единственный владелец костей. Стиль — bounded
  числа, которые модулируют цели MotionBricks и procedural-слои; он не пишет
  кости и мимику.
- Часы речи не изменены: стиль переключается только на звуковой границе
  сегмента (существующий delivery cue `setSpeechDelivery`, вызванный по
  consumed PCM) и уходит в воркер только вместе с `speaking`-activity.
- MotionBricks остаётся единственным generated-body Adapter. Поле `style`
  строго валидируется с обеих сторон: zod `motionActivitySchema` (Main,
  `GeneratedMotionService`) и `activity.py` (ровно шесть осей, диапазоны из
  сгенерированного контракта, лишние ключи отклоняются).
- Mood модулирует только интенсивность подачи, не больше ±0,15 на ось, и
  берётся из существующего `AliveSnapshot.mood`. Нового store нет.
- `emotions.v3.json` и генерируемый API manifest не менялись.

### Что изменено

- `contracts/embodiment-style.v1.json`: шесть осей (`openness`, `height`,
  `tempo`, `sharpness`, `asymmetry` — `0..1`, `lean` — `-1..1`) для всех
  25 канонических эмоций, множители интенсивности и коэффициенты Mood.
- `scripts/sync-embodiment-style.mjs`: проверяет контракт против
  `emotions.v3.json`, генерирует `shared/embodiment/embodimentStyle.generated.ts`
  и `motionbricks/embodiment_style.json` (оси и нейтральный стиль). Режим
  `--check` подключён в `desktop:check`; root-скрипт `embodiment:sync`.
- `shared/embodiment/deliveryStyle.ts`: чистая `resolveDeliveryStyle(emotion,
  intensity, mood)` и zod-схема стиля.
- `targets.py`: выбор формы бита взвешен стилем (`openness` → open, `height`
  → lift, `sharpness` → press), разговорная база шире/выше по `openness`/
  `height`, амплитуда бита по экспансивности, длина блока 6–9 токенов по
  `tempo`, наклон press по `lean`, поворот торса и выбор ведущей руки по
  `asymmetry`. Нейтральный стиль байт-в-байт воспроизводит прежние цели
  (отдельный тест).
- Renderer: `HeadMotionRuntime` — удержание attention shift по `tempo` и
  ширина поворота по `openness` (±15–25%); `PostureShiftController` — наклон
  вовлечённости по `lean`. Стиль передаётся через `VrmModel.setDeliveryStyle`.
- Уши и хвост на стиль **не** переведены: у них есть свои emotion-таблицы
  (`EmotionEmbodimentProfile`, `earBehaviorTuning`). Дублировать их стилем
  ТЗ запрещает, а перевод таблиц — изменение поведения, которое нужно
  принимать визуально.

### Root Cause

N/A.

### Почему фикс работает

Раньше подача тела зависела только от энергии речи: радость и грусть давали
одинаковые биты. Теперь эмоция аудиального сегмента меняет высоту и ширину
базы, форму и темп битов, наклон и удержание взгляда.

### Файлы

`contracts/embodiment-style.v1.json`, `scripts/sync-embodiment-style.mjs`,
`shared/embodiment/*`, `shared/motion/index.ts`, `motionbricks/activity.py`,
`motionbricks/targets.py`, `motionbricks/embodiment_style.json`,
`GeneratedBodyPlayback.ts`, `VrmModel.ts`, `AvatarFacialRuntime.ts`,
`HeadMotionRuntime.ts`, `PostureShiftController.ts`,
`ProceduralMotionController.ts`, `AvatarController.ts`, `AvatarRuntime.ts`,
`Controller.ts`, `package.json` (оба); тесты `delivery-style.test.ts`,
`motionbricks-boundary.test.ts`, `generated-motion.test.ts`,
`speech-head-motion.test.ts`, `motionbricks/test_targets.py`.

### Проверки

Python: `unittest test_targets test_hand_prior test_standing_pose` — 24 OK;
Ruff check/format — OK. Desktop: `desktop:check` (с `sync-embodiment-style --check`),
`desktop:format:check`, `desktop:imports:check`, `typecheck`, `desktop:test:fast` (308),
`desktop:test:regression` (799), `build` — PASS.

### Ограничения

- Не проверял live. M2, M3, M11 не измерены. На синтетическом риге высота
  кисти между `height=0.1` и `0.9` отличается больше чем на 3 см, а длина
  блока между `tempo=0` и `1` — 9 против 6 токенов.
- Интенсивность эмоции в delivery cue не передаётся, поэтому используется
  `normal`.

## WI-3 Акценты речи из consumed PCM

### Architecture Review

- AudioPlayer остаётся единственным владельцем воспроизведения и PCM.
  Анализ тона живёт в его `PcmEnergyTimeline` — там же, где уже считается
  энергия отправленного PCM. Аудио после оценки не хранится, будущий PCM
  не предсказывается, ACK и прибытие метаданных часы не двигают.
- Отклонение от ТЗ по месту: в `ConsumedSpeechProsody` PCM недоступен, он
  получает только `clock.availableEnergy`. Поэтому F0 считается у владельца
  PCM, а `ConsumedSpeechProsody` передаёт поле дальше без изменений.
- Fish S2 Pro, HTTP API и `/tts/stream` не менялись; воспроизведение и
  стриминг TTS не тронуты.
- Поле `available.accent` строго валидируется в Main (zod: длина равна
  `energy`, значения `0..1`) и в `activity.py`.

### Что изменено

- `renderer/audio/PcmPitchAccent.ts`: `BinPitchEstimator` (упрощённый YIN на
  децимированном до ~11 кГц сигнале, окно ≤ 40 мс в начале каждого 50-мс бина,
  80–500 Гц) и `PitchAccentTracker` (подъём F0 над медианой последних
  озвученных бинов в полутонах, взвешенный одновременным ростом энергии).
- `PcmEnergyTimeline` отдаёт `accent[]`, выровненный с `energy[]`.
- `activity.py`: `available_accents()` — единый отбор уже доступных акцентов
  (энергетический пик или pitch-акцент ≥ 0,25), не раньше 580 мс и не после
  `finalSample`. `accent_deadline_ms` для stroke использует его.
- `targets.py`: конец разговорного бита (`talk_tokens`) сдвигается не больше
  чем на один native-токен от длины по темпу, чтобы попасть на сильнейший
  акцент в пределах ±120 мс; без акцента — длина по темпу.

### Root Cause

N/A.

### Почему фикс работает

Конец native-блока квантован шагом 4 кадра (133 мс). Выбор длины из трёх
соседних вариантов даёт попадание в акцент с ошибкой не больше ~67 мс, если
акцент вообще есть в окне.

### Файлы

`PcmPitchAccent.ts`, `PcmEnergyTimeline.ts`, `shared/motion/index.ts`,
`motionbricks/activity.py`, `motionbricks/targets.py`; тесты
`pcm-pitch-accent.test.ts`, `motionbricks/test_targets.py`.

### Проверки

Python: 27 тестов OK, Ruff OK. Desktop: полный набор раздела 7 PASS
(fast 314, regression 805, build). Бюджет CPU проверяется тестом: анализ 2 с
синтетического голоса укладывается в 0,3 мс на 10 мс аудио.

### Ограничения

- Не проверял live: M4 и M12 на реальной речи Fish не измерены. Порог
  pitch-акцента (1,5 полутона, 0,25) подобран на синтетике.
- Изменение поведения: разговорные биты теперь подстраиваются и под
  энергетические пики (раньше только stroke).

## WI-6 Жизнь в простое

Два коммита: сначала извлечение общего helper подавления без изменения
поведения, затем политика idle-активностей.

### Architecture Review

- Семантику idle-активности выбирает Main (`IdleActivityPolicy` в составе
  `BehaviorRuntime`). Renderer только исполняет команду: держит взгляд
  ограниченное время и запускает один жест каталога.
- Новый IPC-канал не создан: используется существующий `alive:behavior`
  с `BehaviorCommand` и embodiment intent. Добавлены два bounded поля:
  `idleActivityId` и `holdMs`.
- Idle-активность не запрашивает разговор и не проходит Conversation
  Admission: это nonverbal presentation, а не initiative.
- Подавление общее: Suspend, Privacy, Off, quiet hours, активный разговор,
  звук и browser screen focus. Helper `autonomySuppression.ts` теперь
  используют `BehaviorRuntime`, `AmbientPresencePolicy` и `AutonomyEnvelope`
  (во всех трёх было по копии `insideQuietHours`).
- Overlay ничего не запускает: жест выполняет только primary window через
  `ConversationPresentationPort.playIdleActivityGesture`, а Overlay получает
  готовую проекцию.
- Политика чистая: random source инжектируется (`seededRandom` для тестов),
  время приходит с входом. `Date.now()` и `Math.random()` внутри политики
  не вызываются.

### Что изменено

- `autonomySuppression.ts`: `autonomyPolicyStop` (с прежним порядком причин),
  `autonomyBusyStop`, `insideQuietHours`.
- `IdleActivityPolicy.ts`: registry-данные (`look-around`, `look-at-screen`,
  `glance-at-user`, `curious-lean`, `stretch-small`) с частотой, весами Mood,
  минимальной длительностью тишины, cooldown и hold. Пуассоновское
  расписание с жёсткими границами: не чаще раза в 8 с и не реже раза в 25 с
  при нейтральном настроении (20–45 с в зависимости от Mood). Mood меняет
  общую частоту в пределах 0,5–1,5×; при низком arousal активностей меньше.
  Одна активность не повторяется подряд.
- `AliveFacade.updateWorld` (раз в 5 с от renderer): сначала ambient presence,
  затем idle-активность. Idle-команды не пишутся в audit, иначе таблица
  `alive_audit` росла бы каждые несколько секунд.
- Renderer: `AliveExperienceRuntime` исполняет idle-команду (взгляд на
  `holdMs`, ограниченный 0,5–10 с, затем освобождение; таймер снимается при
  dispose и новой команде). `AvatarController.playIdleActivityGesture` играет
  жест только в режиме idle, при наличии в `EmbodimentAvailability` и только
  для профилей вида `gesture`. Общая с реакциями логика возврата вынесена
  в `playReactionWithReturn`.

### Root Cause

N/A.

### Почему фикс работает

Раньше видимые действия в простое возникали только при изменении World
Context (ambient presence с cooldown 30 с) или по редкому таймеру renderer.
Теперь Main-политика гарантирует видимое действие хотя бы раз в ~25 с
при нейтральном настроении.

### Файлы

`autonomySuppression.ts`, `IdleActivityPolicy.ts`, `BehaviorRuntime.ts`,
`AmbientPresencePolicy.ts`, `AutonomyEnvelope.ts`, `AliveFacade.ts`,
`shared/alive/contracts.ts`, `AliveExperienceRuntime.ts`,
`ConversationPresentationPort.ts`, `AvatarRuntime.ts`, `AvatarController.ts`;
тесты `autonomy-suppression.test.ts`, `idle-activity-policy.test.ts`,
`alive-initiative-admission.test.ts`.

### Проверки

Полный набор раздела 7 PASS: fast 331, regression 823, typecheck, build.

### Ограничения

- Не проверял live, M7 не измерен. По симуляции на 5-секундных тиках
  самый долгий промежуток не больше 30 с.
- Из стартового набора ТЗ не сделаны «перенос веса», «взмах хвостом» и
  «зевок». Для них нет embodiment intent в общем словаре, а перенос веса и
  движение хвоста уже идут procedural-слоями renderer постоянно. Зевку нужен
  новый motion-профиль и лицевой акт.

## WI-5 Слушание и «думание»

### Architecture Review

- Второго `getUserMedia` нет: уровень берётся из существующего
  `MicCapture` (RMS блока, без хранения аудио). Continuous listening
  использует события VAD `speech_started` уже работающего streaming ASR.
- Реакции чисто просодические: ASR-текст не используется нигде
  (`UserSpeechActivity`, `UserProsodyBackchannelPolicy`).
- Мимику по-прежнему пишет только Mixer: подтверждение — короткий слой
  в `FacialActingController`, который уходит в Mixer как обычный acting.
  Голову двигает `HeadMotionRuntime` через его impulse-механизм.
- Реакции не допускают разговор и не меняют Character State: они идут через
  `ConversationPresentationPort` (contained), не через writers.
- Suspend и Privacy Mode глушат все реакции слушания; во время речи Shio
  кивков нет.

### Что изменено

- `renderer/speech/listening/UserSpeechActivity.ts`: порт
  `UserSpeechActivitySource` и `UserSpeechActivityMonitor` (VAD по RMS
  с адаптивным порогом шума, одно onset-событие на высказывание, разрыв
  больше 700 мс — новое высказывание).
- `UserProsodyBackchannelPolicy`: чистая политика. Пауза 250–600 мс после
  ≥ 1,2 с речи даёт одно подтверждение, cooldown 2–4 с из инжектированного RNG.
- `UserSpeechReactionCoordinator`: связывает источник, политику и узкий sink
  презентации; идемпотентный `dispose`.
- Avatar: `reactToUserSpeechOnset` (ear impulse `direct-address` и подъём
  головы `speech-onset`), `acknowledgeUserSpeech` (кивок `backchannel-nod`
  и мимическое подтверждение). Новые импульсы головы — данные
  в `headMotionTuning.listeningImpulses`; прерывание пользователем вытесняет
  их.
- `SpeechInputRuntime`: подключает монитор к `MicCapture` и событиям ASR,
  снимает подписки в `dispose`. `Controller` передаёт подавление из
  `AliveSnapshot.settings`.

### Root Cause

N/A.

### Почему фикс работает

Блок `MicCapture` ~85 мс, поэтому onset-реакция запускается в пределах
одного-двух блоков после начала голоса. Это укладывается в цель 150 мс
без сетевой задержки ASR.

### Файлы

`micCapture.ts`, `UserSpeechActivity.ts`, `UserProsodyBackchannelPolicy.ts`,
`UserSpeechReactionCoordinator.ts`, `SpeechInputRuntime.ts`, `Controller.ts`,
`ConversationPresentationPort.ts`, `AvatarRuntime.ts`, `AvatarController.ts`,
`VrmModel.ts`, `AvatarFacialRuntime.ts`, `FacialActingController.ts`,
`HeadMotionRuntime.ts`, `motionTuning.ts`; тесты
`tests/unit/speech/listening-reactions.test.ts`, дополнения в
`speech-head-motion.test.ts` и `facial-acting.test.ts`.

### Проверки

Полный набор раздела 7 PASS (fast 341, regression 833, typecheck, build).

### Ограничения

- Не проверял live, M5 и M6 не измерены.
- Думание: режим `thinking` уже включается при распознавании (push-to-talk)
  и в начале хода LLM, вместе с `thinkingDrift` и ear impulse
  `thinking-entry`. Гистерезис 400 мс не добавлен. Переход
  listening → thinking → speaking монотонный, поэтому мерцать нечему, а
  задержка входа в thinking потребовала бы менять тайминг Character State.
- В continuous listening backchannel не работает: уровни `StreamingPcmCapture`
  не подключены, есть только onset по VAD сервера. Keypose «рука к подбородку»
  зависит от WI-4 и не сделан.

## WI-8 Эмоциональная петля: оценка хода

### Architecture Review

- Experience Policy остаётся детерминированным источником базовой оценки.
  Оценка модели — только bounded модификатор: сдвиг умножается на
  `confidence` и ограничен ±0,5 по каждой оси. Без оценки результат
  байт-в-байт прежний (тест).
- Поле добавлено в существующий planning-вызов (тот же Character LLM,
  дополнительного запроса нет). Обе транспортные формы — JSON Schema и
  native tool — получают его из одной схемы `characterToolPlanningResultSchema`.
- Оценка не попадает в чат, историю, renderer и diagnostics. Путь: Tool Loop
  → Orchestrator → `MainConversationTurnService` → `AliveFacade` (в памяти
  процесса, по `turnId`, не больше 16 записей, TTL 5 мин). Применяется,
  когда renderer сообщает `conversation-completed` того же хода. IPC-ответ
  renderer строится из явных полей и её не содержит (contract-тест).
- Только явные пользовательские ходы: autonomous-ходы оценку не передают,
  failure-презентации тоже (`assistantTurnKind !== 'character'`).
- Relationship не затронут (гейт G3). Mood меняется только через
  существующий `MoodRuntime.apply`.

### Что изменено

- `shared/character-tools`: `turnAppraisalSchema`
  `{valence, arousal, socialRelevance, novelty, confidence}`.
- `CharacterToolRequirementPlanning.ts`: поле в `CharacterToolPlanningResult`,
  отдельный разбор в `parseToolPlanningValue` (невалидная оценка
  отбрасывается, план остаётся валидным), одна строка смысла в planning prompt.
- `CharacterToolLoop.ts`: только переносит разобранную оценку в результат.
- `ExperiencePolicy.ts`: `applyTurnAppraisal` для `conversation-completed`.
- `TurnAppraisalRegistry.ts` и `AliveFacade.recordTurnAppraisal`.
- `MainConversationTurnService`: callback `onTurnAppraisal` для явных ходов,
  подключён в `buildApplicationDependencies.ts`.

### Root Cause

`conversation-completed` всегда давал valence 0,25 и arousal −0,1 независимо
от содержания разговора, поэтому Mood не различал похвалу и подкол (M8).

### Почему фикс работает

Character LLM уже семантически классифицирует ход в planning. Тот же вызов
отдаёт числовую окраску, а детерминированная политика сдвигает базовую
оценку в её сторону с ограничением.

### Файлы

`shared/character-tools/contracts.ts`, `CharacterToolRequirementPlanning.ts`,
`CharacterToolLoop.ts`, `orchestrator.ts`, `ExperiencePolicy.ts`,
`ExperienceRuntime.ts`, `TurnAppraisalRegistry.ts`, `AliveFacade.ts`,
`MainConversationTurnService.ts`, `buildApplicationDependencies.ts`; тесты
`turn-appraisal-planning.test.ts`, `turn-appraisal.test.ts`,
`turn-appraisal-boundary.test.ts`, `character-tool-requirement.test.ts`.

### Проверки

Полный набор раздела 7 PASS (fast 352, regression 845, typecheck, build).

### Ограничения

- Не проверял live: M8 (5 похвал против 5 подколов) и M10 на реальных
  моделях не измерены. Модели могут не заполнять необязательное поле.
- Planning ограничен 300 токенами; оценка добавляет около 25 токенов.
  Полный план с оценкой укладывается в лимит 2000 символов с запасом (тест).
