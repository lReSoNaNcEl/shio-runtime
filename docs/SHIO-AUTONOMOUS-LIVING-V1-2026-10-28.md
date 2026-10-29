# Shio Autonomous Living Character v1 — implementation and qualification

Ненормативный отчёт; выполнение 28–29 октября 2026 MSK. Protected архитектура не изменена.
Worktree `tmp/motionbricks-experiment`; commit/push не выполнялись.
**Final V13: live technical qualification PASS**, artifact `joint-2026-10-29T06-52-29-493Z`.
18/18 ordinary Chat scenarios, включая actual LLM-selected peace; continuous capture
971.312 s / 61.676 FPS, idle 120.625 s, layer/clock violations 0.
Preview, lifecycle и facial component matrix PASS. Обе hand camera qualifications 5/5 PASS.
Frozen snapshot `living-motion-1793256164875`; regression 727/727, fast 264/264,
Python motion 11/11, static checks/typecheck/build PASS. Current policy qualification
`joint-2026-10-29T07-12-17-121Z` PASS: Off/Suspend/Privacy и один voiced reminder.
EPIPE fault regression PASS; новых native crash dialogs в последующих проверках не наблюдалось.

Исправленный V проверен в actual Electron на пользовательской VRM: пальцы разделены,
signed spread 0.266929, distal span 19.014 mm, opening 19.529°. Сохранены close-up
и исходный кадр обычного Chat. Все неудачные предыдущие captures сохранены.
Native hand source SHA-256 `9981289703e5d5d7ace31d455abeff7bb67f3f8016b77d431935f659806bcb52`.
Кандидат предоставлен для пользовательской художественной приёмки; **Artistic Acceptance
PENDING USER REVIEW**. Полный Performance criterion остаётся FAIL из-за cold startup/recovery;
полная Definition of Done не объявляется безусловно выполненной.

## 1. Architecture Review

Прочитаны AGENTS.md, ARCHITECTURE.md, LIVING-CHARACTER-V2-2026-10-28.md,
LIVING-LOOP-2.md, ALIVE-AUTONOMY.md и контракты затронутых владельцев.
Отдельного файла Documentation Editing Policy в checkout нет; применены правила
change control из AGENTS.md. Protected документы сохранены.

Character LLM определяет ответ и semantic intent. Main Proactive Initiative Gate
сохраняет policy authority, Conversation Admission — допуск, Conversation Runtime —
исполнение. AudioPlayer остаётся единственным playback owner и источником consumed
PCM. Avatar владеет костями, AvatarExpressionMixer — финальной facial composition.
Overlay потребляет готовую композицию. Behavior не пишет кости или morph weights.
Один Main-owned MotionBricks worker; ARDY сохранён, параллельно не запускается.
HTTP speech contract, Plugin authority, launcher/release и внешние интеграции
не изменены. Новых Runtime и статических motion clips нет.

## 2. Baseline

- Исходная ветка `experiment/motionbricks-somax-hand-living-v1`, проверенный HEAD
  `67a03b6f160d6424700df73a68de46ce6cdda8ef`.
- `experiment/shio-autonomous-living-v1` создана строго от этого SHA.
- Основной ARDY checkout `62c1a20` и исходный branch ref сохранены; `main` не менялся.
- Пользовательская VRM0: SHA-256
  `bac0c6eb597e3840241f0d319f7cfeace0621a0b198129aa778fd76aba1a4fac`.
- MotionBricks revision `54fc563aeaaf819a753d72cc9fdc6713989cdd43`, native SOMA-X Hand.
  Полные pins, provider/model identities, build hashes и Git metadata — в report.json.
- Baseline `joint-2026-10-28T15-47-23-641Z`: один реальный explain,
  stroke 1.957 cm, capture 61.89 FPS; общий FAIL из-за длительности ниже 300 s.

Все названия `joint-*` и `epipe-*` ниже относительны к
`apps/desktop/motion/.artifacts/`. Неуспешные raw reports и videos сохранены.
Это dirty working-tree builds без нового commit: Git SHA обозначает baseline,
а точную реализацию идентифицируют source/build SHA-256 и frozen snapshot.

## 3. Root Causes

1. **EPIPE diagnostic helper.** Четыре сообщённых пользователем native error окна
   связаны со stdout `out/native-speech-ws-probe.cjs`: GUI helper переживал короткий
   shell и писал в закрытый pipe без штатной safe logging initialization.
2. **Busy nonverbal branch.** AliveFacade блокировал speech initiative, но передавал
   занятую conversation/audio в невербальную ветку Behavior и расходовал cooldown.
3. **Допущенная инициатива оставалась карточкой.** Renderer запускал разговор только
   для browser-specific presence; обычный Main-admitted reminder не доходил до
   существующего Conversation Admission.
4. **Недопустимая rest-цель локтя.** Quaternion interpolation между допустимыми
   позами не сохраняет hinge manifold. Реальная ошибка 0.102535 rad почти точно
   совпадала с отброшенной solver частью цели при exit tolerance 0.06 rad.
5. **Presence recovery терял скорость кистей.** Quiet source-speed envelope не
   обеспечивал достижение новой rest-цели в существующий budget. Дополнительно
   positional torso sweep уменьшал независимое wrist rotation, а safety layer
   удалял `reachSeconds` для relaxed workspace. Глобальный positional sweep также срезал независимое допустимое движение другой руки: real-rig regression сохранял 0.000972229 rad ошибки из шага 0.001 rad (97.2%). После global sweep теперь проверяется оставшийся bounded шаг каждой руки при сохранённом root/torso; проверяются обе руки и актуальный torso, прежние velocity/contact limits действуют. Этот regression падал до исправления и проходит после. Прежний timeout сохранён; final full run не содержит recovery timeouts. Последний wrist-случай подтверждён
   actual inner-filter probe: скорость 0.511352 rad/s оставалась quiet envelope.
