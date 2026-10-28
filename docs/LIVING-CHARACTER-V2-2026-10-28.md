# Living Character v2 — рабочий отчёт

Исходный HEAD: `0de6f3838439702bc239b541bb6d0f656b95cb7e`.
Ветка: `experiment/motionbricks-somax-hand-living-v1`.
Текущее состояние публикуется отдельным commit/push по прямой команде пользователя
после остановки разработки. Художественная приёмка PENDING; это промежуточный
экспериментальный snapshot, не завершённый Living Character v2 и не release.

## Architecture Review

Main сохраняет единственный motion Adapter и процесс. Avatar Runtime сохраняет
retargeting, IK и финальную композицию. AudioPlayer остаётся единственным владельцем
PCM, буфера и consumed cursor. Добавлена только ограниченная RMS metadata уже
submitted PCM, без хранения копии аудио и без предсказания недоступной речи.
Она не выбирает semantic intent. Character Embodiment Intent остаётся источником
семантики, новый Behavior/Facial Runtime не создаётся. Facial acting проходит
через прежний AvatarExpressionMixer. Overlay потребляет ту же композицию.
Fish/ASR/Character provider, HTTP API, камера пользователя, launcher, release/CI
и protected governance/architecture остаются прежними. ARDY сохранён;
при выбранном MotionBricks не запускается.

## WI8 — Root Cause

Baseline real Chat: LLM `explain` → `explain_point_close`, полный путь кисти
48.62 cm, audible stroke ведущей кисти 0.956 cm. Подготовка не является stroke.

Проверены три причины:

1. Prepare/stroke использовали почти одну цель; goal заново варьировался внутри
   autoregressive generation, не фиксировался на фазу. Planner игнорировал
   dimensionless catalog anchors/offsets/extents и использовал отдельные offsets.
2. Длительность native перехода не была связана с бюджетом фазы. Штатные 8–14
   tokens дают 26–50 valid frames, включая повторённый frame zero. Endpoint
   мог оказаться за 800 ms stroke `explain_point_close`.
3. Workspace/IK сжимает избыточный source path в маленький admissible region.
   На сохранённом native source hash
   `3a01e33c264ec8dc3e3a2e332551264195673e33622a644834676d662f61adc3`:
   right wrist 14.86 cm artistic → 4.67 cm admissible → 2.77 cm final.
   Unresolved contacts = 0. Отключение safety не является исправлением.

Проверка дополнительной elbow-plane выборки не дала изменений на идентичном source;
экспериментальное изменение удалено. Нет основания менять этот safety алгоритм.

## Что изменено и почему это работает

- Pose goals используют прежние catalog regions. Prepare/stroke имеют разные
  ограниченные точки внутри одной области. Цель сохраняется на execution/phase;
  bounded seed variation не меняется при каждом model block. История и momentum
  учитываются при входе. Neural transitions остаются MotionBricks.
- Native allowed token count ограничивается фактическим phase budget:
  `valid frames = 4*tokens-6`, endpoint `(valid-1)/30`. Нет ускорения готового клипа,
  постфактум retiming или увеличения damping.
- AudioPlayer отдаёт не более 30 50-ms energy bins уже submitted PCM;
  накопление не двигает consumed position. Replanning использует только
  доступный sustained accent; слишком ранний для native модели cue отбрасывается.
  В IPC нет PCM, слов, provider prompts или новой authority.
- SOMA-X target construction учитывает curl, spread и thumb opposition.
  Per-finger temporal articulation привязана к точной body phase/frame, включая
  rollback; prepare частично раскрывает кисть, stroke завершает действие.
  Wrist не входит в native finger payload. Native PCA и существующий
  SomaHandRetargeting сохранены. Это ещё не Hand Quality PASS.
- Прежний FacialActingController получает разные эмоциональные envelopes для
  век/бровей/улыбки. Нового facial writer нет; Blink/LipSync остаются в Mixer.
- Qualification учитывает реально consumed phase frames, промежуточные FK
  стадии и отдельные CPU/worker pipeline timings. Артефакты остаются ignored.

## Промежуточные проверки

- Первый real short Chat с новым planner: `explain` → `explain_point_close`,
  без runtime errors, технический stroke минимум достигнут (1.519 cm).
  Полный runner честно FAIL: это 35 s, а gate требует 300 s.
- Offline native timing replay с настоящими 16/24/8 consumed phase frames:
  pointing final wrist excursion 7.28 cm; one-palm 4.87 cm.
  Это численные данные, не artistic acceptance и не сравнение идентичного
  neural source между разными planner версиями.
- Проверки planner/prosody/PCM ownership и facial mixer выполняются по мере изменений.

## GPU performance, Live Chat и видео

