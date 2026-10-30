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