6. **Ложный audio-clock jump.** Отложенные AudioWorklet reports после длинного
   compositor frame и обычный packet jitter принимались за discontinuity;
   накопленная presentation lag смешивалась со скачком исходного consumed cursor.
   Позднее exact 32-frame trace `joint-2026-10-28T22-50-50-215Z` выявил также
   последовательные frames 41.1/39.9 ms, после которых source report продвинулся
   на 2822 samples (63.991 ms) при следующем delta 12.4 ms. Старый one-frame
   credit учитывал только frames >50 ms и давал ложный discontinuity. Вся
   последовательность содержит 543.6 ms compositor time и 554.67 ms consumed
   audio, то есть укладывается в прежний tolerance. Новый fixture воспроизводит
   FAIL старого кода; credit теперь сохраняет неотчитанное elapsed time до
   прихода report, максимум в прежнем bounded window 250 ms, и очищается на
   buffering/reset/настоящем discontinuity. Нового разрешения catch-up нет.
7. **TTS после Stop раньше Fish readiness.** Реальная отмена уничтожает inference
   worker; acknowledgement предшествует reload/compile warmup примерно на 60–110 s.
   Следующий stream открывался во время warming и деградировал в text-only.
8. **Сингулярный finger-aligned elbow pole.** Сдвиг цели кисти на 2 mm через линию shoulder-to-hand переворачивал IK-плоскость локтя на pi rad. Фильтр сохранял предел скорости, поэтому физическая рука отставала от новой ориентации и могла исчерпать phase budget. `placeArm` теперь использует ранее применённую плоскость из previousArms в текущей системе родителя: переносит её на новый target ray, выбирает согласованную полусферу pole и разрешает точную коллинеарность прежней плоскостью. Source hand position, trajectory, budgets, скорости и constraints не меняются. ARDY path сохраняет прежнее поведение. Четыре real-rig regressions: обе руки при yaw 0/1.1; до фикса скачок 3.141593 rad, после — непрерывность и точное достижение collinear target.
9. **Hold следовал новой нейронной позе.** Две допустимые позы одного жеста
   сдвигали кисть на 13.6 cm в фазе удержания, хотя нового semantic target не было.
   В real Chat comparison prepare/stroke прошли, но в hold palm dot снизился до
   0.777747 при требовании 0.8. Для MotionBricks hold без authored trajectory
   теперь удерживает позицию последней фактически отображённой кисти. Prepare,
   stroke и explicit trajectory сохраняют источник движения.
10. **Recovery начинался из скрытого base.** После final safety отображаемая
    кость отличалась от сохранённого neural base на 0.3459878 rad (~19.82°).
    Recovery использовал этот скрытый base. Теперь на границе recovery берётся
    фактически отображённая поза с обратным преобразованием уже применённой
    procedural contribution; следующий compose добавляет её ровно один раз.
    Root начинает с actual position за вычетом уже добавленного procedural offset.
    Per-frame IK feedback в neural/base integrator не добавлен.
11. **PCA сжимал раскрытие пальцев.** На native SOMA-X prior и пользовательской
    VRM конечный fit peace sign давал 11.75136° при минимуме 12°; два live run
    показывали 11.51/11.52°. Равные ошибки MCP/PIP/DIP жертвовали ориентацией
    основания пальца ради distal fit. Existing bounded least-squares теперь
    приоритизирует MCP (вес 3), влияющий на всю цепь пальца, сохраняя native
    coefficient bounds ±2.5. Изолированный actual-rig target стал 14.18891°.
12. **Ошибки квалификационного harness.** Слишком короткий trace budget, повторный
   учёт одной Overlay pose, aliasing 60-Hz capture, требование только hold вместо
   здорового base presence и readiness по renderer cache искажали результаты.
13. **Разрыв выбранного forearm roll.** Read-only trace полного Chat
    `joint-2026-10-28T22-26-50-617Z` показал смену target twist между ±1.3 rad
    при небольшом изменении source. В comparison это сопровождалось prepare-only;
    в delight — `ARDY_SPATIAL_TARGET_UNREACHED`. Offline replay повторил target
    с ошибкой <0.0001 rad. В signed palm alignment raw roll менялся с −2.31939
    на +2.66237 rad; independent clamp давал скачок 2.6 rad, хотя raw orientation
    имеет непрерывный эквивалент через угол ±pi. Workspace solution теперь хранит
    выбранный bounded roll и разворачивает следующую candidate angle около него
    до прежнего clamp. Reference меняется только после выбора победившей candidate,
    а не внутри поиска. Applied pose может ещё отставать из-за acceleration bounds.
    Replay comparison target delta стал 0.01447 rad; сохранены before/after JSON.
    Отдельно raw hinge projection разворачивает source angle около применённого
    twist перед прежним clamp. Admitted targets, ARDY/legs, phase budgets, joint
    velocity/acceleration и anatomical limits не расширены. Следующие hand runs
    обеих сторон прошли 5/5; последующие V13 repeats обеих сторон 5/5 PASS.
14. **Authority переживала отменённый lease.** `joint-2026-10-28T23-21-06-669Z`
    прошёл 18/18 individual turns, но общий technical gate остался FAIL:
    139 presence/layer violations после Stop. Пока новый worker lease запускался,
    presentation уже была local `presence_poised`, а `getAppliedMotionLayer`
    выбирал старый gesture по `playing=true` и оставшемуся appliedProfileId.
    Теперь applied pose сохраняет свой lease identity; procedural authority и
    generated projection допускаются только для фактически применённого lease.
    Stop/detach освобождают эту identity. Integration test воспроизводит
    Stop → delayed replacement presence start: до fix `gesture` при local
    presence, после `base`. Active applied gesture authority сохраняется.
    Второй assertion этого же real-composition test обнаружил, что старый
    neural base и generated constraints продолжали сдвигать руку на 0.012561 rad
    (~0.72°) за кадр без нового applied lease. Во время замены lease теперь
    сохраняется отображённая поза; старые base restore, generated constraints и
    inverse-procedural capture не применяются. Штатная procedural composition
    продолжает выполняться один раз. Test проверяет точное удержание позы.