Измерения полной кандидатной версии и финальная 300-секундная запись — PENDING.
Локальные before/after sources и replay reports:
`apps/desktop/motion/.artifacts/living-v2/`.
Первый короткий real Chat/video со звуком:
`apps/desktop/motion/.artifacts/joint-2026-10-28T13-04-47-308Z/`.

## Файлы

Изменения ограничены экспериментальным worker/planner/hand, typed motion metadata,
AudioPlayer-derived energy, существующими Avatar/Facial owners, qualification
и соответствующими регрессиями. Полный перечень даёт `git diff --stat`.

## Ограничения и готовность

Все WI и Definition of Done требуют итоговой проверки. Не заявлены художественный
PASS, точность фонемного LipSync, отсутствие finger intersections или готовность
MotionBricks окончательно заменить ARDY. Отдельная close-up запись на реальной VRM,
серии коротких/длинных/эмоциональных ответов, idle 120 s, lifecycle smoke и 300 s
continuous Chat ещё должны быть выполнены. Пользовательская visual acceptance
остаётся обязательным финальным gate.

## Уточнение RCA на пользовательской VRM и выполненные регрессии

Пользовательская VRM имеет SHA-256
`bac0c6eb597e3840241f0d319f7cfeace0621a0b198129aa778fd76aba1a4fac`.
Указанные выше 7.28/4.87 cm offline replay относились к bundled rig; они не
подменяют проверку этого пользовательского rig.

На пользовательском rig live trace показал, что explain/greeting/celebrate
на протяжении всего stroke выбирали один и тот же workspace offset
`[-0.9, 0.9, 0.9]`. Центр старой face-region под подбородком заставлял кисть
работать у предела wrist deviation. Небольшое геометрическое смещение той же
области к собственному измеренному плечу устранило corner lock. Поля region
extents, palm/finger constraints, collision, wrist и hinge limits не расширены.

Identical-source regression:

- native source SHA `0807d275053b3f69c80c9c1f282df5447c343f568bbe9c94205938f8235502e9`;
- тот же пользовательский VRM SHA и одинаковые consumed phase windows;
- artistic/source wrist 7.267 cm;
- admissible wrist 0.400 cm before → 5.447 cm after;
- unresolved contacts 0;
- `qualifications/motionbricks/compare.cjs` PASS. Это source preservation,
  а не доказательство художественной завершённости.

Проверка также обнаружила быстрый физический подъём локтя и возможность
перепроекции hinge после временного шага увеличить фактическую скорость.
Ограничение conversation velocity и поиск допустимого projected step теперь
находятся внутри того же единственного tracker/constraint pass. Отдельного
постфильтра нет; bandwidth presence=8 и gesture=48 не увеличивался.
Consumed-PCM catch-up у MotionBricks не даёт интегратору больше времени, чем
прошло render time. ARDY сохраняет прежнюю политику. Native stroke planning
ждёт физической готовности preparation, поэтому не связывает forecast с уже
прошедшим акустическим акцентом. Детерминированные регрессии это проверяют.

При native hand → recovery прежний procedural sampler не знал фактически
применённую PCA-позу пальцев. Handoff теперь начинает recovery от composed
finger pose; тест проверяет отсутствие скачка в нулевой точке. Форма SOMA-X
подбирается constrained least squares внутри того же native PCA bound ±2.5,
а не независимым clipping коэффициентов (для peace clipping затрагивал 8
коэффициентов и заметно возвращал пальцы к mean).

## Live результаты до финальной приёмки

- `joint-2026-10-28T13-47-47-949Z`: 18 реальных Chat turns, 440.315 s аудио,
  video capture 62.289 FPS, реальная пользовательская VRM, Mistral Character,
  Fish S2 Pro, MotionBricks + native Hand. Все отдельные speech/runtime checks
  прошли. Два long scenarios Readability FAIL: thanks вместо explain (hand
  вне кадра) и отсутствие semantic intent. Третье объяснение — stroke 6.026 cm,
  joy — 3.502 cm. Общий run FAIL: detailed trace превысил 24,000 frames.
  Полное raw video/audio сохранено, произведён отдельный честно обозначенный
  export `living-v2-440s-with-audio.mp4`; failure не переписан в PASS.
- Полный raw trace теперь можно снимать отдельным body-only 30-Hz diagnostic
  sampling (`--body-trace-only`), сохраняя независимое настоящее 60+ FPS video,
  FPS probe и отдельную полную finger qualification. Объявляются stride и
  overflow; thresholds acceptance не снижены.
