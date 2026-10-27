# Ревью архитектуры анимаций и новый пресет для Shio

Дата: 26 октября 2026 года.

Статус: архитектурное ревью текущего рабочего дерева, художественный пресет и план реализации. Целевое решение сначала записано и сверено в каноническом [ARCHITECTURE.md](../ARCHITECTURE.md#planned-phased-motion-composition), затем с ним сверён этот план. Контракты помечены как запланированные; Runtime-код и фактическое поведение клиента этим Work Item не меняются.

Главная рекомендация — перейти от выбора независимых «анимаций» к исполнению связанных движений с предусловиями, фазами и проверяемым выходом. ARDY уже заменяет VRMA как источник движения, но управление всё ещё во многом описывает клипы: ID, цикл, длительность смешивания и переключение на fallback. Этого недостаточно для последовательного поведения тела.

Новая библиотека должна содержать 28 заново спроектированных намерений для стоящей девушки Vtuber. Для каждого движения обязательна согласованная хореография рук, кистей и пальцев во всех фазах. Сидение, посадка и подъём исключены из объёма реализации. Старые названия, категории, количество записей и семантические соответствия не являются ограничением нового пресета.

Переработка должна связывать эти движения с существующим streaming TTS Fish Audio S2 Pro через читаемые типизированные контракты, общий речевой playback clock и явный lifecycle. Существующая бизнес-логика ушей и хвоста, Spring Bones, Blink, Speaking Eye, gaze и LipSync входит в обязательную матрицу сохранения поведения.

В репозитории, локальных закреплённых исходниках и на скриншоте используется **ARDY**. Обозначения ARNY и ASNY из запросов ниже трактуются как ARDY. Первый референс задаёт художественное направление; второй показывает текущую библиотеку и интерфейс. Иллюстрация не подтверждает устройство VRM-рига, наличие костей пальцев или физику одежды.

## Architecture Review

### Текущая цепочка исполнения

```text
Character State и ограниченный CharacterEmbodimentIntent
    → AvatarStateMachine и AvatarBehaviorEngine
    → AvatarBehaviorResolver
    → AvatarIdleOrchestrator / AvatarSpeakingGestureScheduler
    → AvatarPlaybackCoordinator и AvatarAnimationQueue
    → AvatarAnimationController
    → VrmModel и GeneratedBodyPlayback
    → типизированный Motion IPC
    → Main-owned ArdyMotionService
    → отдельный Python worker и ArdyBackend
    → 8 кадров Core27 при 20 FPS
    → retargeting, сглаживание, ограничения, стопы, пальцы
    → procedural contribution
    → проекция тела для Overlay
```

Каталог берётся из `contracts/motion.v1.json`; `scripts/sync-motion.mjs` копирует его в `apps/desktop/motion/motion-profiles.json`. Shared Motion читает эту производную копию, а renderer manifest предоставляет совместимый с прежней библиотекой интерфейс. Сейчас в каталоге 39 профилей. Удалённые VRMA и новые motion-файлы находятся среди уже существующих незакоммиченных изменений. Ревью относится к их текущему содержимому, а не к чистому HEAD.

### Границы которые нужно сохранить

| Область | Текущий владелец и решение |
| --- | --- |
| Смысл жеста | Character LLM и существующие типизированные проекции поведения. Не добавлять разбор реплик по словам «привет», «сядь», «грустно» для выбора анимации. |
| Физическое исполнение | Avatar Runtime в renderer. Поза, фаза, переход и финальная композиция остаются внутри body domain. |
| Генератор | Один Main-owned `ArdyMotionService`, один отдельный motion environment, закреплённые исходники и веса. |
| Время речи | Реально потреблённые source samples AudioPlayer. Сетевой ACK и приход чанка не означают, что звук прозвучал. |
| Лицо | `AvatarExpressionMixer`. Генеративное тело не получает head/neck, eyes, jaw, expression и viseme authority. |
| Голова и взгляд | Существующие Head/Gaze owners. Согласие может включать их вклад, но не возвращать голову в body mask ARDY. |
| Волосы уши хвост | Существующий secondary-motion domain. Художественный пресет не должен напрямую писать эти кости из внешнего Runtime. |
| Overlay | Потребитель уже скомпонованного тела. Второй генератор, собственная последовательность body-жестов и повторное дыхание не нужны. |
| Speech API | Независимый ASR/TTS-сервис. Переработка анимаций не требует менять HTTP 2.1 или `/tts/stream` protocol 2. |
| Character State | Единственный источник семантического состояния. История кадров, очередь и план перехода остаются внутренними данными Avatar Runtime. |
| Action Runtime | Визуальные движения персонажа остаются embodiment. Для них не требуется новый внешний Action или Permission Guard flow. |

Новый Motion Runtime не нужен: граф и исполнение движений относятся к уже существующему Body Animation Domain. Новые внутренние типы и компоненты ниже — декомпозиция этой ответственности.

Архитектурный смысл задают только разделы `Planned phased motion composition`, `Planned Character LLM embodiment prompting`, `Planned streaming speech and motion timing` и `Planned secondary motion and facial continuity` в `ARCHITECTURE.md`. Описания ниже раскрывают их применение к плану и пресету, но не вводят отдельные гарантии или владельцев. При расхождении сначала исправляются каноническое решение и сверка плана; зависимый код до этого не меняется.

### Сквозная координация ARDY и streaming TTS S2 Pro

Связанность означает согласованные контракты и порядок событий между существующими владельцами. Controller, Speech Runtime или новый «универсальный coordinator» не должны поглощать AudioPlayer, Avatar Runtime, facial domain и secondary-motion domain.

```text
Admitted turn и ограниченный semantic embodiment intent
    ├─ safe incremental text commit и typed delivery
    │    → SpeechOutputPort / существующий Speech transport
    │    → Speech API / один cancellable Fish S2 Pro worker
    │    → проверенные metadata + PCM пары
    │    → AudioPlayer / consumed source-sample clock
    │         ├─ LipSync и audible delivery cues
    │         └─ речевые фазы ARDY body + hand scores
    └─ Avatar Runtime / проверенный motion intent
         → один Main-owned ARDY service и worker
         → bounded horizons
         → body и hand composition

Avatar Runtime объединяет body, head/gaze, facial и secondary contributions
    → единственный установленный VRM update path
    → presentation и существующие проекции Overlay
```

Зафиксировать следующие события и состояния в существующих ports, без второго speech/motion state store:

| Этап | Требование к согласованности |
| --- | --- |
| Подготовка turn | Intent можно подготовить до первого звука. Движение рук до речи ограничено preparation; речевой акцент не считается прозвучавшим. |
| Первый PCM | Получение пакета означает наличие данных. `onFirstPcm`, transport ACK и готовность generator не объявляют audible start. |
| Фактический старт playback | Используются актуальные turnId/playbackId и source-sample cursor AudioPlayer. Речевые body/hand phases, LipSync и delivery cues относятся к этому playback. |
| Продолжение stream | Чанки не создают новые жесты, LipSync session или повторное приветствие. Приход следующего пакета не сбрасывает подготовку пальцев, рот или позу ушей. |
| Delivery boundary | Эмоция подачи и разрешённый акцент применяются на consumed sample boundary. Они не перезаписывают conversational emotion и не вызывают вторую независимую реакцию на тот же cue. |
| Buffering | Речевой body/hand cursor и связанные cues удерживаются. LipSync получает реальное отсутствие звучащей энергии и допускает ограниченный release рта; моргание, взгляд и физика продолжают работать. |
| ARDY опоздал или недоступен | Звук и LipSync продолжаются через своих owners. Avatar удерживает/восстанавливает допустимое тело и показывает degraded; просроченный жест не «догоняет» прошедшую реплику. |
| Provider complete | Это конец producer, а не конец слышимого звука. AudioPlayer доигрывает очередь; не закрывать mouth и не возвращать руки в idle по одному сообщению complete. |
| Последний PCM потреблён | Завершается речевая артикуляция, запускается ограниченный body/hand recovery на явно выбранном local clock. Конец звука и конец телесного жеста имеют разные outcomes. |
| Cancel или ошибка | Немедленно инвалидируются старые PCM/cues и generation identity; каждый владелец отменяет собственную фактическую работу. Пальцы, рот и recovery не принимают поздние callbacks прежнего turn. |
| Settlement | Conversation Admission сохраняет Single-Flight до обязательного cleanup/settlement. Декоративный хвостовой sway и естественное моргание не являются бесконечным speech cleanup и не блокируют следующую реплику. |

Существующий S2 Pro transport сохраняет HTTP 2.1, `/tts/stream` protocol 2, mono Float32 LE 44,1 кГц, sample counts/offsets, порядок sequence, bounded credit/backpressure и реальную отмену inference. ARDY не подключается к API implementation или его окружению. Замена анимационного каталога не требует изменения speech wire contract.

Сквозная связь использует существующие turnId/playbackId и отдельный motion execution/phase ID, связанные проверяемой проекцией. Она не означает, что turnId, TTS session и ARDY lease должны стать одним идентификатором или жить в одном хранилище. Обязательны runtime validation на IPC и отбрасывание stale generation/cue по каждой соответствующей границе.

Привязка к PCM гарантирует согласованное время, но сама по себе не даёт точных времён каждого слова и каждой фонемы. Текущий LipSync анализирует audio playback и использует phrase timing; в плане нельзя подменить это обещанием готового forced alignment. Речевые акценты используют доступные типизированные audible cues и ограниченное планирование. Не добавлять keyword router или вычисление «точного» акцента только из длины текста и скорости сети.

### Сохранение ушей хвоста Spring Bones и лица

Текущий порядок виден в `VrmModel.update()`: снять прошлый procedural contribution → применить generated body → обновить procedural/head/gaze/ear/tail contributions → скомпоновать лицо → `vrm.update(delta)`. В установленном `@pixiv/three-vrm` этот последний вызов обновляет humanoid, LookAt и expressions, затем node constraints и Spring Bones. Это важный integration contract, а не случайная последовательность вызовов.

`EarBehaviorRuntime` уже содержит собственные профили, emotion modifiers, импульсы, cooldown, асимметрию и калибровку осей; discovery оставляет root-most ear bones, чтобы не вращать цепочку повторно. `TailBehaviorRuntime` добавляет ограниченные профильные/emotion offsets и умеет снять собственный предыдущий вклад. При обновлении новой библиотеки эти алгоритмы и настройки сохраняются. Наличие runtime-логики поверх костей не означает, что сам Spring solver понимает настроение или выбирает жест.

| Канал | Сохраняемый владелец | Правило для новой библиотеки |
| --- | --- | --- |
| Уши | `EarBehaviorRuntime` | Профиль, эмоция, bounded semantic impulse и его дедупликация остаются у существующего owner. ARDY и hand score не пишут ear bones, не сбрасывают ear rest pose при каждом жесте. |
| Хвост | `TailBehaviorRuntime` | Сохранить profile weights, emotion scale/bias, limits, offset removal и model-swap cleanup. Новый жест не запускает второй tail controller. |
| Spring Bones | VRM-owned spring manager | Сохранить цепочки, colliders, stiffness/drag/gravity и установленный порядок solver. Не выключать физику ради устранения конфликта и не выполнять второй spring update в том же model frame. |
| Blink | `BlinkController` через `AvatarExpressionMixer` | Сохранить effective profile, зависящий от mode и emotion, частоту, полное закрытие/открытие и отсутствие застревания. Body gesture и audio buffering не обнуляют blink. |
| Speaking Eye | `SpeakingEyeController` через mixer | Сохранить малый squint и его совместимость с Blink. Не превращать его в второго writer век. |
| Глаза и голова | Gaze arbiter, `LookAtRuntime`, `HeadMotionRuntime` | Сохраняются camera/user/screen приоритеты и suppression procedural head. ARDY mask не расширяется на head/neck/eyes. LookAt-owned направления глаз не обнуляются facial mixer. |
| LipSync и mouth release | `LipSync`, phrase/closure contributions и `AvatarExpressionMixer` | Источник — фактический AudioPlayer playback. Preserve articulation, silence handling и bounded release. Ни один body/hand preset не пишет jaw, visemes или facial values напрямую. |
| Эмоциональное лицо | `ExpressionController` и `AvatarExpressionMixer` | Сохранить композицию emotion, Blink, Speaking Eye и mouth; runtime availability и body phase не создают альтернативный expression store. |

Разделить два временных домена явно. Речевые body/hand phases и audible cues следуют source-sample cursor. Blink, ambient ear/tail behavior, gaze smoothing и Spring simulation используют ограниченный local monotonic delta. Речевые modifiers вторичных каналов могут реагировать на актуальный audible cue, но не замораживают весь secondary-motion domain вместе с речевым курсором. Физическое запаздывание кончика хвоста допустимо и не является рассинхронизацией пальцев.

Перед изменениями зафиксировать реальную карту костей модели: какие кости принадлежат body, wrist/fingers, ear/tail semantic offset и какие участвуют в spring chains. Для пересечений сохранить и проверить существующую композицию управляющей позы и последующего solver. Нельзя автоматически записывать одинаковый offset в root и все дочерние spring bones или восстанавливать rest pose поверх результата physics после `vrm.update`. Проверка на упрощённой сцене без настоящих spring chains не подтверждает эту совместимость.

В кадре должен оставаться один путь обновления каждого владельца. Условные стадии композиции не разрешают ручные дополнительные `humanoid.update`, `expressionManager.update` или `springBoneManager.update` рядом с `vrm.update`. Bounded final validation проверяет позу, не создавая второго bone writer после spring solver. Если карта костей обнаружит реальный конфликт старых контроллеров с physics, это отдельный bugfix с RCA и baseline, а не скрытая смена поведения внутри новой библиотеки.

Stop body gesture, TTS cancel и смена профиля не выполняют общий `resetAvatar`: они завершают только принадлежащие им каналы. Model replacement/shutdown освобождают все ссылки, listeners и предыдущие offsets через idempotent teardown существующих owners. После восстановления не должно быть двух подписок на PCM clock, удвоенного движения ушей/хвоста или накопления rotation offsets.

Для Overlay сохраняется действующее разделение: composed body/fingers/chest и mouth presentation приходят из основной проекции, а собственные facial/gaze/secondary presentation paths остаются в установленной политике. Каждый экземпляр VRM выполняет один собственный physics update; это не второй ARDY generator. Не передавать уже просимулированные raw spring transforms, чтобы затем повторно симулировать их как исходную позу. Если понадобится точное визуальное совпадение вторичной физики двух окон, это отдельное явное решение о presentation contract, а не дополнительная независимая бизнес-логика.

### Требования к качеству связующего кода

Критерий качества — возможность проследить конкретный turn от text commit и первого audible sample до motion outcome и cleanup по типизированным границам. Требуются:

- Разделённые по ответственности catalog validation, motion selection, phase execution, transition planning, rig retargeting, hand composition, speech transport и playback clock. Существующие owners переиспользуются; один класс не получает все эти роли.
- Явные discriminated unions для preparing/playing/buffering/recovering/terminal и typed outcomes. Debug getters не меняют lifecycle; readiness не выводится из отсутствия кадра или соседнего health status.
- Чистые детерминированные функции выбора допустимого перехода и bounded вариаций. Генератор переводит constraints в движение и не выбирает смысл жеста; UI не дублирует политику доступности.
- Явная связь execution/phase/generation в callbacks, один наблюдаемый путь cancellation и idempotent cleanup. Не использовать набор несвязанных booleans, таймеры на каждый PCM packet и fire-and-forget Promise без rejection observer.
- Ограниченные очереди, TTL, backpressure и bounded projections. Никакого накопления полного аудио, raw poses, transcript или worker output в diagnostic/state store ради синхронизации.
- На каждой стадии понятные input/output contracts и причины отказа. Бизнес-решения не прячутся в render loop, JSX, IPC handler или Python inference Adapter.
- Осмысленные имена по роли и фазе, короткие функции с одним переходом/преобразованием, комментарии о причинах порядка и инвариантов. Не добавлять фасады и абстракции без конкретного потребителя в этой цепочке.
- Отдельные behavior-preserving extraction, bugfix и intentional behavior change. Старые настройки ушей/хвоста/Blink/LipSync сохраняются до намеренно обоснованного отдельного изменения.

Новый пресет не считается завершённым по наличию красивых prompts или passing build. Готовность требует согласованного исполнения всей цепочки и пройденной матрицы сохранения существующих каналов.

### Что уже работает как полезная основа

- Worker сохраняет до 40 кадров авторегрессионной истории. При обычной смене профиля меняется conditioning в продолжающейся сессии; генерация не обязана начинаться с нуля.
- Результаты ограничены по размеру и связаны с session, epoch, model generation, profile и seed. Renderer проверяет принадлежность результата актуальному запросу.
- Motion IPC проверяет отправителя и payload; renderer не передаёт произвольный prompt, путь к Python или команду процесса.
- Renderer применяет VRM0/VRM1 преобразования, ограничения локтей и коленей, приблизительную защиту рук от торса и устойчивое направление коленей при foot planting.
- Во время речи body cursor следует PCM; при неизменном sample offset генеративная поза не продолжает двигаться по render delta.
- Пальцы — честно обозначенный процедурный вклад, а не обещание neural finger generation от Core27.
- Overlay получает тело, пальцы и chest translation после body procedural composition. У него нет второго ARDY-процесса.
- Доступны bounded diagnostics и отдельный live qualification runner. Их нужно расширять, сохраняя существующие проверки.

## Найденные проблемы

Приоритет P1 означает, что проблему следует закрыть до включения нового пресета по умолчанию. P2 — необходимая часть целевой переработки. Указанные строки относятся к рабочему дереву на дату ревью.

### P1 Очередь может завершить жест до первого кадра

`AvatarAnimationController.ts:164–167` устанавливает активный ID и `playbackStatus = 'playing'` перед ожиданием `requestGeneratedMotion`. Пока первый чанк не готов, `GeneratedBodyPlayback.isAnimationPlaying()` возвращает false. Вызов `getDebugState()` в `AvatarAnimationController.ts:192` превращает такой статус в `idle`.

`AvatarPlaybackCoordinator.ts:254` считает одноразовый элемент завершённым, если playback не активен и статус не `loading`. В результате fallback может заменить ещё готовящийся жест.

Это воспроизведено отдельно от GPU: для отложенного `requestGeneratedMotion` запрос `acknowledge` сменяется на `neutral_idle` при следующем `advanceQueue`, хотя ни один generated frame ещё не готов. Существующие тесты этот сценарий не ловят.

Нужно сохранять `preparing` до готовности исполнения и продвигать очередь по типизированному terminal outcome конкретного motion execution. Loading, underrun, failure и semantic completion должны различаться.

### P1 Длительность перехода не управляет генеративным playback

`AvatarTransitionPolicy.ts` рассчитывает 0,2/0,6/0,7 секунды для разных переходов; Coordinator передаёт их в `playManifest`. Однако `AvatarAnimationController.ts:167` не передаёт `blendDuration` дальше. В `VrmAnimationLoadContext` такого поля нет. `GeneratedBodyPlayback.ts:416` использует одну экспоненту `1 - exp(-18 * elapsed)`.

Проверка с отложенным renderer playback подтвердила: запрошено 0,8 секунды, в debug записано 0,8, downstream context не содержит длительности. Сглаживание существует, но рассчитанная политика фактически не применяется. `transitionRemaining` в generated diagnostics всегда равен нулю (`GeneratedBodyPlayback.ts:679`).

Нужен исполняемый transition plan с реальной длительностью, фазой, конечной позой и фактическим remaining time. Одно изменение коэффициента экспоненты не обеспечит логическую связность действий.

### P1 У всех одноразовых действий одинаковое искусственное завершение

В `GeneratedBodyPlayback.ts:276` установлен `oneShotEnd = cursor + 64`: при 20 FPS это 3,2 секунды для любого профиля. В `:386` достижение курсором этой границы выключает playback; нет проверки, закончен ли взмах и опущена ли рука. Отсчёт начинается при запросе, включая ожидание смены профиля в уже работающей сессии.

Длинный поклон и короткий знак согласия не должны иметь одинаковый смысловой конец. Профилю нужны фазы подготовки, основного движения, удержания и возврата; исполнителю — bounded temporal gates и проверяемый выход. Истечение бюджета должно давать `timed-out` или `degraded`, а не успешное завершение.

### P1 Нет физического состояния и маршрута между позами

`AvatarStateMachine.ts` различает разговорные режимы, но не стойку, кресло, пол или контактную фазу. `AvatarAnimationQueue.ts:115` принимает решение по mode и одному флагу interruptible. `AvatarTransitionPolicy` выбирает время смешивания по разговорному mode. Ни один из них не проверяет, откуда физически допустим следующий жест.

Важно: `sit_idle2` и `sit_idle3` сейчас не входят в автоматический выбор — у них нет tags/usage, поэтому это не доказанный баг «автоматически садится после взмаха». Проблема архитектурная: ручной preview и будущий расширенный выбор не имеют общего барьера, который запрещал бы нелегальный переход. Сам каталог не описывает обязательные посадку, опору и подъём.

В новом каталоге разрешена только standing posture; профили сидения из текущей библиотеки в него не переносятся. Допустимые рёбра переходов должны учитывать положение и занятость рук, ориентацию кистей и форму пальцев. Плавность корпуса сама по себе не гарантирует совместимости двух жестов.

### P1 Остановка и ошибка мгновенно восстанавливают safe pose

`GeneratedBodyPlayback.ts:308–336` отменяет сессию и сразу вызывает `restoreSafePose`; `fail()` делает то же. Корректная инвалидация старой генерации уже есть, но визуальный сброс вращений и root position происходит без перехода. Поднятая рука и выразительно собранные пальцы могут мгновенно смениться исходной позой.

Нужно разделить немедленную отмену inference и визуальный recovery. После отмены нельзя применять старые generated frames. При существующей модели допустим только локальный ограниченный recovery из текущей скомпонованной позы, учитывающий опору. Если допустимого пути нет — удержать последнюю допустимую позу и честно показать degraded. Emergency Stop останавливает исполнение сразу; декоративный «доехать до конца» не может удерживать inference или задерживать остановку.

### P2 Root policy и контакты не соответствуют заявленной детализации

`rootMotionPolicy` передаётся и показывается в debug, но применение root в `GeneratedBodyPlayback.ts:470–490` решается через один `profile.stationary`. Для stationary Y зажат в диапазон от −0,08 до 0 от исходного anchor, X/Z обнуляются. Булево поле не описывает допустимые смещения и контактную фазу движения.

`footContacts` приходит из worker, но renderer не использует его для решения о захвате/освобождении стоп: при stationary обе стопы прибиваются к anchor (`:493–496`). `tiptoe_peek` при этом требует подъёма на носки, но помечен stationary. Такой профиль противоречит текущей root/foot политике.

Заменить bool на разные независимые поля: root displacement policy, posture, опора, контакт heel/toe/full-foot, возможность шага, допустимая вертикальная амплитуда. Зафиксированная позиция в X/Z не равна неподвижным стопам во всех осях.

### P2 Переходы фаз речи выбираются по другому времени

Сам generated body правильно привязан к PCM, однако `AvatarSpeakingGestureScheduler.ts:86–89` продолжает elapsed/cooldown по render delta. `AvatarController.ts:694` передаёт ему этот delta. При buffering body стоит, а scheduler может перейти к emphasis/holding и сменить будущий профиль.

Сроки речевых фаз и привязанные к ним жесты должны использовать consumed PCM offset того же playback ID. Для подготовки до первого звука, перехода после окончания речи и idle нужен отдельный явно выбранный local monotonic clock. Переключение часов не должно давать скачок курсора.

### P2 Жизненный цикл прерывания распределён и не учитывает фазу

В manifest есть interruptible и функция `isAnimationInterruptible`, но основной `AvatarController.ts:837` определяет прерываемость через `effect.mode === 'idle' || behaviorId === 'greeting'`. Speaking scheduler использует `playResolvedImmediately`, заменяя текущий элемент напрямую.

Флаг true/false не описывает разницу между подготовкой, вершиной жеста и переносом опоры. Очередь также не задаёт явного TTL и общего лимита элементов. Cooldown отмечается в resolver ещё до принятия/старта исполнения и может расходоваться отвергнутым запросом; если все кандидаты на cooldown, используется least-recent fallback.

Нужен один фазовый протокол request/supersede/interrupt/recover, ограниченная очередь с TTL и cooldown после фактического старта. Нельзя обходить физические ограничения из-за источника `speaking` или `debug-preview`.

### P2 Base gesture и reaction пока не являются независимыми скелетными слоями

`AvatarMotionLayer.ts` задаёт веса процедурного вклада, но `GeneratedBodyPlayback.apply()` всё равно применяет один полный body horizon к одному списку костей. Смена gesture-профиля меняет conditioning полного тела; существующая метка layer не сохраняет отдельно устойчивый lower body или каноническую base posture.

Нужен один генератор полного тела с постоянными posture/contact constraints и меняющимся gesture intent. Детерминированные вкладки пальцев, головы и micro-motion компонуются отдельно. Два независимых ARDY-потока для ног и рук создали бы новую проблему согласования; для этого пресета они не требуются.

### P2 Ограничители пока не покрывают костюм и финальную композицию

`GeneratedBodySafety` проверяет суставы и сегменты рук относительно приблизительного торса. Это полезная защита, но она не проверяет платье, волосы, бёдра, каблуки, хвост и self-contact кистей. Коррекции выполняются после сглаживания, а procedural contribution добавляется позднее (`GeneratedBodyPlayback.ts:406`, `VrmModel.ts:109–120`). Следовательно, ограничения не являются проверкой всей окончательной позы.

Для первого референса нужны калиброванные conservative clearance volumes и ограничения художественного профиля. Post-composition validation должно проверять финальную позу и сохранять временную непрерывность коррекций. Это не обещание полноценной симуляции ткани: сложные пересечения всё равно требуют визуальной приёмки на конкретной VRM.

### P2 Семантика каталога наследует случайные соответствия старых клипов

В `contracts/motion.v1.json:327` приветствие имеет `gesture:agree`; `:642` disapproval используется для sad/crying, хотя prompt описывает dismissive movement; `:689` embarrassment тоже используется для sad/crying. Эмоция не определяет коммуникативный акт: грусть не означает отмахнуться, согласие не означает поздороваться, смущение не означает плакать.

Новые ID и соответствия следует строить от намерения: согласиться, объяснить, поддержать, поблагодарить, мягко возразить. Emotion только меняет подачу в допустимых границах. Кисти также должны задаваться семантическими hand-shape presets и стороной, а не `profileId === 'finger_gun'` в renderer. Сейчас exact finger poses выбираются по старым ID и применяются к обеим рукам. Общий body cursor уже используется, но для всех профилей нет фазового hand score, который связывал бы раскрытие пальцев и ориентацию кисти с конкретным акцентом и возвратом руки.

### P2 Каталог transport и UI сохраняют ограничения клиповой модели

`scripts/sync-motion.mjs:9` требует ровно 39 профилей, проверяет только часть структуры; renderer требует присутствия каждой старой категории. `AnimationId` после приведения массива к `readonly AnimationManifestEntry[]` фактически остаётся string. Поля file/loop/asset cache и сгенерированный `currentClipDuration = 3.2` продолжают имитировать старую модель.

`motionChunkSchema` строго проверяет размеры и finite values, но контакты имеют только «до 8 чисел», без фиксированных имён и диапазона. FPS и skeleton фиксированы, а ревизии catalog/rig calibration и отдельный motion execution/phase ID не связывают результат с новым фазовым намерением. Оси, единицы и world quaternion convention находятся в комментариях/коде, а не в проверяемом negotiated format.

Текущий Preview показывает выбранную строку, auto/manual, условный loop и состояние генератора, но не исполняемую фазу, путь перехода и причину отказа. Выбор строки немедленно запускает preview. Для новой библиотеки это скрывает наиболее важную информацию.

## Целевой контракт движения

### Разговорный режим физическая поза и жест

Разделить три независимые величины:

| Величина | Пример | Где хранить |
| --- | --- | --- |
| Разговорный режим | listening, thinking, speaking | Существующий Character State и его чтение Avatar Runtime. |
| Текущая физическая поза | Standing: устойчивая стойка, положение рук и текущий переход | Внутреннее состояние body domain Avatar Runtime. Если остальным потребителям нужна поза — одна read-only embodiment projection от этого владельца. |
| Исполняемое намерение | greet-wave-soft, reassure-palm | Один motion execution с фазой, generation и outcome. |

Персонаж слушает, думает и говорит стоя. Смена разговорного режима сохраняет устойчивую опору и не сбрасывает руки, кисти или пальцы в исходную позу. Pending target pose, очередь и граф не копируются в Character State или Memory.

### Четыре фазы каждого движения

1. **Подготовка** — привести руку и вес тела к достижимому началу. Фаза может быть короткой, если текущая поза уже подходит.
2. **Основное движение** — выполнить выразительный акцент. Время акцента связано со смыслом и, при наличии нужных метаданных, с audible cue.
3. **Удержание** — дать жесту читаться без механического повторения. Для presence это длительное состояние с ограниченной вариативностью.
4. **Возврат** — освободить руку и вернуться к совместимой позе либо к началу следующего движения.

В любой фазе есть минимальный и максимальный бюджет, допустимые прерывания и exit conditions. Это структура исполнения, а не четыре заранее сохранённых клипа. Генерируются только ограниченные transient horizons; небольшие canonical pose targets и constraints не являются библиотекой готовых траекторий.

Законченный motion outcome: `completed`, `superseded`, `cancelled`, `timed-out`, `failed`. Только `completed` означает, что exit conditions достигнуты. Новая цель, ошибка inference, кончившийся чанк и закончившаяся речь не равны окончанию телесного движения.

### Правила маршрута между движениями

Сначала проверяются posture, support, занятые руки, rig capabilities, камера и актуальность intent. Только среди допустимых вариантов выбирается конкретная вариация. Случайность меняет вариант и небольшие особенности подачи, но не определяет класс следующего действия.

Для одной позы разрешены три вида маршрута:

- Прямое соединение, если конечная поза, скорости, занятость рук, ориентация кистей и форма пальцев совместимы.
- Короткий bridge, если жесты совместимы по смыслу, но руке нужно пройти промежуточную позу.
- Полный возврат в устойчивую базу с согласованным расслаблением кистей и пальцев, если меняется зона рук или класс движения.

Проходить через одинаковый idle после каждого жеста не нужно: это сделает речь рубленой. Однако несовместимый запрос нельзя разрешить одним длинным crossfade. Если допустимого маршрута нет, запрос отклоняется с bounded reason.

```text
standing + свободная правая рука
    → подготовка приветствия и мягкое раскрытие пальцев
    → подъём руки с ориентацией ладони к собеседнику
    → мягкий взмах с согласованным движением запястья
    → опускание руки и постепенное расслабление пальцев
    → короткий bridge к объясняющему жесту
    → разворот ладони вверх и раскрытие пальцев к смысловому акценту
    → объясняющая дуга
    → согласованный возврат руки кисти и пальцев
    → спокойное standing presence
```

Прямое переключение raised-hand wave → hand-at-heart без промежуточной достижимой траектории запрещено. Смена открытой ладони на V-жест требует своего перехода пальцев до акцента. Следующее намерение может ждать ограниченное время до допустимой точки; повторное ожидание не накапливается бесконечно.

### Приоритет и прерывание

Порядок технического исполнения: shutdown/model replacement/Emergency Stop → необходимое прекращение или recovery → защищённый участок текущего жеста → актуальное явное намерение → речевой жест → body accent → ambient variation.

Разговор и звук остаются своевременными: защищённая фаза тела не блокирует Conversation Admission и не заставляет TTS ждать возврата рук. Если пользователь заговорил во время жеста, персонаж начинает слушать лицом/взглядом, а руки, кисти и пальцы согласованно переходят к listening presence. При остановке inference старые кадры сразу становятся недействительными.

Все источники, включая Preview и Speaking scheduler, обращаются к одному executor. Для очереди задать начальный лимит в 2 pending intents, TTL для жестов и supersede по semantic family. Старое приветствие не воспроизводится через минуту после его повода. Точные TTL — настройка после измерений, не универсальная константа для всех движений.

### Сглаживание и контакты

В generator передаются авторегрессионная история и проверенные ограничения следующей фазы. На границах horizon сохраняется согласованность root, суставных скоростей и контактов. На стороне renderer применяются bounded temporal blending и final constraints; новая поза не появляется раньше готовности своего execution.

Стопа захватывается только при подходящем контакте с опорой. Anchor не пересоздаётся случайно при каждом новом gesture ID. Root displacement выражается относительно непрерывного model/stage frame, а не сбрасывается к новому origin.

Для всех 28 профилей обе стопы остаются на полу, без шагов, подскоков и подъёма на носки. Ограничение честно соответствует выбранным движениям. Перенос веса возможен без перестановки стоп.

## Изменения контрактов под ARDY

### Канонический семантический каталог

Предложение для следующей версии motion contract:

| Поле | Смысл |
| --- | --- |
| schemaVersion / catalogRevision | Формат и идентичность всего каталога. Число профилей не является версией. |
| id / family / labels | Новый стабильный ID, коммуникативное семейство, RU/EN названия. |
| kind | presence или gesture. Вместо общего loop. |
| entryPostures / exitPosture | Standing для всего пресета; отдельно проверяются достижимые исходная и конечная позы рук. |
| requiredRigCapabilities | Наличие нужных кистей/пальцев, диапазона суставов и других возможностей. |
| supportPolicy / rootPolicy | Контакты, допустимое перемещение, anchor frame и пределы. |
| phases | Подготовка, акцент, удержание, возврат; min/max duration и named exit conditions. |
| hands / handScore | Обе руки: роль, ориентация кисти и форма каждого пальца по общей фазе; prepare/stroke/hold/recover curves, занятость и условия перехода. |
| handRigCalibration | Локальные оси кистей и фаланг, rest pose, пределы сгиба/разведения, оппозиция большого пальца и revision калибровки. |
| compositionMask | Какие body channels разрешены; face/head/gaze исключены. |
| usage / semanticIntent | Контекст применения и смысл, отдельно от эмоции. |
| cameraPolicy | Полный рост, по грудь, лицо; скрытый нижний кадр не разрешает опасное движение ног. |
| interruptionPolicy | Разрешённые точки остановки, допустимый recovery и supersede. |
| variationPolicy | Пределы амплитуды, темпа, стороны, cooldown по семейству. |
| qualification | Состояние draft/qualified/disabled и совместимость с rig profile. |
| conditioningRefs | Только доверенные ограниченные conditioning templates и canonical constraint references. |

Каталог остаётся единственным источником истины. Производные TS-типы, runtime schema и Python-readable profile pack генерируются/валидируются из него. Не добавлять отдельную renderer-таблицу «какие движения доступны». Старые обязательные категории и ограничение «ровно 39» убрать при намеренной миграции.

Пример смысловой записи, не готовая runtime schema:

```json
{
  "id": "greet_wave_soft",
  "family": "greeting",
  "kind": "gesture",
  "labels": { "ru": "Мягкое приветствие", "en": "Soft greeting" },
  "entryPostures": ["standing"],
  "exitPosture": "standing",
  "supportPolicy": "both-feet-planted",
  "rootPolicy": "anchored-standing",
  "hands": {
    "right": { "role": "lead", "handScoreRef": "soft-wave-right-v1" },
    "left": { "role": "support", "handScoreRef": "relaxed-support-left-v1" }
  },
  "handClock": "motion-execution-phase",
  "phases": [
    { "id": "prepare", "minMs": 350, "maxMs": 700 },
    { "id": "stroke", "minMs": 800, "maxMs": 1300 },
    { "id": "hold", "minMs": 150, "maxMs": 350 },
    { "id": "recover", "minMs": 550, "maxMs": 1000 }
  ],
  "exitCondition": "standing-stable-and-both-hands-recovered",
  "automaticPolicy": "only-for-greeting-intent",
  "cooldownFamilyMs": 60000
}
```

Требуются строгие схемы для всех enum, времён и пределов; неизвестные поля отклоняются. Cross-field validation проверяет достижимость exit posture, существование recovery, отсутствие facial authority и противоречий между contact/root/phase policy. Граф проверяет как разрешённые рёбра, так и недостижимые состояния.

### Worker protocol и готовность

Обновление протокола должно связывать каждый запрос/ответ со следующими данными:

- negotiation: protocol version, точный motion model/source revision, skeleton revision, reference pose, quaternion order, axes, handedness, units, FPS и horizon shape;
- lease: session/epoch/modelGeneration/avatarGeneration и seed;
- plan identity: catalog revision, motion execution ID, plan revision, profile, phase ID, hand score revision и hand rig calibration revision;
- time identity: continuous start frame, sequence, clock domain и при необходимости playback ID; actual PCM consumption остаётся у AudioPlayer;
- continuity: идентификатор accepted history/continuity anchor и точный fromFrame; отсутствие контекста нельзя молча назвать непрерывным продолжением;
- support: фиксированная схема left/right heel/toe contacts с диапазонами и явно определённым значением;
- result: horizon, bounded inference timings и технические failure codes. Worker не объявляет semantic completion по одному prompt.

Новые идентичности должны реально проверяться в Main, worker и renderer. Граница фаз не выводится из заголовка строки каталога или из возраста чанка. Restart, model replacement и смена catalog revision инвалидируют несовместимые планы.

Main принимает только ограниченные семантические ID и доверенные ссылки на constraints. Сценические anchors — зарегистрированные ограниченные ресурсы, а не произвольные пути или свободные команды из renderer. Непроверенные числовые данные renderer не становятся process authority. Никакие prompts, poses или screenshots не уходят в conversation history или semantic Memory.

### Возможности ARDY и ограничения адаптера

Закреплённая версия `e706e27acc88070918308a10922b8f7174d0825e` уже содержит `Root2DConstraintSet`, `FullBodyConstraintSet` и end-effector constraint classes. Shio сейчас использует только Root2D для stationary и историю. После архитектурной сверки техническая реализация расширяет существующий Adapter и квалифицирует ограничения на текущем checkpoint, без обязательной замены модели.

У FullBody constraint в этой версии есть важная деталь: `update_constraints` использует позиции и root/heading; комментарий прямо указывает, что global rotations здесь не используются. Нельзя обещать точный authored wrist orientation только по наличию аргумента rotations. Конкретные end-effector ограничения и renderer hand contribution требуют отдельных проверок.

Официальный ARDY описывает streaming text conditioning и kinematic constraints, включая root paths, keyframes и end effectors. Это даёт основу для такого Adapter, но не готовый контроллер поведения Vtuber. [Официальный репозиторий ARDY](https://github.com/nv-tlabs/ardy), [закреплённые constraint classes](https://github.com/nv-tlabs/ardy/blob/e706e27acc88070918308a10922b8f7174d0825e/ardy/constraints.py).

Выбранная модель обучена на Core skeleton с 27 суставами при 20 FPS. Её horizon из 8 кадров даёт 0,4 секунды нового движения на ответ, а не ограничение длины всего жеста. Полные пальцевые цепочки нужно продолжать реализовывать отдельным ограниченным вкладом. [Карточка используемого checkpoint](https://huggingface.co/nvidia/ARDY-Core-RP-20FPS-Horizon8).

Слово «изящная» в prompt не гарантирует художественное качество. Shape, contacts, фазы, clearance, hand presets и приёмка являются частью пресета. Новые GPU/checkpoint/скелетные варианты — отдельная квалификация с явной миграцией, если текущая модель не проходит нужную матрицу.

## Художественный пресет

### Характер движения

Для первого референса предлагается образ спокойной, уверенной и тёплой девушки с лёгкой лисьей игривостью. Милые акценты читаются на фоне выдержанной осанки; постоянное подпрыгивание и махание руками разрушат этот характер.

Основные правила:

- Плавные дуги кистей, мягкие локти, небольшая контролируемая асимметрия. Одна ведущая рука, вторая поддерживает силуэт.
- Стопы устойчивы; колени не зажаты до визуального перелома. Вес может смещаться без переступания.
- Руки движутся перед силуэтом и чуть сбоку, сохраняя clearance от груди, пояса, волос и хвоста. «Рука у сердца» означает hover перед грудью, а не проникновение в mesh.
- Для каблуков и длинных элементов костюма первый релиз исключает бег, прыжки, резкие развороты, глубокие приседания, high kicks и опору на одну ногу.
- Медленный preparation и читаемый recovery важнее количества вариаций. Короткий акцент внутри движения может быть быстрее, но без мгновенного изменения направления.
- Дыхание остаётся малой низкоприоритетной добавкой. В conditioning не нужно одновременно требовать яркое дыхание, которое затем повторит процедурный controller.
- Эмоция изменяет масштаб и мягкость, не подменяет намерение. Грусть — уменьшенная открытость и энергия; злость — собранность, а не агрессивный выпад.
- Уши, хвост, моргание, взгляд и улыбка координируются через своих owners. ARDY не получает право генерировать лицо или вращать голову.

Начальные художественные ориентиры для калибровки: наклон корпуса обычно 2–5°, короткий forward lean до 6°, спокойный torso yaw до 8°, кисти преимущественно ниже плеч. Это целевые ограничения конкретного пресета, а не измеренные возможности прикреплённой VRM. Реальные пределы берутся из rig profile и проверяются на модели.

### Новые 28 намерений

Все ID ниже новые. Во всём наборе entry и exit posture — standing, обе стопы на полу. Каждая запись исполняется вместе со своим hand score из следующего раздела: движение без согласованных кистей и пальцев не считается готовым профилем. Время — предлагаемый рабочий диапазон полного жеста с preparation и recovery, не гарантированная длительность генерации. Для presence выполняются вход, удержание и выход; бесконечное повторение одной законченной траектории не требуется.

| ID | RU / EN | Движение и логика выхода | Применение и начальная частота |
| --- | --- | --- | --- |
| `presence_poised` | Спокойная стойка / Poised presence | Руки свободно у корпуса, мягкие локти, устойчивая вертикаль. Базовая поза для безопасных переходов. | Основное presence; удержание от 15 с без обязательной смены. |
| `presence_warm` | Тёплое ожидание / Warm presence | Чуть более открытая линия плеч и кистей; без отдельного приглашающего взмаха. Возврат через relaxed hands. | Только подходящий тёплый контекст; удержание 12–30 с. |
| `presence_listening` | Внимательно слушает / Attentive listening | Корпус слегка собирается к собеседнику, руки спокойны. Взгляд направляет gaze owner. | Пока слушает; не задавать руками повторяющийся «вопрос». |
| `presence_thinking` | Задумалась / Thoughtful presence | Одна кисть ненадолго собирается перед талией; вторая расслаблена. Без постоянного касания подбородка. | Пока думает; спокойный sustain, затем release. |
| `presence_speaking` | Спокойная речь / Conversational presence | Открытая разговорная база без бесконечного объясняющего цикла. Готова принять отдельный акцент. | Между речевыми жестами; сама не расходует gesture quota. |
| `presence_restful` | Тихий отдых / Restful presence | Меньше амплитуда плеч и кистей, спокойная вертикаль. | При низкой активности; удержание 20–45 с. |
| `greet_wave_soft` | Мягкое приветствие / Soft greeting | Правая кисть поднимается к плечу, 1–2 небольшие дуги, явное опускание и освобождение руки. | Только greeting intent; 2–3,4 с; cooldown семейства от 60 с. |
| `farewell_wave_soft` | Тёплое прощание / Warm farewell | Более медленный открытый взмах, короткое удержание, рука возвращается к боку. | Только farewell intent; 2,4–3,8 с; от 60 с. |
| `agree_soft` | Мягкое согласие / Gentle agreement | Короткое раскрытие ведущей кисти. Небольшой кивок запрашивается отдельно через head owner. | Семантическое согласие; 1,2–2 с; от 12 с. |
| `disagree_gentle` | Мягкое возражение / Gentle disagreement | Небольшой боковой жест открытой кистью, локоть рядом с корпусом, затем release. | Возражение, не печаль; 1,5–2,4 с; от 15 с. |
| `explain_one_palm` | Объяснение ладонью / One palm explanation | Одна ладонь раскрывается на уровне талии/низа груди, делает одну смысловую дугу и возвращается. | Обычное объяснение; 2–3,2 с; от 10 с. |
| `explain_balance` | Сравнение вариантов / Balanced explanation | Две ладони последовательно обозначают два небольших пространства; затем обе освобождаются. | Сравнение или выбор; 2,8–4 с; от 18 с. |
| `invite_question` | Приглашение к ответу / Invite response | Открытая ладонь к собеседнику, небольшая пауза, мягкое опускание. | Передача реплики; 1,8–2,8 с; от 20 с. |
| `reassure_palm` | Мягкая поддержка / Reassuring palm | Одна ладонь спокойно раскрывается вперёд и чуть вниз, корпус устойчив. Не тянется за камерой. | Поддержка; 2–3,2 с; от 20 с. |
| `thank_heart_hover` | Благодарность / Heartfelt thanks | Правая кисть приближается к зоне перед сердцем с clearance, задерживается и опускается. | Благодарность; 2,2–3,5 с; от 25 с. |
| `present_side` | Представление рядом / Present beside | Ведущая ладонь обозначает пространство сбоку в пределах кадра, затем возвращается. | Указание на тему/экран без претензии на точное попадание в UI; 2–3 с; от 18 с. |
| `delight_hands_open` | Тихая радость / Quiet delight | Обе кисти немного раскрываются у нижней линии груди; плечи остаются мягкими, затем release. | Хорошая новость; 1,8–2,8 с; от 25 с. |
| `laugh_soft` | Мягкий смех / Soft laugh | Маленький акцент плеч и корпуса, одна кисть приближается к верхней части торса без контакта. | Реальный amusement intent; 1,5–2,5 с; от 20 с. |
| `shy_gather` | Милое смущение / Shy gathering | Кисти сближаются перед талией без переплетения пальцев; короткий hold, затем relaxed hands. | Смущение; 2–3,2 с; от 35 с. |
| `curious_lean` | Любопытство / Curious lean | Небольшой наклон к собеседнику, одна приоткрытая кисть, возврат вертикали до следующего жеста. | Любопытство; 1,5–2,5 с; от 18 с. |
| `surprise_small` | Небольшое удивление / Small surprise | Кисти приподнимаются на малую высоту, короткая пауза, плавное возвращение. Без шага назад. | Удивление; 1,2–2 с; от 25 с. |
| `concern_soft` | Заботливое участие / Gentle concern | Открытость уменьшается, одна ладонь поддерживает реплику. Без dismissive movement. | Забота/грусть/сочувствие по смыслу; 2–3 с; от 25 с. |
| `resolve_firm` | Спокойная решимость / Calm resolve | Корпус собирается, кисть делает один небольшой уверенный акцент без кулака и выпада. | Решение или твёрдое возражение; 1,5–2,4 с; от 25 с. |
| `celebrate_petite` | Маленькая победа / Petite celebration | Небольшой подъём одной руки с радостным раскрытием, без прыжка и танца, затем возврат. | Достигнутый успех по контексту; 2–3,2 с; от 45 с. |
| `fox_paw_single` | Лисья лапка / Fox paw | Одна рука сгибается у нижней линии груди, мягко согнутая кисть; короткий hold и опускание. | Редкий playful accent; 1,8–2,8 с; от 90 с. |
| `peace_single` | Милый V жест / Cute peace sign | Одна выбранная рука у плеча, явный V preset пальцев, короткий hold, release пальцев при опускании. | Редкая игривость; 2–3 с; от 90 с; нужен finger capability. |
| `kiss_air_soft` | Воздушный поцелуй / Air kiss | Кисть подходит к зоне перед губами с clearance и мягко раскрывается наружу. Лицо ведёт facial owner. | Явное affectionate/playful намерение; 2,5–3,8 с; по умолчанию без ambient auto. |
| `stretch_small` | Небольшая разминка / Small stretch | Умеренное раскрытие плеч и предплечий, без рук над головой и наклонов к полу; полный возврат. | Длительный покой; 3–4,5 с; от 180 с и с проверкой отсутствия активной реплики. |

Для всех жестов сторона руки фиксируется на время execution. Зеркальная вариация допустима только после квалификации и не меняется посреди жеста. `peace_single` не делает V второй рукой. Каждый профиль требует калиброванных кистей и необходимых пальцевых цепочек. Если rig не позволяет исполнить заявленный hand score, соответствующий профиль недоступен; неподвижные пальцы или замена V-жеста открытой ладонью не считаются полным исполнением этого профиля.

Cooldown — минимальный интервал, а не таймер обязательного повторения. Его нельзя игнорировать просто потому, что все красивые жесты недавно использовались: допустимо спокойно продолжить presence. Исключение для явного запроса повторить движение задаётся отдельной политикой intent и не снимает физических ограничений.

### Синхронизация рук кистей и пальцев

Для всех 28 профилей плечо, локоть, предплечье, запястье, ладонь и пальцы образуют одно движение с одним execution ID, общей фазой и общим курсором времени. Процедурный источник пальцев остаётся отдельным вкладом, поскольку Core27 не даёт полные пальцевые цепочки; его временная и смысловая независимость от жеста запрещена.

Во время речи тело, кисти и пальцы сэмплируются по consumed PCM cursor, включая одинаковую остановку при buffering. В idle, preparation до звука и recovery после речи используется один выбранный local monotonic cursor. При смене clock domain позиция фазы сохраняется для всех каналов вместе. Отдельный wall-clock timer или независимая случайная «жизнь пальцев» не допускаются.

Hand score хранит кривые и события в координатах общей фазы: роль каждой руки, ограниченные цели ориентации ладони/запястья, сгиб и разгибание суставов каждого пальца, разведение пальцев и оппозицию большого пальца. Калибровка переводит их в локальные оси конкретного VRM-рига. Для каждого перехода задаются достижимая исходная форма, целевая форма к акценту и согласованный выход. Плавная интерполяция не означает одинаковое движение всех фаланг: допускаются небольшие заранее заданные различия внутри одного score.

| Фаза | Обязательное согласование |
| --- | --- |
| Подготовка | Пальцы начинают принимать нужную форму во время подготовки руки; ориентация ладони меняется вместе с предплечьем. Форма достигается к обозначенному акценту, а не после него. |
| Основное движение | Направление ладони и степень раскрытия соответствуют смыслу жеста. Ограниченные смещения запястья не ломают линию предплечья и не заставляют пальцы пересекаться. |
| Удержание | Форма удерживается вместе с рукой. Для точного V-жеста случайные curl variations подавлены; для расслабленной ладони разрешены лишь малые вариации внутри той же фазы. |
| Возврат | Рука опускается, запястье и пальцы постепенно расслабляются. При совместимом следующем жесте score непрерывно переходит в его подготовку; обязательное обнуление всех пальцев между жестами не требуется. |

Конкретная хореография кистей и пальцев обязательна для каждой записи:

| Профиль | Кисти и пальцы по ходу движения |
| --- | --- |
| `presence_poised` | Обе ладони естественно ориентированы к бёдрам, пальцы слегка согнуты с мягкой разницей между цепочками. Малые изменения связаны с общим движением рук, без произвольного перебирания. |
| `presence_warm` | Кисти немного открываются вместе с плечами, пальцы становятся свободнее без сильного разведения; выход возвращает естественный curl обеих рук. |
| `presence_listening` | Спокойная расслабленная форма обеих кистей сохраняется при наклоне корпуса; локальные компенсации не допускают залома запястий. |
| `presence_thinking` | Ведущая кисть мягко собирается при приближении к талии; большой палец остаётся свободным. При release форма раскрывается в ритме отведения руки. |
| `presence_speaking` | Мягкая открытость кистей между речевыми акцентами. Подготовка следующего жеста начинает формировать пальцы из фактически текущей формы. |
| `presence_restful` | Расслабленный чуть более закрытый curl без сжатого кулака; низкая амплитуда кистей и пальцев соответствует малой амплитуде рук. |
| `greet_wave_soft` | Ведущая ладонь разворачивается к собеседнику при подъёме; пальцы раскрыты мягко, большой слегка отведён. Кисть участвует в 1–2 дугах взмаха, пальцы расслабляются при опускании. |
| `farewell_wave_soft` | Открытая ладонь и свободные пальцы формируются до медленного взмаха; форма удерживается в короткой паузе и постепенно закрывается при возврате руки. |
| `agree_soft` | Небольшое раскрытие ладони и пальцев совпадает с акцентом согласия; затем кисть целиком возвращается в relaxed shape. |
| `disagree_gentle` | Ладонь ориентируется наружу и немного вбок, пальцы мягко выпрямляются вместе с боковым движением. Без резкого «стопа» и гиперразгибания. |
| `explain_one_palm` | При подъёме предплечья ладонь разворачивается вверх, пальцы раскрываются к вершине объясняющей дуги, затем собираются при возвращении руки. |
| `explain_balance` | Каждая ладонь раскрывается к своему последовательному акценту; пальцы первой руки удерживают форму, пока говорит вторая. Возврат обеих кистей согласован с траекториями рук. |
| `invite_question` | Ладонь ориентирована вверх и к собеседнику, пальцы свободно раскрываются до приглашения; без отдельного подзывающего сгибания пальца. Затем мягкий общий release. |
| `reassure_palm` | Ладонь раскрывается вперёд и немного вниз вместе с поддерживающей дугой; пальцы свободные, без напряжённого растопыривания. Возврат одновременно смягчает кисть. |
| `thank_heart_hover` | Ведущая кисть становится мягко собранной и ориентируется к груди до приближения; кончики пальцев сохраняют clearance. При отведении запястье и пальцы возвращаются к relaxed pose. |
| `present_side` | Ладонь раскрывается в сторону представляемого пространства вместе с отведением руки; пальцы поддерживают открытую линию без случайного указательного жеста. |
| `delight_hands_open` | Обе ладони раскрываются к акценту радости; пальцы умеренно разводятся, большие немного отводятся. Раскрытие и расслабление следуют движению обеих рук. |
| `laugh_soft` | Ведущая кисть мягко собирается при приближении к торсу; малое движение запястья согласовано с акцентом плеч. Поддерживающая рука остаётся расслабленной. |
| `shy_gather` | Обе кисти постепенно собираются перед талией; пальцы слегка согнуты, без переплетения и проникновения друг в друга. Формы раскрываются по мере разведения рук. |
| `curious_lean` | Одна ладонь немного раскрывается вместе с наклоном, пальцы сохраняют мягкий curl; возврат корпуса и руки одновременно снимает раскрытие. |
| `surprise_small` | Малый подъём кистей сопровождается небольшим раскрытием пальцев; форма достигается к акценту удивления и плавно расслабляется при опускании. |
| `concern_soft` | Ведущая ладонь открыта мягко, пальцы немного собраны, без отталкивающей ориентации. Степень раскрытия следует поддерживающему движению руки. |
| `resolve_firm` | Кисть собрана, пальцы ближе друг к другу, без кулака. Небольшое разгибание запястья связано с единственным акцентом, затем возвращается в пределы relaxed pose. |
| `celebrate_petite` | При подъёме ведущей руки ладонь и пальцы мягко раскрываются к вершине движения; после короткого hold расслабляются вместе с рукой. Вторая кисть не повторяет жест без назначения. |
| `fox_paw_single` | Умеренный curl пальцев и мягкое сгибание запястья формируются при подъёме руки, дают читаемую «лапку», затем снимаются при опускании. Суставные пределы не допускают залома. |
| `peace_single` | Указательный и средний пальцы разгибаются и умеренно разводятся до акцента; безымянный и мизинец сгибаются, большой занимает проверенную позицию без пересечений. V удерживается и снимается в recovery одной ведущей руки. |
| `kiss_air_soft` | При подходе к зоне перед губами пальцы мягко собраны; при движении наружу ладонь разворачивается к собеседнику и пальцы раскрываются. При возврате форма расслабляется без контакта с лицом. |
| `stretch_small` | Обе кисти и пальцы умеренно раскрываются вместе с небольшим растяжением плеч/предплечий; максимальное раскрытие совпадает с hold, расслабление — с возвратом рук. |

Вторая рука всегда имеет явный score: relaxed support либо собственное согласованное движение. Отсутствие ведущей роли не означает независимую случайную анимацию пальцев. Вариация seed может менять только ограниченные параметры целого движения; она не пересоздаёт пальцевую траекторию посреди фазы.

Body composer остаётся единственным владельцем окончательных wrist/finger transforms. ARDY даёт кандидат body/wrist pose; ограниченный hand contribution уточняет его в одной композиции и добавляет пальцы. Не допускаются два конкурирующих прямых writer запястья. Коррекции руки, кисти и пальцев проверяются вместе после композиции, включая self-contact и clearance от торса/одежды.

`completed` требует достижения согласованного выхода обеих рук, кистей и пальцев, а не только окончания траектории плеча. При supersede/replan переход начинается из фактически применённой составной позы. Underrun удерживает все связанные каналы вместе; stop/cancellation инвалидирует весь execution, а разрешённый локальный recovery согласованно расслабляет руки и пальцы. Overlay получает уже составные wrist/finger rotations из той же проекции и не заводит отдельный hand score или таймер.

### Правила подачи во время разговора

Начальная гипотеза для визуальной приёмки: большую часть разговора занимает спокойное presence, обычно один смысловой жест на короткую реплику и 2–3 на длинную. Для длинных реплик стартовый интервал между самостоятельными акцентами — примерно 5–9 audible секунд, если смысл вообще требует нового жеста. Это художественная настройка, не условие обязательной смены позы.

Приветствие не выбирается при каждом agree. Радость не запускает celebration автоматически. Смущение не заменяет любую грусть. Переход к слушанию не делает руки вопросительными. Контекстная шутка может добавить `fox_paw_single`, но этот акцент не должен появляться при предупреждении или сочувствии.

Новый semantic intent остаётся ограниченным: коммуникативный акт, интенсивность, допустимый gaze hint. Ни provider, ни Browser/Project/Memory evidence не получают bone names, координаты, root trajectories или произвольный ARDY prompt. Если расширяется enum semantic acts, он обновляется вместе с safe protocol и prompt composition; словарный router не вводится.

### System Prompt и управление жестами через Character LLM

Обновление System Prompt является обязательной частью реализации по [каноническому контракту Character LLM](../ARCHITECTURE.md#planned-character-llm-embodiment-prompting), а не подразумеваемой побочной правкой каталога. LLM должна понимать, как запросить подходящий жест и когда лучше оставить спокойное presence. Она выражает смысл; Avatar Runtime выбирает и исполняет физически допустимое движение.

Сейчас `CharacterPrompt.ts:80` содержит `embodimentContractPrompt()` с семью `gestureHint`: explain, agree, disagree, tease, surprise, think, celebrate. Он разрешает один необязательный завершающий `<shio-embodiment>` marker с intensity/gesture/gaze. Этот словарь сам по себе не покрывает все новые коммуникативные семейства, включая отдельные greeting/farewell/thanks/reassurance. Завершающий marker также может прийти после начала звучания ответа. Одной замены 28 профилей без обновления prompt/schema/parser недостаточно.

Объём отдельного этапа 2a:

1. **Словарь и формат.** После определения semantic contract на этапе 2 согласованно обновить typed intent и `embodimentContractPrompt()`. Объяснить значения допустимых hints, интенсивность, optional gaze и корректное отсутствие жеста. Словарь и описания берутся из канонических definitions, не из второй вручную поддерживаемой таблицы prompt.
2. **Смысл выбора.** Включить короткие примеры: приветствие не равно согласию, благодарность не равна celebration, поддержка не равна dismissive movement. Смущение не подменяет грусть. Милая подача не обязывает выбирать playful accent в каждом ответе. Шесть presence-профилей и ambient channels не требуют отдельной model-команды на каждом кадре.
3. **Текущая доступность.** Передавать через Main-owned `CharacterRequestComposer` только компактную проверенную availability projection существующего Avatar owner: catalog revision/model generation, доступные semantic families и bounded причины недоступности. Статический prompt не объявляет все движения доступными. Никаких raw poses, bone lists, hand curves или произвольного renderer prompt; отдельный availability store не создаётся.
4. **Время поступления intent.** Спроектировать versioned early internal intent envelope в той же Character Response Generation, чтобы intent был разобран до целевой фазы. Обновить incremental filter и final parser согласованно. При ожидании intent использовать presence; trailing/late intent затрагивает только ещё не начатые допустимые фазы либо истекает. Не перезапускать уже прозвучавшую реплику ради запоздавшего взмаха.
5. **Границы полномочий.** LLM не выдаёт animation ID, file path, ARDY prompt, координаты, команды костям, пальцам, ушам, хвосту, Blink или LipSync. Не вводится generic `avatar.play`/Plugin dispatch. Запрошенный жест не считается выполненным: Runtime вправе отложить или отклонить его по rig capability, cooldown, фазе и актуальности.
6. **Речевой протокол.** Сохранить разграничение canonical emotion, Fish voice delivery и gesture intent. Внутренние поля и markers не попадают в chat, TTS, history или Memory. Не добавлять сценические ремарки в видимую речь и не менять tool-call-first stream policy. Текст из Browser/Project/Memory/Tool evidence не становится источником управляющих markers.
7. **Бюджет и отсутствие жеста.** Сохранить целиком обязательный протокол в response-policy budget, не обрезая формат или enum посередине. Сохранить bounded minimum для остальных присутствующих секций Composer; не возвращать последовательное заполнение, вытесняющее нижние секции. Не вставлять все 28 профилей и их вариации в каждый request. При отсутствующем/невалидном intent продолжать ответ с совместимым presence.

| Семантика реплики или явного запроса | Чему должен учить System Prompt | Что решает Runtime |
| --- | --- | --- |
| Поздороваться или мягко помахать | Запросить объявленный схемой greeting/wave intent, а не agree только из-за старого тега | Подходящий профиль, сторона руки, фазы, hand score и допустимый момент старта. |
| Поблагодарить | Выбрать объявленный thanks intent и подходящую intensity | Совместимый `thank_heart_hover` либо честное отсутствие исполнения. |
| Поддержать собеседника | Выбрать reassurance по смыслу, отделив его от эмоции и голоса | Допустимый поддерживающий жест, его масштаб и связь с audible cue. |
| Спокойно объяснить | Explain intent только когда он улучшает подачу, без обязательного повторения | Одна или две ладони среди совместимых вариантов; bridge от текущей формы кисти. |
| Попросили V жест или лисью лапку | Выбрать только явно поддерживаемое semantic намерение | Rig qualification, точная форма пальцев и согласованный выход; неподдерживаемый вариант не объявляется выполненным. |
| Короткий нейтральный ответ | Отсутствие gesture hint нормально | Сохранение presence и непрерывности руки/кистей; ambient channels остаются активными. |

Имена новых hints и раннего envelope окончательно задаются versioned contract на этапе 2, затем одинаково применяются в prompt, schema, mapping и safe parsers. Примеры выше описывают семантику, а не утверждают, что эти дополнительные значения уже принимает текущий код.

Приёмка этапа 2a: contract/prompt-budget tests проверяют совпадение advertised vocabulary со схемой, сохранение формата при насыщенном контексте, отсутствие каталожного dump и актуальность availability. Streaming tests покрывают ранний, поздний, отсутствующий, оборванный и невалидный intent, неизвестные поля/значения, разделение marker между чанками и отсутствие утечки в chat/TTS/history. Семантические qualification cases проверяют выбор Character LLM по смыслу на русском и английском, без keyword router; они отделены от детерминированных parser tests.

Ходьба, большие танцы, поклоны до пола и работа с предметами в этот пресет не входят: у них другие требования к пространству и опоре. Это осознанный объём первого набора, который можно довести до связного качества.

## Переработка библиотеки в клиенте

Библиотека должна помогать оценить поведение, а не только запускать ID. Предлагаемая структура экрана:

- Слева — группы «Присутствие», «Разговор», «Реакции», «Особые жесты». Локализованные названия, поиск и фильтр доступности для текущей модели, включая калибровку кистей и пальцев.
- У карточки — назначение, допустимая поза, availability/qualification и причина недоступности. Вместо ARDY/file label в основном представлении — понятное действие; технический ID остаётся в подробностях.
- Выбор карточки показывает описание и сценарий. Отдельный Play выполняет выбранное движение через общий executor. Просмотр записи сам по себе не должен менять позу.
- Возле viewport — фактическая поза, текущий gesture и фаза. Selected intent и running intent показываются отдельно, чтобы ожидание первого чанка не выглядело завершённым действием.
- Transition preview показывает маршрут «текущая поза → подготовка → жест → возврат» и умеет воспроизвести цепочку из 3–5 намерений. Если маршрут запрещён, отображается причина.
- «Создать вариацию» меняет допустимый variation seed, сохраняя смысл, сторону руки, опору и exit posture. Это не свободная переинтерпретация всего движения.
- «Вернуться в покой» означает физически допустимый recovery к standing presence с согласованным расслаблением рук, кистей и пальцев. Отдельная «Остановить» прекращает весь motion execution.
- Preview позволяет оценить кисти крупно и показывает общую фазу руки и hand score. Неподдерживаемый finger rig делает профиль недоступным с локализованной причиной.
- Developer details сохраняет queue/lease health, inference timing, actual blend phase, underrun, rejected transition reasons и correction counts. Raw poses и provider payloads в диагностический store не добавляются.

Все изменённые controls — React Spectrum 2. Цвета и состояния берутся из Spectrum/semantic tokens; проверяются обе темы. Все новые user-facing названия, описания, причины отказа и controls добавляются на русском и английском. Renderer берёт availability из одного каталога и владельца исполнения.

## План реализации

### Порядок архитектура план реализация

Обязательная последовательность для этого изменения:

1. **Архитектура.** Описать целевое решение в `ARCHITECTURE.md`, отделив его от уже реализованных гарантий, и проверить согласованность с ownership, Character State, Conversation Admission, Speech API и model application boundary. На текущем этапе выполнено.
2. **План.** На основе канонического решения описать Work Items, зависимости и приёмку; проверить каждый пункт по матрице ниже. На текущем этапе выполнена документальная сверка. Она не означает, что код уже соответствует целевым гарантиям.
3. **Реализация.** Только после первых двух шагов менять код отдельными Work Items: baseline, bugfix, contract/implementation и intentional behavior change не смешиваются. В текущем Work Item реализация не начинается.
4. **Проверка реализации.** Для каждого последующего Work Item сверять diff с архитектурой, выполнять применимые проверки и обновлять фактический статус. Новый конфликт сначала возвращается в архитектурное решение и план.

Порядок дополнительно закреплён в `AGENTS.md`, раздел 2. Это контроль последовательности работы, а не запрос дополнительного подтверждения уже разрешённых действий.

### Сверка плана с канонической архитектурой

| Решение в ARCHITECTURE.md | Соответствующая работа | Результат сверки проекта |
| --- | --- | --- |
| §3, §20: единственный Avatar owner, semantic intent, отсутствие нового Runtime | 2–4 | Phase executor, graph и hand composition остаются внутри Body Animation Domain; Main владеет существующим Adapter. |
| [Character LLM embodiment prompting](../ARCHITECTURE.md#planned-character-llm-embodiment-prompting): System Prompt, availability и ранний typed intent | 2, 2a, 3, 5 | После архитектуры и схемы обновляются prompt/Composer/parsers; LLM выбирает смысл, Runtime — профиль и исполнение. Внутренние markers не становятся речью или direct bone authority. |
| [Phased motion composition](../ARCHITECTURE.md#planned-phased-motion-composition): только standing, физически допустимые переходы | 2–4, 7–8 | Все 28 профилей стоячие; сидение и связанные последовательности исключены. |
| Phased motion composition: readiness, phases, typed outcome, real blend | 0–4 | Preparing не считается completion; исходный early-fallback дефект исправляется отдельно, до смены пресета. |
| Phased motion composition: обе кисти и пальцы по общей фазе | 2–4, 7–8 | Все 28 записей имеют hand score обеих рук, rig calibration и общий exit condition. |
| §16 и [Streaming speech and motion timing](../ARCHITECTURE.md#planned-streaming-speech-and-motion-timing): AudioPlayer и consumed PCM | 0, 3, 5 | Нет второго playback clock; packet arrival/ACK/complete не заменяют audible start/finish. |
| §14–16: Admission, Single-Flight и cancellation settlement | 1, 5 | Новая библиотека не добавляет barge-in/admission path; старые generation/cues инвалидируются, обязательный cleanup ожидается. |
| Streaming speech and motion timing: API/worker ownership и отдельные identities | 2, 5 | Сохраняются HTTP 2.1, stream protocol 2, независимые окружения и проверяемая связь turn/playback/motion IDs. |
| [Secondary motion and facial continuity](../ARCHITECTURE.md#planned-secondary-motion-and-facial-continuity): уши/хвост/Spring Bones | 0, 4, 6 | Сохранены owners, настройки и control-pose → solver path; отдельная квалификация на реальной VRM обязательна. |
| §20 и Secondary motion and facial continuity: Blink, Speaking Eye, gaze, LipSync | 0, 5–6 | ARDY/hand mask исключает эти каналы; face/gaze composition не заменяется body playback. |
| Secondary motion and facial continuity: разные часы речи и естественной жизни | 3, 5–6 | PCM buffering удерживает речевые жесты; Blink, ambient ear/tail и Spring settling продолжают local time. |
| §20: Overlay — presentation consumer | 4–6, 8 | Один body/hand source, существующий mouth projection, один physics update на экземпляр VRM и отсутствие двойной симуляции spring transforms. |
| Implementation and acceptance boundary: typed lifecycle, bounded resources, отдельные Work Items | 0–8, включая 2a | Обязанности разделены; extraction не меняет поведение, художественная смена пресета вынесена после технических и preservation checks. |

Конфликтов проекта плана с указанными границами не найдено. Разрывы текущей реализации с целевой архитектурой перечислены в ревью и не объявлены исправленными. В частности, текущие preparing/complete, blend, phase-aware hand score, speech scheduler и System Prompt/early intent path требуют реализации.

### Этапы после архитектурной сверки

Последовательность разделяет исправление дефектов, изменение контрактов и намеренную смену поведения. Во время миграции текущие working-tree изменения пользователя сохраняются; массовый откат или удаление уже сделанной ARDY-работы не требуется.

| Work Item | Изменение | Основные места | Критерий завершения |
| --- | --- | --- | --- |
| 0 | Зафиксировать текущие baseline и воспроизводимые проблемы без смены поведения. | Avatar/speech/ear/facial tests, qualification scenarios, catalog check. | Есть delayed-first-frame regression, проверка blend и stop/underrun; сохранён baseline ушей, хвоста, Spring Bones, Blink, Speaking Eye, gaze и LipSync. |
| 1 | Исправить lifecycle и распространение фактической transition policy. Это отдельный bugfix, без замены пресета. | AnimationController, PlaybackCoordinator, VrmAnimationTypes, GeneratedBodyPlayback. | Очередь не завершает preparing; transition timing влияет на playback и правдиво отражается в debug; устаревшее completion не меняет новый execution. |
| 2 | Ввести versioned contract для standing posture, phases, hand scores, constraints и outcome. Сохранить текущий выбор через ограниченный compatibility adapter. | `contracts`, sync tooling, Shared Motion, Main Motion IPC/service, Python worker. | Строгая схема для обеих кистей и пальцев, generated types, handshake, stale rejection и двусторонняя версия; старый путь остаётся функциональным до переключения. |
| 2a | Обновить System Prompt Character LLM и путь получения раннего semantic embodiment intent после этапа 2, до этапов 3 и 5. | CharacterPrompt.ts, CharacterRequestComposer.ts, shared character-response/stream contracts, safe incremental filter, final parser, catalog mappings и их tests. | Словарь и примеры совпадают со схемой; availability request-scoped и bounded; intent готов до целевой фазы, late intent не перезапускает речь; нет утечек/прямых model commands; prompt-budget/contract/streaming tests проходят. |
| 3 | Перевести один стоячий reference gesture на phase executor и контактный graph вместе с кистями и пальцами. Затем подключить остальные источники запросов. | Avatar Runtime body domain, queue, transition policy, schedulers. | Один execution/phase/clock для тела и обеих рук; общий путь idle/speaking/preview; safe exit включает wrist/fingers; PCM и local clocks явно разделены; bounded queue/TTL. |
| 4 | Расширить ARDY Adapter ограничениями и final composition, реализовать калиброванные фазовые hand scores. | `motion/backend.py`, GeneratedBodyPlayback/Safety/HandPose, rig calibration. | History/phase continuity, именованные контакты, per-hand wrist/finger curves, единый финальный writer, согласованные corrections, freeze/cancel/recovery и Overlay projection. |
| 5 | Связать phase executor с существующим streaming TTS S2 Pro через typed playback projections. | SpeechOutputPort, AudioPlayer clock projection, ConversationPresentationPort, Avatar schedulers; API wire contract сохраняется. | Чанки не перезапускают жест/рот; cues следуют consumed PCM; buffering, provider-complete, последний sample, cancel и settlement различаются; ошибка ARDY не блокирует здоровый звук/LipSync. |
| 6 | Подтвердить сохранение secondary/facial integration при новом исполнителе. Извлечение helpers, если нужно, сохраняет поведение. | VrmModel update path, existing ear/tail, procedural, gaze, Blink/eye/mouth owners, VRM Spring integration и Overlay. | Пройдена матрица сохранения ниже: один update path, прежние бизнес-правила и параметры, нет double offsets/physics, stuck blink/mouth и stale rig refs. |
| 7 | Создать и квалифицировать первые 12 профилей нового пресета после этапов 0–6, включая 2a, затем заменить default. Это намеренное изменение поведения. | Новый canonical catalog revision и typed intent mappings. | 6 presence + greet, agree, explain-one-palm, reassure, thank, shy; у всех готов hand score обеих рук на реальной VRM в Preview и Overlay; Character LLM выбирает поддерживаемый intent, S2 Pro и все сохранённые каналы работают совместно. |
| 8 | Выпустить все 28 стоячих профилей и переработанный экран библиотеки. | Catalog, AvatarPreviewView, localization, diagnostics projections. | Для всех 28 квалифицированы руки/кисти/пальцы и переходы; совместная speech/secondary/facial матрица, крупный Preview кистей, RU/EN, light/dark; старые клиповые поля убраны после миграции потребителей. |

Нельзя объединять behavior-preserving extraction с художественной сменой поведения в одном Work Item. Отдельно документировать deliberate contract decisions в `ARCHITECTURE.md`; этот отчёт не становится вторым каноническим описанием архитектуры.

Compatibility adapter не должен навсегда удерживать старые `neutral2`, `file = ARDY/id`, все прежние категории и жёсткое количество записей. После переключения потребителей удалить только действительно неиспользуемые адаптационные поля; diagnostics и health сохраняются в новой честной форме.

## Приёмка

### Матрица сохранения существующих каналов

| Сценарий | Что обязательно сохранить | Нужное доказательство |
| --- | --- | --- |
| Idle → listening → thinking → speaking → idle | Профили и emotion modifiers ушей/хвоста, их cooldown/асимметрия, сохранение pose между жестами | Детерминированные проверки existing owners и сравнение с baseline на реальной VRM. |
| Любой из 28 gestures вместе с ear/tail behavior | Body/hand mask не затрагивает их кости; offsets не копятся; Spring реагирует на движение тела | Bone membership guards, ordering tests и квалификация настоящих spring chains/colliders. |
| Emotion + Blink + Speaking Eye + LipSync одновременно | Моргание закрывается/открывается, squint не прячет глаза, mouth остаётся читаемым, expression writer один | Тест composition и визуальное сочетание happy/sad/angry/surprised с реальной речью. |
| Gaze user/screen/camera во время жеста | Существующая gaze arbitration, head suppression и независимость от body mask | Детерминированные priority/mask tests и наблюдение без борьбы головы с жестом. |
| Streaming S2 Pro с несколькими PCM/delivery boundaries | Один playback/LipSync lifecycle, без сброса рук/пальцев/рта/ушей на каждом пакете | Speech-output/PCM tests и joint speech-motion qualification. |
| Buffering и временный ARDY underrun | Речевые фазы удержаны; рот не продолжает ложную артикуляцию; Blink, ambient ears/tail и Spring settling живы | Детерминированный clock/failure scenario и visual pause/resume. |
| TTS complete при ещё звучащей очереди | LipSync и speech-bound motion учитывают непрослушанный хвост PCM | Тест producer-complete против playback-complete и live audible observation. |
| Body stop, TTS cancel, Emergency Stop | Старые poses/cues не применяются; рот bounded release; чужие каналы не получают blanket reset | Cancellation/late-callback tests и проверка действительной остановки обоих inference workers. |
| Model replacement/reload и отсутствие optional appendages | Старые refs/offsets удалены; один набор controllers/subscriptions; Core работает без ушей/хвоста | Lifecycle tests, live reload и model fixtures с/без secondary capabilities. |
| Preview закрыт, Overlay открыт, затем Preview снова открыт | Body source один; mouth/body projection согласованы; на каждой VRM один physics path без двойной симуляции | Projection/order tests и реальная проверка обоих presentation modes. |

Синтетический тест без spring chains подтверждает только логику controller или порядок вызовов. Совместимость реальных Spring Bones и отсутствие пересечений подтверждаются отдельно на целевой VRM; passing unit tests не заменяет эту квалификацию.

### Детерминированные проверки

- Медленный первый чанк: `preparing` сохраняется, очередь не запускает fallback; завершение относится к точному execution ID.
- Prompt/schema/catalog mappings рекламируют одинаковый semantic vocabulary; availability относится к текущим catalog/model generation, формат не разрушается при насыщенном Composer budget.
- Early/late/missing/malformed intent, chunk-split marker и tool evidence не вызывают утечку в chat/TTS/history или прямое управление костями; поздний intent не меняет прошлое playback.
- Новый запрос во время каждого из четырёх этапов: допустимый bridge/recovery либо явный отказ, без прямой замены опоры.
- Forbidden edges: raised-hand wave → hand-at-heart без bridge, мгновенная смена relaxed fingers → V и смена ведущей руки посреди фазы; Preview проходит те же ограничения.
- PCM buffering: cursor, речевая фаза и семантический акцент не убегают вперёд; local idle/recovery clock работает отдельно.
- Просроченный чанк, старая фаза, seed, model generation, catalog revision и playback ID отвергаются.
- Queue boundedness, TTL, supersede и корректное начало family cooldown. Отсутствие доступного жеста даёт presence.
- Stop/failure/model replacement не применяют ни одного старого generated frame; settlement подтверждает остановку inference.
- Контакты соответствуют фазе; foot anchors не прыгают при смене жеста. Root continuity проверяется отдельно от rotations.
- Все 28 профилей имеют явный hand score обеих рук; валидатор отвергает отсутствующие wrist/finger phases и несовместимую rig calibration.
- Подготовка формы пальцев, ориентация ладони, смысловой акцент, hold и recovery связаны с тем же execution/phase/cursor, что и рука. Для точных форм отдельная случайная вариация подавлена.
- PCM pause/underrun, replan, supersede и cancellation не рассинхронизируют тело, кисти и пальцы; новый score продолжает фактически применённую позу.
- Side-aware hand score не переносит ведущий жест на поддерживающую кисть; без требуемого finger rig профиль недоступен.
- Completion ждёт общего выхода рук, кистей и пальцев; Overlay получает те же wrist/finger transforms без второго hand executor.
- Head/neck/face exclusion, единственный facial writer, однократное breathing composition, Overlay без генератора и второго body motion.
- ARDY/hand exclusion для ear/tail bones, один установленный VRM/Spring update path, сохранение ear/tail offsets и отсутствие blanket reset при body stop.
- Blink, Speaking Eye и LipSync продолжают композицию независимо от body loading/degraded; gaze сохраняет существующие приоритеты.
- Первый PCM packet, transport ACK, provider complete и последний consumed sample имеют разные эффекты; очередной пакет не создаёт новый gesture/LipSync session.
- UI показывает selected/running отдельно, квалификацию и реальные причины недоступности; обе локали и темы.

### Визуальная квалификация

Для каждого из 28 профилей начать с 12 фиксированных seeds на целевой VRM. Проверить полный рост, по грудь и лицо; mask камеры не освобождает скрытые кости от ограничений. Отдельно проверить поддерживаемые VRM0/VRM1 пути на реальных моделях. Если прикреплённый художественный референс не совпадает с загруженной VRM, приёмка проводится повторно на целевой модели.

Проверить все допустимые классы переходов и запреты графа, включая последовательности «приветствие → слушание → объяснение → поддержка → покой», interruption во время raised hand и смену формы кисти между жестами. Для каждого из 28 профилей дополнительно просмотреть обе кисти крупно: поворот ладони, сгиб запястья, форму всех пальцев, подготовку к акценту и расслабление при возврате.

Начальные измеримые критерии для настройки, не готовые результаты:

- Отсутствуют A/T-pose, скачки рук/кистей/пальцев и незавершённый hand score с объявленным `completed`.
- Целевые hand-shape и wrist orientation достигаются к указанному акценту с допуском не более одного source frame (50 мс при 20 FPS); диапазон допустимой ошибки формы задаёт калиброванный score. Это допуск фазовой привязки, а не разрешение запаздывать за рукой постоянно.
- Во время hold нет пересечения пальцев, заломов запястья и случайного разрушения V/«лапки». Recovery и переход между жестами не дают мгновенного обнуления curl или thumb opposition.
- Для planted feet целевой drift — до 1 см на аватаре человеческого масштаба; метрика нормируется по росту модели.
- На стыке запланированного перехода нет разового скачка root более 1 см и wrist более 2 см при source 20 FPS. Пороги уточняются по намеренной скорости движения; их нельзя применять как глобальный запрет быстрых акцентов.
- Большие изменения углов/скорости на стыке отдельно отмечаются qualification runner; визуальное решение нельзя подменить одним scalar score.
- Повторяющиеся safety corrections означают, что профиль требует доработки constraints/conditioning. Работа ограничителя сама по себе не делает профиль красивым.
- Generated horizon в 0,4 с должен стабильно производиться быстрее потребления с запасом на IPC/render. Измерить p50/p95/p99 inference и underrun под совместной нагрузкой Fish; отдельное быстрое GPU-измерение этого не доказывает.
- Длительный диалог, молчание, отключённый Preview, Overlay, model reload и несколько отмен не увеличивают очередь или число owned processes.

Новая квалификация дополняет существующий `qualify:speech-motion`. Проверки реального клиента после реализации включают VRM loading, idle, generation request/preview вместо удалённого VRMA loader, speaking, LipSync, transitions, Overlay и Runtime Health. Требование старой формулировки про `loadAnimation` нужно согласованно обновить при отдельном исправлении документации ARDY migration.

## Проверки выполненные при ревью

1. `npm run motion:catalog:check` — успешно: 39 motion profiles, 25 emotion cues, производные каталоги согласованы.
2. `npm --prefix apps/desktop run test -- tests/unit/avatar tests/integration/avatar-visual-motion.test.ts` — 10 файлов, 52 теста прошли.
3. `npm run motion:research:test -- -q` — 28 Python-тестов прошли; это детерминированные проверки, без запуска inference-модели.
4. In-memory reproducer с настоящими `AvatarAnimationController` и `AvatarPlaybackCoordinator` и отложенным model port — до первого кадра получены запросы `[acknowledge, neutral_idle]`. Подтверждено преждевременное продвижение очереди.
5. In-memory проверка передачи blend — requested 0,8 с присутствует в controller debug, но отсутствует в context вызова model port. Подтверждён разрыв контракта.
6. Проверены текущие contracts, renderer selection/queue/schedulers/playback/composition, Main Motion service/IPC, Python backend/worker, Preview, относящиеся к задаче тесты, архитектурные правила и локальные закреплённые ARDY constraint classes.

При уточнении плана отдельно проверены: ровно 28 уникальных стоячих профилей и 28 соответствующих hand scores, отсутствие набора сидения и связанных задач в целевом плане, корректный JSON-пример и форматирование Markdown. Application tests при этом обновлении документа повторно не запускались; результаты выше относятся к исходному ревью.

При добавлении сквозной ARDY/S2 Pro координации сверены `VrmModel`, `AvatarFacialRuntime`, existing ear/tail controllers, `AvatarExpressionMixer`, `LipSync`, `SpeechOutputPort`, `ConversationPresentationPort`, speech cleanup и порядок установленного VRM/Spring update. Выполнена команда `npm --prefix apps/desktop run test -- tests/integration/ear-behavior.test.ts tests/integration/avatar-visual-motion.test.ts tests/unit/avatar/vrm-composition.test.ts tests/integration/speech/pcm-stream-playback.test.ts tests/integration/speech/streaming-tts.test.ts tests/integration/speech/speech-output-port.test.ts`: 6 файлов, 17 тестов прошли. Это baseline существующего поведения, а не проверка ещё не написанного phase executor или настоящей spring physics.

Затем целевые решения намеренно записаны в `ARCHITECTURE.md` как planned contracts и сверены с ownership/invariants; порядок архитектура → план → код закреплён в `AGENTS.md`. После этого пересмотрены этапы 0–8 и выполнена документальная сверка по матрице. Runtime-код на этих этапах не менялся.

При уточнении System Prompt сначала добавлен канонический `Planned Character LLM embodiment prompting`, затем этап 2a и его сверка с архитектурой. Проверены текущие `CharacterPrompt`, `CharacterRequestComposer` и typed embodiment schema. Baseline-команда `npm --prefix apps/desktop run test -- tests/integration/prompt-budget.test.ts tests/integration/structured-embodiment.test.ts tests/integration/embodiment-polish.test.ts` прошла: 3 файла, 3 теста. Prompt-код и parsers не менялись; новые семантические и streaming гарантии ещё требуют реализации.

Проверка документов подтвердила четыре уникальных канонических раздела и разрешимые ссылки на них, соответствие всех 28 профилей их hand scores, отсутствие профилей сидения, последовательность этапов 0–8 с обязательным 2a между 2 и 3, корректный JSON-пример и закрытые code fences. `git diff --check -- ARCHITECTURE.md AGENTS.md` прошёл; существующие пользовательские правки в этих файлах сохранены.

Live Electron и real GPU qualification в этом Work Item не запускались: запрос относится к ревью и плану. Новый пресет пока является спецификацией движений; новые trajectories не сгенерированы и не прошли художественную приёмку. `build`, общий typecheck и полные application suites не запускались, потому что исходный код не менялся. Проходящие focused tests не доказывают отсутствие описанных lifecycle/transition дефектов.

## Что изменено

Подготовлен этот отчёт с архитектурным ревью, новым пресетом, переходами, проектом контрактов, планом клиента и критериями приёмки. По уточнению пользователя удалён весь набор сидения; для всех 28 стоячих движений обязательны согласованные hand scores. Добавлены сквозная S2 Pro coordination, требования к читаемому typed коду и матрица сохранения ears/tail/Spring Bones/Blink/Speaking Eye/gaze/LipSync. Целевое решение сначала внесено в канонический `ARCHITECTURE.md`, рабочий порядок закреплён в `AGENTS.md`, затем с архитектурой сверён план. Runtime, versioned machine-readable contracts и остальные пользовательские незакоммиченные изменения не редактировались.

## Root Cause

Для главного класса проблем: замена источника движения VRMA → ARDY сохранила клиповую модель управления, не добавив физическое состояние, фазы и явное завершение. Для воспроизведённого раннего fallback: `playing` устанавливается до readiness, getter превращает его в `idle`, queue трактует это как completion. Для blend: рассчитанный параметр теряется перед model port.

## Почему фикс работает

N/A — исправления кода в этом Work Item не выполнялись. Предлагаемая архитектура делает законность перехода и завершение явными, но её гарантии должны быть подтверждены реализацией и приёмкой.

## Файлы

`ARCHITECTURE.md`, `AGENTS.md`, `docs/ANIMATION-ARCHITECTURE-REVIEW-AND-PRESET.md`.

## Ограничения

Ревью подтверждает структуру и два детерминированных дефекта жизненного цикла/передачи параметров. Оно не утверждает, что на приложенном скриншоте наблюдается конкретный момент сбоя, или что предлагаемая хореография уже красиво исполняется текущими весами ARDY. Физика костюма и доступность rig capabilities требуют фактической целевой VRM.