15. **Очередь не пересматривала presence handoff после protected stroke.**
    В V10 comparison intent поступил в 276608.5 ms во время `presence_thinking`
    stroke (276569.5–277338 ms). Direct presence → speech preparation проверялся
    только при первоначальном запросе. После окончания защищённой фазы очередь
    проходила rest recovery, и `explain_balance` применился лишь в 278554.1 ms,
    уже после ~0.8 s consumed speech. Ещё через ~1.8 s unchanged 2600-ms opening
    budget истёк; Runtime честно отменил unstarted accent. Speech completed,
    но strict comparison readability FAIL. Новая reconciliation повторяет тот же
    direct-presence guard на update при первом interruptible phase. Protected
    stroke, manual preview, physical turn и existing deadlines остаются защищены.
    Test падает до fix, проходит после; проверяет исходную отображённую позу
    handoff и bounded следующий шаг. Новый V11 targeted Chat прошёл explanation/compare 2/2 с actual LLM hints;
    в V11 full comparison также PASS; следующий V12 full повторяет короткий
    post-Stop input на той же production сборке.

16. **Cold recovery и общий qualification deadline.** V11 full
    `joint-2026-10-29T00-45-48-260Z` прошёл первые 16 scenarios, включая comparison
    и actual shy, но post-Stop turn превысил unchanged 120-s deadline.
    Это не отсутствие TTS: actual first PCM пришёл через 107,958 ms, проиграно
    530,235 samples (~12.02 s). LLM выдал 188 speech characters на просьбу
    «Ответь коротко»; harness отменил ещё звучащую реплику в 120,035 ms.
    Health после автоматического reload снова ready. V12 ordinary input
    конкретизирует исходный short-follow-up scenario: одно предложение до шести
    слов, содержание выбирает LLM. Код речи, 120-s limit, readiness bound,
    inference cancellation и все acceptance thresholds не менялись. Исходный
    input fixture и FAIL сохранены рядом с V11 report. Cold latency не считается
    исправленной или подходящей для обычной мгновенной беседы.

17. **Signed hand contrast терялся в expmap fit.** При противоположном spread
    двух почти прямых пальцев unsigned angle мог пройти, хотя пальцы сходились
    в плоскости ладони. Synthetic native-manifold regression: signed separation
    0.013433 до fix. Geometry-aware refinement сохраняет исходные 32 native PCA
    components и пределы ±2.5, использует wrist-local native FK directions и
    typed finger shape contrast, без profile-ID/phrase routing. Batch Jacobian
    ограничивает стоимость; bounded fit cache содержит максимум 128 shape keys.
    Все 32 profiles × 4 phases × 2 sides: 256/256 bounded fits, max 13.53 ms,
    p95 0.59 ms с cache reuse. Чистые hinge/axis и expanded-box эксперименты
    отвергнуты, коэффициентные bounds не расширены.
18. **Temporal articulation не достигал fitted endpoint.** Per-finger interpolation
    обновляла только 15 выбранных joints, оставляя native metacarpals/tips в старой
    позе перед повторной PCA projection. Regression воспроизводит потерю ровно
    50% latent mode: −0.176336 вместо −0.352672. Теперь вся 24-joint articulation
    проходит те же существующие finger timings; wrist исключён. После fix
    source stroke/hold достигают одного fitted endpoint. Python 11/11 PASS.
    Реальный V13 Electron right peace: technical PASS, 62.221 FPS, 19.529°,
    signed separation 0.266929, distal span 19.014 mm, max step 2.8974°/33.333 ms,
    contacts/timeouts 0. Исходное hold frame показывает разделённые V-пальцы.
    Artifact `joint-2026-10-29T06-44-12-334Z`; последующие V13 hand repeats обеих сторон
    5/5 и full ordinary Chat 18/18 PASS, включая самостоятельно выбранный peace.

## 4. Work Items

| WI | Работа и фактический результат |
|---|---|
| WI1 Coordination | Actual-pose recovery, lease authority, continuous clock и protected-presence handoff; final 18/18 scenarios PASS |
| WI2 Gestures | Character LLM сохраняет semantic ownership; strict explanation/comparison/joy/peace PASS; optional short accents отдельно отмечены weak/expired |
| WI3 Presence | Detailed idle >120 s обеих variants; final actual idle 120.625 s, spectral evidence; художественная естественность не принята автоматически |
| WI4 Hands | Geometry-aware native SOMA-X fit и все 24 joints; left/right 5/5 warmed gates, V распознаётся в close-up и ordinary Chat; artistic review pending |
| WI5 Face | Existing owners; final 9/9 component matrix и actual Fish LipSync; ограничения VRM channels отражены |
| WI6 Nonverbal | Busy arbitration до выбора/cooldown; intentions проходят existing Avatar owner |
| WI7 Initiative | admit/preview typed Main decision; Off/Suspend/Privacy negative и один озвученный permitted reminder PASS |
| WI8 Recovery | Real Stop → completed new PCM; reload, Overlay reconnect, owned worker fault/recovery PASS; cleanup 0 test processes |
| WI9 Performance | Main 61.676 FPS, detailed CPU/worker/GPU time series; полный Performance criterion FAIL из-за cold startup/recovery |
| WI10 15 min | Непрерывные 971.312 s со звуком, 18/18 technical scenarios; failed histories и input identities сохранены |

## 5. Изменённые файлы

Production:

- `src/main/alive/AliveFacade.ts`, `BehaviorRuntime.ts` — busy arbitration и
  типизированная проекция Main initiative decision.
- `src/shared/alive/contracts.ts`, `src/renderer/runtime/AliveExperienceRuntime.ts`,
  `src/renderer/Controller.ts` — admit/preview через существующий admission path.
- `src/main/speech/speechClient.ts` — отменяемое readiness ожидание и bounded
  transport diagnostics перед единственной следующей speech session.
- `motionbricks/hand_prior.py` — bounded native FK geometry refinement для signed
  finger contrast, batched Jacobian, fit cache и temporal interpolation всех 24 joints;
  native model/revision, 32 PCA components и coefficient bounds ±2.5 сохранены.
- `src/renderer/avatar/rendering/three/GeneratedBodyPlayback.ts`,
  `GeneratedBodySafety.ts`, `AdaptiveMotionFilter.ts`, `ConsumedMotionClock.ts` —
  attainable recovery и consumed cursor handling.