- `joint-2026-10-28T14-22-01-079Z`: 8/8 technical body/hand scenarios PASS:
  greet_wave_soft, explain_one_palm, explain_point_close, peace_single,
  shy_gather, presence_poised, fox_paw_single, delight_hands_open.
  Completed gestures, contacts 0, максимальный normalized body step около
  2.9° при прежнем лимите 3°. Для каждого записан Preview close-up video,
  включая recovery. Artistic/Hand Quality остаются PENDING visual review.
- Native captures seeds 17/101/271 из одной начальной позы находятся в
  `motion/.artifacts/living-v2/seed-*.json`; code/pin hashes сохранены.

Следующий candidate использует реальную projection visibility вместо одного
грубого camera label при selected MotionBricks, сохраняя запрет offscreen
workspaces. Это не меняет камеру и не расширяет catalog. Уточнена существующая
семантическая prompt-инструкция: выбрать главный коммуникативный акт текущего
ответа, а не формальную вежливость предыдущего. Character provider/persona,
LLM implementation, tools и протокол не заменялись; fake gesture hints и
keyword routing не добавлены.

## Остановка и публикация по команде пользователя

Пользователь остановил работу и запросил push текущего состояния. Принадлежащие
последнему qualification run Electron/Overlay/MotionBricks processes завершены.
Speech API не завершался. Доработки после команды остановки не выполняются.

Последний run `joint-2026-10-28T14-44-44-532Z` остановлен пользователем после
десяти коротких ответов. Это **INTERRUPTED**, не PASS, не завершённая 300-s
qualification. Его частичные локальные видео/трассы могут не быть финализированы.
На этом candidate подтверждены реальный запуск Electron, загрузка выбранной VRM,
Character/Fish/AudioPlayer и работа единственного MotionBricks worker; полный
финальный набор сценариев не выполнен.

Перед commit повторно прошли полный Desktop regression 689/689 в 145 файлах,
fast 239/239, Python unit 8/8, Biome check/format/imports, TypeScript,
production build, speech asset verification, Python Ruff и git diff check.
Защищённые AGENTS.md и ARCHITECTURE.md
не изменяются. Модели, окружения, кэши, build output и локальные recordings в
commit не входят.

### Что осталось

1. **WI1 / WI2 / WI8:** добиться устойчиво подходящего semantic intent и читаемого
   audible stroke во всех обычных длинных объяснениях, сравнениях и радостных
   реакциях. Есть удачные случаи и исправленный source loss; общего PASS нет.
   В последнем run короткая радостная реплика дала лишь 0.78 cm stroke — ниже
   технического минимума. Проверить длительную речь: один начальный жест с
   последующим долгим спокойным состоянием ещё не доказывает полноценную
   разговорную жестикуляцию. Prosody steering реализован, но стабильная
   художественная синхронизация акцентов ещё не принята.
2. **WI3:** визуально проверить последний вариант bounded rest variation и
   переходов между намерениями; отдельный 120-s idle ещё не выполнен. Ранее
   принятая настройка calm MotionBricks presence сохранена, но это не заменяет
   финальный idle test текущего candidate.
3. **WI4:** просмотреть close-up videos обеих кистей, динамику, thumb opposition,
   spread, отсутствие инверсий/пересечений и возврат к relaxed. Есть 8/8 technical
   scenarios и правые close-up videos; Hand Quality/artistic PASS не объявлен.
   Последняя небольшая rest-variation доработка добавлена после этого 8/8 run.
4. **WI5:** закончить визуальную эмоциональную матрицу радости, удивления,
   смущения и задумчивости и проверить выразительность в долгой речи. Mixer,
   blink и viseme regression прошли; точность фонемного LipSync не измерялась.
5. **WI6:** закончить interruption/cancellation, idle recovery, VRM reload,
   Overlay reconnect, worker error recovery и resource cleanup на финальном
   candidate. Полный запланированный lifecycle smoke не завершён; штатный
   300-s run с `--fixed-preview-smoke` прерван.
6. **WI7:** получить целиком завершённую final-candidate 300-s qualification
   без trace overflow, сводные p50/p95/p99 pipeline timings, временной ряд GPU
   и проверку Primary/Overlay composition/delay. Сборщики и offline analyzer
   готовы, часть телеметрии собрана, итоговая performance таблица не рассчитана.
   Native Fish CUDA-kernel timing не измерялся; Main TTS metrics включают
   transport/queue. Device GPU samples не являются per-process WDDM attribution.
7. **Финальная художественная приёмка пользователем.** Полная 440-s запись с
   реальными LLM/Fish сохранена локально от более раннего candidate, но она не
   подтверждает готовность последней версии. До закрытия этих gates заменять
   ARDY окончательно и включать MotionBricks в коммерческий пакет преждевременно.

Большие evidence остаются локально в `apps/desktop/motion/.artifacts/`.
