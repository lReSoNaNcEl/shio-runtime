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