Все пути выше относительны к `apps/desktop`. Tests: hand_prior, mind-layer, initiative-admission,
speech-recovery, motionbricks-recovery, adaptive-motion-filter, consumed-motion-clock,
generated-motion, motion-failure-recovery и три числовых clock fixtures.
Два tests прямого final-composition вызова теперь задают моделируемый applied
lease, чтобы проверять действующий generated path после ownership guard.
Opt-in `--recovery-repro` в qualification сохраняет ограниченные entry/timeout
pose snapshots и последние стадии перед failure до сброса owner state, с
восстановлением всех hooks при stop; это не production diagnostics. Qualification: EPIPE fixture/runner, autonomous Chat
fixtures, policy, lifecycle, facial matrix, conversation/stabilization capture,
record-audio и README. Полный фактический список — `git status --short`.
Новых пользовательских UI строк/контролов и UI изменений нет.

## 6. Почему исправления работают

Safety проецирует саму изменённую rest-цель штатным constrainTarget. Recovery
использует прежний remaining budget; relaxed MotionBricks presence передаёт его
до фактического temporal filter. Wrist сохраняет уже допустимый шаг независимо
от positional sweep: его rotation не двигает endpoints проверяемой arm capsule.
Positional collisions, exit tolerance, deadlines, acceleration и velocity ceilings
не отключены. Real-rig tests охватывают обе кисти и отсутствие нового ARDY context.

Consumed clock отличает реальный source jump от presentation lag и сохраняет
bounded неотчитанное compositor time до прихода report. MAX_LAG 50 ms, reserve 1/30 s, step cap
50 ms и compositor bound 250 ms прежние. Настоящие скачки остаются discontinuity.
Непоказанный интервал не интегрируется задним числом и не прерывает валидный act.

SpeechClient после фактически начатой отмены опрашивает immutable Main endpoint
health каждые 500 ms максимум 120 s, только в loading/warming. Открывается ровно
один stream после ready; retry inference, перепосылки текста, fallback provider и
API changes нет. Stop/dispose прерывают HTTP ожидание; failure/deadline явные.

Main вычисляет embodimentAllowed до Behavior selection. Main Gate outcome
передаётся как ограниченный admit/preview, без новой authority. Renderer снова
проходит существующий admission; отсутствие disposition и preview остаются карточкой.
Quiet hours, Suspend, Privacy, cooldown и caps не отключались.

EPIPE helpers вызывают существующий initializeSafeLogging, имеют принадлежащий
Node parent и file progress. Bootstrap до bundle сохраняет неожиданный exception
в файл и завершает diagnostic helper с exit 1, не вызывая стандартный dialog.
В production нет blanket exception suppression. Fault test не создаёт окон/GPU.

Hold anchor использует existing applied arm pose; это transient solver state,
не Character State и не новая motion trajectory. Он освобождается при выходе
из hold, изменении target/provider и reset. Recovery boundary удаляет только
уже учтённый procedural transform и не меняет ownership Breath/MicroMotion.
Real-rig test выполняет настоящий compose/safety и доказывает ровно одно
добавление procedural rotation и root offset после recovery handoff.

SOMA-X fit сохраняет 32 statistical coefficients, исходный model asset и
диапазон ±2.5. Приоритет MCP увеличивает вес ориентации основания; PIP/DIP продолжают
участвовать в оптимизации. Новых фиксированных trajectories и finger timers нет.
Synthetic coupled-prior regression проверяет сохранение semantic abduction;
native-prior/actual-VRM probe и live close-ups проверяют реальный результат.

Roll continuity использует существующий transient workspace solution. Это выбор
эквивалентной ветви угла, а не новый filter или bone writer. Пределы ±1.3 rad
для предплечья сохраняются. Six real-rig angle-cut tests покрывают обе руки,
оба направления применённого twist, target-to-applied lag и сохранение уже
допустимых целей. До guard два почти одинаковых направления ладони давали
разницу 2.6 rad в целевом локальном предплечье; после guard <0.001 rad.

Applied layer и generated presentation используют одну actual applied lease
identity. До применения первого chunk нового lease прежние generated targets не
управляют телом, а procedural owners продолжают свою обычную композицию. Это
устраняет рассогласование presentation/authority после Stop без нового владельца
позы и без изменения скорости, phase budget или semantic intent.

Geometry-aware hand fitting проверяет направление расхождения пальцев в native
wrist-local FK, а не только unsigned opening. Все metacarpals/tips участвуют в
существующей temporal interpolation, поэтому fitted endpoint не теряется при
обратной PCA projection. Это не статический clip: source generation, finger delays,
quintic timing и consumed PCM clock остаются действующими.

## 7. Targeted Tests

- 19 real-rig preparation/recovery regressions: six signed-roll continuity cases,
  actual displayed recovery origin,
  once-only procedural composition/root, hold anchors обеих рук, pole continuity,
  hinge targets, независимый wrist step при
  positional contact sweep, inner-filter reach context для обеих кистей,
  MotionBricks/ARDY scope.
- 10 AdaptiveMotionFilter и 15 ConsumedMotionClock tests, включая три реальные
  числовые traces; прежний quiet recovery не достигал цели за 2.6 s.
- 5 speech readiness regressions: queued single send, waiting cancellation,
  failed readiness, deadline и dispose abort.
- Busy/cooldown и admitted initiative tests проверяют owner boundaries.
- Stop → delayed replacement integration проверяет layer, удержание фактически
  отображённой позы и отсутствие старой generated authority до первого chunk.
- Protected presence stroke → queued speech preparation: до fix test оставался
  на presence_thinking; после fix начинает explain_balance из actual pose,
  сохраняя protected stroke и bounded следующий шаг. Вместе с playback/recovery
  48/48 focused tests, затем 727/727 full regression.
- `epipe-2026-10-28T17-13-10-949Z/report.json`: **PASS**, два настоящих broken pipes,
  exit 0, BrowserWindows 0, unexpected exceptions 0, file logging продолжилось.
- `joint-2026-10-28T19-30-44-705Z`: реальные calm/explanation **2/2 PASS**, explain
  stroke 5.614 cm; оба вернулись в healthy base presence. Общий report **FAIL**:
  diagnostic subset короче неизменённого 300-s gate; это не итоговая приёмка.
- Final-build diagnostic `joint-2026-10-29T00-06-33-096Z`: concern, actual LLM
  shy, interrupted и after-stop **4/4 PASS**, layer violations 0, clock
  discontinuities 0; 200.507 s / 61.898 FPS. Concern stroke 3.034 cm,
  shy stroke 4.093 cm, after-stop consumed 288,472 actual PCM samples.
  Общий report **FAIL** по unchanged minimum duration 300 s; subset не
  используется как итоговая приёмка. Отдельный UI fixture лишь просит shy словами
  и проверяет выбранный LLM hint; ответ/intent не подставляется. Final full run
  использует исходный ordinary schedule без этого fixture.

- V11 diagnostic `joint-2026-10-29T00-43-14-474Z`: explanation и comparison
  **2/2 PASS**, actual hints explain/compare, stroke 18.604/3.534 cm,
  100.1805 s / 61.699 FPS, layer/clock violations 0. Read-only preload добавляет
  только expectedHint assertions, без изменения обычных UI inputs. Duration
  <300 s честно оставляет общий report FAIL. Последующие V11/V12 full reports отдельные.

- Native hand regressions: signed-contrast failure и exact 50% endpoint loss
  воспроизведены до исправления; Python 11/11 после. Native catalog preflight:
  32 profiles × 4 phases × 2 sides = 256/256 fits, max 13.53 ms, p95 0.59 ms.
- V13 live right peace, затем обе hand cameras и ordinary Chat peace PASS;
  thresholds не снижены. Cold initialization captures сохранены отдельно.

## 8. Full Regression and Build

После последнего production fix:

| Проверка | Результат |
|---|---|
| `npm --prefix apps/desktop run test:regression -- --maxWorkers=2` | **727/727**, 148 files, 69.22 s |
| `npm run desktop:test:fast` | **264/264**, 63 files, 2.23 s |
| `npm run desktop:check` | PASS; 3 существовавших ранее Biome infos в motion-ab/run.cjs |
| `npm run desktop:format:check` | PASS |
| `npm run desktop:imports:check` | PASS |
| `npm run typecheck` | PASS: Main, web и tests |
| `npm run build` | PASS, speech assets verified |
| `.venv/Scripts/python.exe -m unittest discover -s apps/desktop/motionbricks -p test_*.py` | **11/11 PASS** |
| Ruff check/format changed motion Python files | PASS |

Дополнительные Biome checks после уточнения short-input fixture: `tmp/final-v13-fixture-*.log`, все PASS.
Логи TS regression/fast `tmp/final-v13-regression.log`, `tmp/final-v13-fast.log`;
статические проверки/build `tmp/final-v13-*.log`; Python `tmp/final-v13-motion-python.log`.
Production source после V13 regression tests и frozen snapshot не менялся.
Root npm regression wrapper требует дополнительного `--`
для передачи maxWorkers; использован прямой эквивалент с двумя workers.
Один ранний regression запуск при параллельном 3D имел timer failure в browser
reactive lane; последующие isolated и полный final прошли. Failure не удалён.
Speech API оставлен running/ready на прежнем PID 30172. Принадлежащие qualification Electron/motion processes после закрытия: 0.
API source не менялся; ASR или все API endpoints заново не квалифицировались.
Первый V10 regression обнаружил test fixture без applied lease; fixture исправлен,
physical assertions не ослаблены. Исходный лог сохранён как
`tmp/final-v10-regression-initial.log`.

## 9. GPU Performance

Final evidence `joint-2026-10-29T06-52-29-493Z`: **971.312 s / 61.676 actual captured FPS**.
Primary 59,958, Overlay 60,699 render deltas;
545 distinct consumed horizons.
Diagnostic overflow: Primary False, Overlay False.

| Метрика, ms | p50 | p95 | p99 |
|---|---:|---:|---:|
| MotionBricks inference (whole horizon) | 33.70 | 51.99 | 62.57 |
| Target planning | 15.79 | 25.25 | 33.75 |
| Neural generation | 7.31 | 13.75 | 17.75 |
| SOMA-X Hand generation | 4.55 | 6.01 | 9.31 |
| Worker conversion | 4.64 | 6.78 | 9.41 |
| Renderer apply/retarget | 0.20 | 0.30 | 0.50 |
| Final constraints / IK composition | 0.60 | 0.90 | 1.30 |
| Contact sweep (nested) | 0.30 | 0.50 | 0.70 |
| Primary VrmModel CPU | 1.50 | 2.10 | 3.10 |
| Primary render delta | 16.00 | 17.00 | 26.10 |
| Overlay VrmModel CPU | 0.50 | 0.80 | 1.40 |
| Overlay render delta | 16.10 | 17.20 | 19.70 |
| Primary → Overlay projection age | 28.50 | 44.50 | 47.28 |

Primary max render delta 93.30 ms; Overlay max
45.40 ms. Max sampled Primary update 8.10 ms.
Peak unresolved arm contacts 0.
CPU costs sampled около 30 Hz; render deltas полные. Rows вложены, их нельзя складывать.
Overlay не запускает собственный inference.

Whole-device GPU n=162: usage p50/p95/p99 30.00/88.95/89.00%,
max 90.00%. VRAM p50/p95/max 26,973.50/28,318.45/30,175.00 MiB.
Это вся RTX 5090 под Windows WDDM, включая чужие процессы. Per-process usage/VRAM
не утверждаются; чужие Strata jobs не трогались. Полный временной ряд сохранён.

LLM TTFT aggregate n=18: p50/p95 4,813.00/14,027.00 ms.
TTS synthesis aggregate n=18: p50/max
319.00/107,932.00 ms.
Admission → first audio p50/max 6,708.00/112,309.00 ms.
Detailed normal-turn Fish first PCM p50/p95/p99
317.00/322.55/322.91 ms,
n=10. Detailed traces bounded, это не все 18 turns.

Первый observed applied gesture p50/p95 3,839.30/11,720.04 ms;
observed stroke 6,850.90/14,228.72 ms.
Это metadata proxy от admission, включающий provider latency, а не pixel-level onset.
Все sample counts/extrema и turn-level cancellation latency — `autonomous-summary.json`.
Cold initialization и cold post-cancel latency остаются ограничениями; steady-state FPS
не означает полного Performance PASS. Full-pose и summary-only captures не сравниваются
как эффект одной production поправки.

## 10. Real Chat Results

Final run **18/18 scenario PASS**. Ordinary inputs идут через Spectrum Chat UI;
ответы, emotions и semantic intents создаёт реальный Character LLM
Mistral `ministral-14b-2512`, речь — Fish S2 Pro / AudioPlayer. Ответы и gestureHint
не подставляются. Post-Stop input просит одно предложение до шести слов со свободным
содержанием. Исходный fixture и SHA-256 сохранены рядом с report.

18/18 не означает 18 выразительных жестов. Strict long-turn gestures проверяются
для explanation/comparison/joy и explicit peace (question-2). Короткие необязательные accents могут быть слабыми
или истечь; actual evidence ниже и в raw report сохраняет это различие.

| Scenario | Actual LLM hint | Actual profiles | Stroke travel, cm | Scenario gate |
|---|---|---|---:|---|
| welcome | greeting | greet_wave_soft | 9.99 | PASS |
| tea | concern | concern_soft | 2.67 | PASS |
| curiosity | curious | curious_lean | 6.38 | PASS |
| calm | shy | shy_gather | 4.07 | PASS |
| explanation | explain | explain_one_palm | 15.77 | PASS |
| comparison | compare | explain_balance | 9.34 | PASS |
| clarification | curious | curious_lean | 1.78 | PASS |
| joy | celebrate | celebrate_petite | 7.01 | PASS |
| surprise | surprise | surprise_small | 1.29 (weak/expired) | PASS |
| shy | delight | delight_hands_open | 2.27 | PASS |
| concern | reassure | reassure_palm | 1.43 (weak/expired) | PASS |
| idle-entry | shy | shy_gather | 3.64 | PASS |
| question-1 | curious | curious_lean | 4.28 | PASS |
| question-2 | peace | peace_single | 4.40 | PASS |
| question-3 | resolve | resolve_firm | 10.14 | PASS |
| interrupted | explain | explain_one_palm | 7.87 | PASS |
| after-stop | — | — | — | PASS |
| goodbye | farewell | farewell_wave_soft | 2.85 | PASS |

После Stop actual inference отменён, следующий turn дождался API-owned readiness
и завершил настоящее PCM. Cold reload не ускорялся. Предыдущий V11 случай с
107.958 s до первого PCM и global deadline FAIL сохранён отдельно; он не
переименован в успешный результат.

Autonomy проверена заново на final snapshot: **`joint-2026-10-29T07-12-17-121Z` PASS**.
Off, Suspend и Privacy запрещают инициативу. Разрешённый one-shot Scheduler reminder
проходит Main Gate → Attention → Conversation Admission; ровно одна command,
15,640 consumed PCM samples, completed playback/turn cleanup и ещё 15 s без второй
инициативы. Real policy capture 26.656 s / 60.588 FPS. Настройки восстановлены,
тестовые задачи paused. Финальный ordinary Chat идёт с автономностью Off.
Исторический positive run `joint-2026-10-28T18-14-54-706Z` также PASS; source identity
сохранена. Quiet-hours tail `joint-2026-10-28T19-04-44-308Z` остаётся FAIL по
`scheduler:quiet_hours`; policy не обходилась и quiet hours ради теста не менялись.

## 11. Finger, Facial and Idle Evidence

Idle `joint-2026-10-28T17-36-27-684Z`: poised 120.2104 s / 61.226 FPS,
warm 120.1953 s / 62.490 FPS. Unresolved contacts 0, camera unchanged, overflow 0.
Primary composition p95 1.6/1.7 ms, frame p95 16.9 ms; Overlay composition p95
0.7 ms, frame p95 17 ms. High-band wrist velocity power Primary
8.79e-6–2.877e-5 rad²/s²; Overlay 0.000594–0.001363 из-за projection cadence.
Worst displacement RMS upper bound выше 6 Hz около 0.056°. Это измерение,
не автоматический PASS художественной естественности. `idle-analysis.json` хранит
полную раздельную таблицу стадий.

Hands final V13: **`joint-2026-10-29T06-47-47-869Z` left camera** и
**`joint-2026-10-29T06-49-31-276Z` right camera**, snapshot `living-motion-1793256164875`.
Каждый camera side 5/5 technical PASS: explain pointing, greeting, peace,
shy gather, delight open hands. Все prepare/stroke/hold/recover выполнены,
unresolved arm contacts 0, phase timeouts 0. Raw WebM и exact hand source сохранены.

| Camera | Actual clip FPS min–max | Max arm step / 33.333 ms | Max torso tilt | Peace opening |
|---|---:|---:|---:|---:|
| Left | 61.716–62.173 | 2.9343° | 5.1336° | 19.5294° |
| Right | 61.127–62.244 | 2.9209° | 5.1116° | 19.5294° |

Signed palm-plane spread 0.266929, distal-center span 19.014 mm обеих captures.
Actual right close-up показывает разделённые index/middle и согнутые ring/little;
исходный hold frame и 0–10 s sequence сохранены. Ordinary Chat `question-2` сам
выбрал peace; `peace_single` выполнил все фазы, stroke travel 4.405 cm и actual
Fish mouth movement. `review-chat-peace-hold.png` извлечён из final MP4 на 752.031 s.
Input просит V словами; gestureHint/ответ не подставляются.

Catalog fixedLeadSide=right, mirrorQualified=false. Left camera показывает supporting
кисть для right-led profiles и active left в двухручных shy/delight. Зеркальный
leading-left peace не заявляется квалифицированным. Arm/torso contact counter не
является mesh-level доказательством отсутствия всех межпальцевых пересечений.
Визуальная читаемость V исправлена; художественная оценка всей кисти остаётся у пользователя.

Cold first-use captures сохранены отдельно: left 57.158 / right 56.632 FPS,
не засчитаны как >=60 PASS. Прогретые полные clips выше не склеены с initialization.
Прежние V10/V11 failures и videos сохраняют свои build identities; их не переименовывали.

Face: final component matrix — 9 explicit semantic emotions
через existing facial owner, technical PASS=True.
Actual video 56.374 s / 60.081 FPS;
это component smoke, не LLM acceptance; FPS относится к этому capture.
Actual PCM/mouth weights проверены в Chat; phoneme accuracy не заявлена.
Пользовательская VRM0 имеет compound Joy/Angry/Sorrow/Fun, blink/look и пять
visemes, но нет mesh targetNames и 15 именованных independent FACS channels.
Acting projection пустая; compound presets не выдаются за независимые brow/smile
channels. VRM asset не менялся. Model loading, Debug Preview, все physical phases,
Speaking, LipSync, Overlay и Runtime Health проверены. Literal loadAnimation API
в baseline отсутствует; использован существующий generated preview path.

## 12. 15-Minute Qualification

Final artifact **`joint-2026-10-29T06-52-29-493Z`**, continuous **971.312 s**,
actual **61.676 FPS**, Fish audio. Final Chat technical/readability
PASS; 18/18 сценариев. Actual continuous idle 120.625 s.

Production snapshot `living-motion-1793256164875`, baseline Git SHA
`67a03b6f160d6424700df73a68de46ce6cdda8ef`; dirty source/build identities сохранены.
Source identity 11/11 matches после двух declared test-only Controller/model refs;
production build не содержит hooks. Main autonomy code совпадает с positive policy run.

Evidence в `apps/desktop/motion/.artifacts/joint-2026-10-29T06-52-29-493Z/`:
`report.json`, `conversation-raw.webm`, `conversation-audio.webm`,
`conversation-60fps.mp4`, `conversation-primary.json`, `conversation-overlay.json`,
`autonomous-summary.json`, `source-identity.json`, `autonomy-source-identity.json`,
`input-fixture.cjs`, `input-identity.json`, `hand-prior-qualified.py`,
`review-chat-peace-hold.png`, `media-validation.json`, `cleanup-verification.json`.
MP4 H.264/AAC: 971.269 s, 58,276 video frames at 60 FPS; actual raw capture
59,907 frames at 61.676 FPS. Audio mean −35.7 dB, peak −11.1 dB; real Fish,
не silence. Export выбирает actual captured frames;
искусственные animation poses не создавались. Видео не склеено из разных runs.

Сохранённые ключевые неуспешные runs:

| Artifact | Причина FAIL / диагностический вывод |
|---|---|
| `joint-2026-10-28T15-50-09-806Z` | recovery и text-only после отмены |
| `joint-2026-10-28T16-39-45-073Z` | audible underrun, narrow-view compare unavailable, post-Stop text-only |
| `joint-2026-10-28T17-43-53-663Z` | 1008.59 s / 62.375 FPS, clock/recovery; after-Stop PCM completed |
| `joint-2026-10-28T18-14-54-706Z` | 965.98 s / 62.343 FPS, presence wrist recovery; policy/lifecycle PASS |
| `joint-2026-10-28T18-46-04-859Z` | valid wrist target, rate/sweep path RCA |
| `joint-2026-10-28T18-59-51-918Z` | healthy base prepare ошибочно считался timeout; harness criterion corrected |
| `joint-2026-10-28T19-04-44-308Z` | 920.60 s / 62.361 FPS, lost inner reachSeconds, quiet-hours positive tail, lifecycle cached status |
| `joint-2026-10-28T19-34-35-034Z` | 900.14 s / 61.712 FPS, independent-arm recovery timeout; Stop/new speech и lifecycle PASS |
| `joint-2026-10-28T20-04-32-239Z` | comparison prepare orientation FAIL; actual lifecycle state выявил ошибочную epoch-проверку harness |
| `joint-2026-10-28T20-39-04-559Z` | least-travel preparation experiment ухудшил stroke; изменение полностью отменено |
| `joint-2026-10-28T21-08-34-728Z` | comparison hold palm 0.777747 <0.8; lifecycle/face PASS; причина actual hold/recovery исправлена отдельно |
| `joint-2026-10-28T22-11-30-510Z`, `22-13-35-999Z` | обе руки: peace 11.51/11.52° <12°, first variation 58.83/58.92 FPS |
| `joint-2026-10-28T22-21-10-562Z` | left 5/5 technical PASS; cold initialization video отдельно 57.12 FPS |
| `joint-2026-10-28T22-22-56-465Z` | right 4/5; delight palm orientation failure; исходный clip сохранён |
| `joint-2026-10-28T22-26-50-617Z` | 920.734 s / 62.157 FPS; comparison prepare-only и delight orientation FAIL, остальные 16/18; actual idle 120.058 s, Stop/new PCM, lifecycle и face PASS; collected signed-roll RCA |
| `joint-2026-10-28T22-50-50-215Z` | 900.079 s / 62.122 FPS, 16/18; explanation/comparison/joy PASS; concern false clock jump и shy prepare workspace FAIL; actual idle 120.143 s, Stop/new PCM, lifecycle/face PASS; exact clock fixture сохранён |
| `joint-2026-10-28T23-21-06-669Z` | 18/18 turns, 900.187 s / 61.947 FPS, idle 126.966 s, clock discontinuities 0; overall FAIL из-за 139 stale gesture layer samples после Stop; Preview/lifecycle/face technical PASS |
| `joint-2026-10-28T23-51-33-666Z` | diagnostic portrait framing не предоставляет shy capability; actual PCM и layer guard прошли, strict shy fixture корректно FAIL; повторён в обычном bust framing |
| `joint-2026-10-29T00-06-33-096Z` | final-build targeted 4/4, actual speech-bound shy PASS, layer/clock violations 0; общий duration gate <300 s остаётся FAIL |
| `joint-2026-10-29T00-10-59-593Z` | final-build left: все geometry/phase gates выполнены, но четыре actual captured clips 56.874–58.011 FPS <60; FAIL сохранён; следующий неизменённый повтор записан отдельно |
| `joint-2026-10-29T00-13-13-793Z` | final-build right 5/5 technical PASS, actual clips 61.721–62.301 FPS; художественная приёмка pending |
| `joint-2026-10-29T00-20-32-083Z` | неизменённый повтор left 5/5 technical PASS, 61.465–62.116 FPS; первый FAIL не удалён и не переименован |
| `joint-2026-10-29T00-22-17-508Z` | V10 full: 17/18, comparison prepare-only; exact protected-presence queue RCA сохранён в comparison-owner-evidence.json; 900.223 s / 61.957 FPS, layer/clock violations 0, Preview/lifecycle/face technical PASS |
| `joint-2026-10-29T00-45-48-260Z` | V11 full: первые 16 scenarios PASS, comparison/shy PASS; post-Stop actual PCM с 107.958 s, 188-character reply оборван harness deadline 120 s, goodbye не выполнен; 923.732 s / 61.992 FPS; общий FAIL |

Последний lifecycle FAIL имел Main state failed при renderer cached ready и 0
workers. Harness теперь требует actual Main ready, fresh renderer report того же
modelGeneration и ровно один принадлежащий worker tree в прежние 120 s. Два Python процесса
(wrapper/child) учитываются как одно дерево. Первоначальная версия ошибочно сопоставляла независимые Main epoch и Avatar localEpoch; live снимок показал Main epoch 7 / Avatar epoch 8 при общем modelGeneration 4, healthy base и одном worker. Test исправлен: общий modelGeneration, фактический session/state владельца, новый generation после reload, bounded last-state при timeout. Это не подавляет реальное отсутствие worker и не расширяет deadline. Final V13 повторил fault/reload/reconnect: PASS, после reload/recovery по одному owned worker tree.

## 13. Artistic Acceptance

**PENDING USER REVIEW.** Не засчитывается автоматически из численных metrics.
Runtime scenario PASS означает выполнение bounded технического контракта; он не
доказывает ощущение живого персонажа или качество каждой кисти.

| Acceptance criterion | Status | Scope / evidence |
|---|---|---|
| Technical Stability | **PASS** | Final 18/18 scenarios, layer/clock violations 0, lifecycle/cleanup PASS, EPIPE fault PASS |
| Gesture Readability | **PASS по Runtime gates** | Strict long-turn gestures выполнены; ordinary short optional accents перечислены weak/expired. Художественное чтение оценивается отдельно |
| Idle Naturalness | **FAIL / не засчитано** | 120.625 s continuous idle и отсутствие high-frequency vibration подтверждены; субъективная естественность ещё не принята пользователем |
| Hand Quality | **PASS в проверенном scope** | Обе camera qualifications 5/5, исправленный right-led V в close-up и ordinary Chat; mirror-left и все mesh-level intersections не заявляются |
| Facial Acting | **PASS в доступном VRM scope** | 9 semantic component states, ordinary Chat presets, warnings 0; independent named FACS channels отсутствуют |
| LipSync | **PASS в PCM/mouth scope** | Настоящий Fish PCM и mouth weights; phoneme-level accuracy не заявлена |
| Autonomous Behavior | **PASS** | Fresh final-build Main-admitted voiced reminder + Off/Suspend/Privacy PASS |
| Performance | **FAIL по полному критерию** | Steady Chat 61.676 FPS PASS; cold hand initialization ~56 FPS и Fish recovery 60–110 s остаются ограничениями |
| Artistic Acceptance | **PENDING USER REVIEW** | Непрерывная запись и close-up hands предоставлены; полная Definition of Done не объявляется выполненной |

Отвергнутый global least-travel experiment и непринятые PCA axis/global/ray fits
не внесены в final production. Их результаты не выдаются за успешный fix.
Failed reports/video сохранены, numeric acceptance thresholds не снижались.

## 14. Known Limitations

- Cold Fish reload после реальной отмены занимает около 60–110 s. Исправлено безопасное
  ожидание следующей session, а не latency этого API-owned warmup.
  За это время early gesture intent может истечь; следующий ответ озвучивается,
  но выразительный акцент может отсутствовать. Такой turn отмечается degraded.
- Первое использование hand preview даёт initialization stall и capture около
  56 FPS; прогретые measured variations проверяются отдельно полными clips.
- У actual VRM нет независимых именованных FACS channels: compound эмоции,
  моргание и visemes доступны, полноценная независимая brow/smile asymmetry не
  подтверждена. Для расширения потребуется работа с моделью.
- Angle/contact gates рук не проверяют все mesh-level finger intersections.
  Историческая слабая V-форма исправлена в V13 native fit и temporal endpoint;
  actual right-led peace распознаётся в двух live paths. Mirror leading-left не
  квалифицирован. Итоговая художественная оценка пальцев остаётся у пользователя.
- Time to first observed gesture — metadata proxy, а не pixel-level motion onset.
- Публичный Character contract даёт один semantic intent на turn. В длинной речи
  возможны pose/gesture continuations и prosodic modulation, но новые независимые
  смысловые акценты не выдумываются из PCM energy. Расширение контракта требует
  отдельного архитектурного решения.
- Source pins остаются research-only; profile qualification не повышается
  автоматически на основании motion metrics.
- Художественная приёмка и phoneme-level LipSync не подтверждены автоматически.
- WDDM telemetry общая для GPU. Камера влияет на доступность profiles и читаемость.
- Component facial/hand tests с явными semantic inputs не выдаются за ordinary Chat.
- Безусловный полный Definition of Done не заявлен: cold performance имеет FAIL, художественная приёмка PENDING USER REVIEW.
- `ARDY_*` — существующие общие error codes. Все перечисленные motion runs
  используют `sourceProvider=motionbricks`, native SOMA-X Hand; ARDY fallback
  параллельно не запускался.
- Mic/ASR listening path повторно не квалифицировался: live acceptance здесь
  использует разрешённые ТЗ обычные текстовые Chat inputs и настоящий TTS.
