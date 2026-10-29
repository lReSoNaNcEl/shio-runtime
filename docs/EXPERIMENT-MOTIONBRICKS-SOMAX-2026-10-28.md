# MotionBricks + SOMA-X Hand — эксперимент 28 октября 2026

Ненормативный исследовательский отчёт. Реальный экспериментальный прототип
запущен; полная приёмка ТЗ НЕ завершена. Решение: продолжить исследование,
ARDY не заменять до устойчивой разговорной читаемости и художественной приёмки.

## Architecture Review

- База: `62c1a20d7390d1a1219b8a22c2f148082a065d36`.
- Ветка: `experiment/motionbricks-somax-hand-living-v1`, взята из origin;
  отдельный worktree `D:/Dev/shio-runtime/tmp/motionbricks-experiment`.
- Исходная ARDY-ветка и main не изменяются. Защищённые документы read-only.
- Прочитаны AGENTS.md, соответствующие разделы ARCHITECTURE.md (Speech,
  Avatar, generated body, consumed PCM, hands, facial/secondary composition,
  Overlay), motion.v1.json, ARDY Main Adapter и renderer composition,
  предыдущие ARDY/SOMA qualification и stabilization reports.
- Отдельного файла Shio Runtime Documentation Editing Policy в checkout
  не найдено; применены ограничения AGENTS.md §§2, 11 и данного задания.
- Для будущей интеграции: один Main-owned provider; единственное применение
  skeletal pose через Avatar Runtime; AudioPlayer consumed PCM — часы речи;
  AvatarExpressionMixer — единственный writer лица; Overlay — потребитель.
- Stage 1 — отдельный исследовательский процесс, без подключения к Core,
  renderer IPC, Speech API, launcher или release flow. Внешние модели и
  upstream checkout находятся только в игнорируемом `tmp/`.

## Что изменено

Проверка feasibility официального NVlabs/motionbricks предшествует интеграции.
Порядок оставшейся работы: body/VRM → dynamic targets и Fish coordination →
SOMA-X hands → ограниченные actions → прямое A/B и художественная оценка.
Физические действия и танцы не включаются до разговорной приёмки.

- Opt-in `SHIO_EXPERIMENT_MOTION_PROVIDER=motionbricks` выбирает один новый
  worker в существующем Main-owned lifecycle service. Его историческое имя
  `ArdyMotionService` не означает запуск ARDY при выбранном MotionBricks.
  В packaged приложении новый provider запрещён. Обычный запуск сохраняет ARDY.
- Main проверяет реальную identity нового provider вместо подстановки ARDY
  revisions, валидирует bounded payload и помечает источник accepted chunks.
  Experimental Windows stop завершает точное дерево Python-процессов; новые
  worker leases не выдаются до завершения остановки.
- Native SOMA history состоит из четырёх поз. Native сегменты 18–58 кадров
  сшиваются без дублирования boundary frame в существующий 60-frame transport.
  Хранится bounded source history для разрешённого `fromFrame` rewind.
- Local SOMA transforms преобразуются в world rotations; удаляется bind
  orientation каждого joint. Renderer применяет тот же calibrated VRM owner,
  facial/head/eyes/jaw mask, физические ограничения и Overlay projection.
- Геометрические pose goals используют typed workspace/phase, текущую позу,
  историю, ограниченный momentum и вариативность. Pose goals не являются clips.
  Это черновой planner: все значения семантики не квалифицированы.
- AudioPlayer-derived bounded energy передаётся через существующий validated
  motion IPC с playback identity. Она модулирует будущие цели, а не отдельные
  суставы/слоги. Consumed PCM, buffering, interruption и recovery сохраняют
  прежних владельцев. Voicing/pitch/phoneme alignment не реализованы и не заявлены.
- Вариант C включается дополнительно `SHIO_EXPERIMENT_SOMA_HAND=1`.
  Native SOMA-X prior проверяется по SHA-256, использует 32 коэффициента на
  24 articulation joints без wrist. Каталог задаёт shape target, приложение
  формирует quintic temporal articulation. Wrist-local bind/palm calibration
  отображает 25 исходных joints на 15 VRM finger bones каждой руки, учитывая
  отсутствующие metacarpals через global deltas. Wrist не применяется повторно.
  Тяжёлый SOMAHand mesh renderer и Torch не запускаются в render loop.
- Facial Runtime, expression mixer, gaze, Blink, LipSync, ears/tail и Spring
  ownership не заменялись. Пользовательская Chat/Overlay camera не менялась.

### Окружение WI1

| Компонент | Зафиксированное значение |
| --- | --- |
| GPU | NVIDIA GeForce RTX 5090, 32607 MiB, WDDM, sm_120 |
| NVIDIA driver | 610.88; CUDA driver API 13.3 |
| MotionBricks source | `54fc563aeaaf819a753d72cc9fdc6713989cdd43` |
| MotionBricks package | 0.2.0 |
| Python | CPython 3.12.13 |
| TensorRT | 10.8.0.43, исходный upstream pin |
| CUDA runtime package | nvidia-cuda-runtime-cu12 12.9.79 |
| Warp / Newton | 1.17.0 / 1.6.0 |
| NumPy / SciPy / USD | 2.4.3 / 1.17.1 / 26.3 |
| SOMA ONNX | mmm_v6_soma, opset 17, FP32 и mixed FP16 |
| FP32 SHA-256 | `856419dc72aeb14e591eebf4dd0ea05734a2506ddb00bcd39dd6dac2ad60f4fb` |
| FP16 SHA-256 | `6c9f78e23decbda8e1cfd1b0cc96980ea4b24b3ca2c808d03b058f48f82fc9ef` |
| SOMA-X source (исследование) | `56a3d957a549c66425b500fddf7f3183bc6fbdff` |

Исходные зависимости установлены `uv sync --locked` в отдельную `.venv`.
Оба ONNX загружены из официального GitHub media и проверены по LFS SHA-256:
757864273 байта FP32, 380327058 байт FP16. Обычный `git lfs pull` зависал
при передаче ONNX; сменён только транспорт загрузки, содержимое модели совпало.
SOMA skeleton и evaluation BVH получены через Git LFS.

После явного разрешения пользователя остановлены процессы Shio Electron,
ARDY и Speech API, включая их дочерние процессы. VRAM до остановки 24915 MiB,
после — 3365 MiB. Другие приложения не останавливались; результаты нельзя
называть измерениями на полностью выделенной GPU.

### WI1 — фактическая feasibility и benchmark

Оригинальный `docs/examples/generate_once.py`: PASS, 26 и 50 валидных кадров.
Оригинальный `locomotion_loop.py`: PASS, 14 связанных генераций / 9 секунд
логического playback. Оригинальные Inbetweener и Scene Preview прошли SOMA
startup/shutdown smoke по 120 test frames в headless OpenGL. Ручное авторство
сцены в этих GUI не квалифицировано.

Финальные precision-прогоны выполнены последовательно, Fish остановлен.
На каждом 1000 генераций, первые 10 исключены из warm percentiles. Это
источник SOMA, не VRM render loop. GPU telemetry — вся GPU с другими desktop
приложениями, не per-process показатели WDDM.

| Метрика | FP32 | Mixed FP16 |
| --- | ---: | ---: |
| Cold engine constructor, включая plan build | 51.494 s | 132.326 s |
| Engine startup с готовым plan | 754 ms | 484 ms |
| Первая CPU-поза от начала benchmark-секции, cache run | 1567 ms | 1212 ms |
| Warm inference p50 / p95 / p99, CUDA events | 2.477 / 2.667 / 2.690 ms | 1.114 / 1.132 / 1.323 ms |
| Target preparation → готовая CPU-поза p50 / p95 / p99 | 3.591 / 3.904 / 4.191 ms | 2.190 / 2.500 / 2.738 ms |
| Decode p50 | 0.0677 ms | 0.0664 ms |
| Whole-GPU peak во время cold build | 4990 MiB | 4745 MiB |
| Whole-GPU peak в cache benchmark | 4356 MiB | 4024 MiB |
| CPU core equivalent, unpaced generation loop | 1.007 | 1.015 |

Cold runs создали новые plans; повторные cache runs не изменили plans.
`firstUsablePoseFromProcessMs` в JSON имеет историческое неточное имя: это
время от начала benchmark-секции до первой CPU-позы, без OS/Python launch и
ранних проверок pins. Оно не выдаётся за полный startup приложения.

Ранний FP16 cold build кратко пересёкся со случайно запущенным FP32 rebuild;
FP32 был остановлен. Эти cold timing не приняты. Таблица выше использует
последующие чистые последовательные `*-cold-isolated` и `*-final-cache` runs.

120 последовательных stationary transitions дали 4433 кадров / 147.77 s
логического движения. Source wrists excursion 9.35 / 11.63 cm; native feet
excursion до 3.21 cm: это не доказательство контактов на VRM. Source boundary
component delta < 1.8e-7; quaternion norms и конечность проверены. Нет оснований
переносить native source-precision цифры на всю цепочку Character/Fish/VRM.

### WI8 — прямые последовательные разговорные прогоны

Три отдельных app profiles, одна пользовательская VRM SHA-256
`bac0c6eb597e3840241f0d319f7cfeace0621a0b198129aa778fd76aba1a4fac`,
одинаковые шесть semantic scenarios и неизменённая Chat/Overlay camera.
Настоящие Character LLM replies и Fish; без подстановки `gestureHint` в Chat.
Fish source/model pins остаются `541566932abbaebcb0a40e562a1f846738383f38` /
`1de9996b6be38b745688de084d87a5633f714e4e`. Ни один из этих трёх прогонов
не объявлен общей победой или полной художественной приёмкой.

| Вариант | Длительность / capture FPS | Technical | Readability |
| --- | --- | --- | --- |
| A — исходный ARDY, exact 62c1a20 snapshot | 300 s / 62.27 | PASS | FAIL |
| B — MotionBricks body | 300 s / 62.31 | PASS | FAIL |
| C — MotionBricks + native Hand | 300 s / 62.29 | PASS | FAIL |

Примеры audible-stroke wrist excursion, cm:

| Сценарий | A | B | C |
| --- | ---: | ---: | ---: |
| Объяснение | 0.58 FAIL | 0.83 FAIL | 1.16 FAIL |
| Явное приветствие | 0.68 FAIL | 1.61 PASS | 0.89 FAIL |
| Радостная реакция | 0.54 FAIL | 2.33 PASS | 1.92 PASS |

Колебания между B/C не доказывают ухудшение от Hand prior: реальные LLM replies,
timing и новые neural generations различаются. Полное причинное A/B с identical
source для Hand ещё не выполнено. Одного удачного приветствия недостаточно.

Каждый прогон сохранил raw high-rate video, отдельный audio и синхронизированный
60-FPS MP4; audio/video start offsets A/B/C: -18 / -10 / -11 ms. Это показатели
старта recorder, не измеренная точность фонем. Время и bone/phase/source-stage
aggregates сохранены рядом с видео. В conversation resource series оказался
только один GPU snapshot на вариант. Он НЕ считается peak или средней GPU load;
полная continuous telemetry и точные per-generation p50/p95/p99 ARDY/Fish/MB
для всей цепочки пока не собраны. Performance Acceptance всей системы остаётся
INCOMPLETE, несмотря на измеренные 60+ FPS и отдельный ONNX benchmark.

### Исправление резкой тряски — отдельный RCA / Work Item

Пользователь наблюдал резкие движения корпуса из стороны в сторону. Проверены
раздельно source → reconstruction → retarget/anatomy → workspace → single
tracker → procedural → final VRM, а также Overlay. Контроль с постоянным
source выполнялся диагностически; production сохраняет живой MotionBricks.

На 60-секундном live stationary-source контроле hips/arms неподвижны, грудь
сохраняет только плавное дыхание; высокочастотная мощность практически нулевая.
В живом MotionBricks source уже присутствует быстрый pose noise. Например,
hips source acceleration P95 6.31 rad/s², jerk P95 510.65 rad/s³. Старый final
tracker уменьшает их, но оставляет hips acceleration P95 1.22 rad/s² и jerk
42.64 rad/s³. Поэтому резкая дрожь не объясняется самим дыханием. Retargeting
глобальных в локальные вращения усиливает часть дифференциального шума.

Исправление меняет bandwidth единственного существующего tracker только для
MotionBricks presence: 28 → 8 rad/s. Нового фильтра, генератора или часов нет;
anatomical/contact safety остаётся. Источник берётся из Main-annotated accepted
chunk; ARDY и активные gestures/reactions сохраняют прежнюю настройку.

На одних и тех же 15 захваченных MotionBricks horizons, та же VRM, 60 Hz
production composition, после 4-секундного входного участка:

| Bone | Jerk P95 до → после, rad/s³ | High-band (>6 Hz) power | Excursion retained |
| --- | ---: | ---: | ---: |
| hips | 33.22 → 4.23 | -98.54% | 87.4% |
| spine | 33.15 → 4.25 | -98.41% | 93.1% |
| chest | 14.66 → 2.00 | -98.82% | 94.7% |
| left upper arm | 14.22 → 2.15 | -98.09% | 93.3% |
| right lower arm | 53.88 → 6.87 | -98.37% | 93.0% |

Это identical-source offline composition evidence, не новый GPU A/B и не
полная симуляция Spring Bones. Отдельные новые live idle episodes по 60 s
прошли на 61.71 / 62.48 FPS, без runtime failure и изменения камеры.
Пользователь после наблюдения обновлённого демо явно подтвердил:
«Покачивания стали плавными». Это закрывает субъективный idle feedback,
но не распространяется на всю художественную приёмку или все жесты.

Ранее в черновике pose goals обнаружен неверный elbow control: source local X
практически совпадает с продольной осью forearm (|dot| ≈ 1.0 с обеих сторон).
Такой контроль создавал twist. Он заменён геометрическими wrist goals и
двухзвенным построением целевой позы с текущей elbow plane перед нейросетью.
Это построение входных целей, не покадровый IK writer после Avatar composition.

### WI11 — очистка legacy remote branches: PASS

Повторно проверены remote heads, worktrees, процессы и доступный список чатов.
Worktrees используют только ARDY baseline и новую экспериментальную ветку;
активного использования удаляемых веток не обнаружено. GitHub search отдельно
для каждой ветки вернул пустой список открытых PR.

- `origin/refactor/dependency-consolidation-streaming-v1`:
  `250988025efcdbccd6789b928dda8ec0cae707ed`, 0 уникальных коммитов к origin/main.
- `origin/experiment/cosyvoice3-only-streaming-experience-v1`: единственный
  уникальный коммит `c1aa4e09d3ea8a631ce7b6e066399f6a740247ce`.
- До создания проверено отсутствие локального и remote архивного тега.
- Опубликован `archive/cosyvoice3-only-streaming-experience-v1`, затем
  `git ls-remote --tags` подтвердил точный SHA `c1aa4e09…`.
- Только после проверки тега обе запрошенные remote branches удалены.
  Выполнен fetch/prune, отсутствие обоих heads проверено через ls-remote.
- ARDY baseline и новая экспериментальная ветка в origin сохранили `62c1a20…`.
  Локальные legacy branches сохранены; другие ветки/теги не удалялись.

## Root Cause (если был баг)

См. отдельный RCA выше: source high-frequency noise проходил через слишком
быструю presence-настройку существующего tracker. Static-source intervention
отделил его от дыхания и фоновых facial/head механизмов.

## Почему фикс работает

Более спокойный bandwidth удаляет быстрые смены направления, сохраняя большую
часть медленной траектории. Gesture path остался побитово одинаковым в focused
тесте; ограничения, one-pass composition, PCM cursor и Overlay owner сохранены.
Наличие Builder, зелёных тестов или нормализованных quaternions само по себе не
доказывает художественную пригодность — для неё используются отдельные видео.

## Файлы

- Main composition, shared motion schema/IPC, existing generated-body tracker
  и body composer; новый pure `SomaHandRetargeting` вклад внутри Hand domain.
- `apps/desktop/motionbricks/{backend,conversion,targets,hand_prior,worker}.py`,
  research pins, README и cache ignores. Репозиторный Speech API не менялся.
- `apps/desktop/qualifications/motionbricks/{benchmark,stationary}.py`, существующие
  qualification runners с provider provenance и optional finger capture.
- Service lifecycle, schema boundary, hand rest/wrist и signal tests.
- Этот отчёт и отдельный licensing report. `AGENTS.md` и `ARCHITECTURE.md`
  сохранили SHA-256 `d2733824…` и `11e04129…` соответственно.
- Не коммитить модели, виртуальные окружения, TensorRT plans, BVH, raw poses,
  видео/аудио, кэши, credentials и build outputs.

## Проверки

- Базовый SHA и remote experiment ref: PASS.
- Отдельное исходное окружение: PASS.
- SHA-256 обоих ONNX: PASS.
- Реальный FP32 / mixed FP16 source inference, sequential generation, cold
  build и cache reuse: PASS в описанном ограниченном benchmark.
- Реальный Electron + пользовательская VRM + Fish + Character: три 300 s runs.
  Technical PASS, Readability FAIL. Это НЕ общий PASS эксперимента.
- Component smoke подтвердил Fish PCM, LipSync, Blink, Preview/Overlay,
  остановку до PCM, во время PCM и после input. Его отдельный recorder завершился
  ошибкой закрытого page; весь component run помечен FAIL, не подменён успехом.
- Первый conversation attempt без qualification-only hooks остановился с
  отсутствующим `__motionAbController`; повтор выполнен в подготовленном snapshot.
- Broad legacy profile sweep остановлен и помечен interrupted; короткий
  пересекавшийся повтор также не принят как perf/visual qualification.
- `desktop:check`, `desktop:format:check`, `desktop:imports:check`: PASS.
  Сохраняются три прежних информационных Biome сообщения в motion-ab runner.
- `typecheck`, `build` и speech asset verification: PASS.
- Полный `desktop:test:regression`: 142 files / 674 tests PASS. Root npm wrapper
  предупредил о `--maxWorkers`; фактически suite прошла с default Vitest workers.
- Финальный `desktop:test:fast`: 59 files / 229 tests PASS.
- New-provider Python Ruff lint/format: PASS. Native priors/template hashes,
  bind reference consistency, finite poses и quaternion norms: PASS.
- Static-source и final live idle: PASS; обе серии сохраняют настоящие Spring
  updates. User feedback по плавности idle: PASS.
- API unit suite не перезапускалась: API-код и HTTP/PCM contract не менялись.

### Локальные evidence (игнорируются Git)

Под `apps/desktop/motion/.artifacts/`:

- `joint-2026-10-28T11-23-22-745Z`: A, ARDY exact baseline.
- `joint-2026-10-28T11-32-25-000Z`: B, MotionBricks body.
- `joint-2026-10-28T11-39-23-495Z`: C, MotionBricks + Hand.
- У всех трёх: `conversation-60fps.mp4`, raw video, audio и `report.json`.
  Эти разговорные записи сделаны ДО последующего исправления idle jitter.
- `joint-2026-10-28T11-47-13-114Z`: static и два baseline live idle с source,
  retarget, corrections, procedural, final normalized/raw VRM и Spring traces.
- `joint-2026-10-28T11-58-21-957Z`: обновлённые два live idle по 60 s.

Под `tmp/evidence/`:

- `fp32-cold-isolated`, `fp16-cold-isolated`, `fp32-final-cache`,
  `fp16-final-cache`: точные benchmark results, per-generation samples,
  исходные первые сегменты и whole-GPU telemetry.
- `presence-replay.json`, `tracker-previous`, `tracker-candidate`,
  `tracker-comparison.json`: одинаковый source для проверки smoothing.
- `motionbricks-idle-fixed-preview.mp4`: 12-секундный фрагмент нового live idle,
  без интерполяции выдуманных поз.

## Ограничения

| WI | Состояние |
| --- | --- |
| WI1 | Реальный runtime / source benchmark PASS; extended wall-time soak и полная concurrent telemetry не завершены. |
| WI2 | Реальная VRM integration работает; текущие safety/style stages сохраняются, полная fidelity/contact/VRM0+VRM1 приёмка не закрыта. |
| WI3 | Геометрический bounded planner реализован; объясняющий жест не прошёл conversational readability. |
| WI4 | Настоящий Fish/PCM и bounded energy steering подключены; pitch/voicing и полная короткая/длинная phrase qualification не закрыты. |
| WI5 | Native prior и VRM finger contribution реализованы; отдельная полная hand close-up / anatomy / gesture-shape приёмка PENDING. |
| WI6 | Прежние facial/secondary owners сохранены; обычный live evidence есть, отдельная 2-min emotional recording PENDING. |
| WI7 | Не включено: более сложные actions/dance отложены до разговорной приёмки. |
| WI8 | Три настоящих последовательных 5-min прогона и видео есть; full perf/statistical/identical-source Hand comparison INCOMPLETE. |
| WI9 | Idle сглажен и принят пользователем; полная художественная приёмка PENDING, общая разговорная читаемость FAIL. |
| WI10 | Предварительный licensing/deployment report подготовлен отдельно; release не менялся. |
| WI11 | PASS: ровно две запрошенные remote branches удалены после архивирования unique commit. |

Technical Acceptance: PASS только для описанных ограниченных live scenarios.
Performance Acceptance всей системы: INCOMPLETE. Conversational Readability:
FAIL. Hand Quality: PENDING. Artistic Acceptance всего эксперимента: PENDING.

Настройки анатомии/контактов и прежние workspace/style коррекции не отключались,
чтобы искусственно увеличить жест. Это также означает, что их влияние на новый
provider требует дальнейшей stage-by-stage qualification: нынешние pipeline
numbers не доказывают минимальность вмешательства. Нужен отдельный разбор
`explain_point_close` source → goal/phase → retarget → workspace → audible stroke.
Нет оснований объявлять проблему решённой увеличением набора pose goals.

### Публикация текущего экспериментального состояния

После сообщения о незавершённом ТЗ и оставшемся FAIL объясняющего жеста
пользователь явно запросил commit и push в origin. Публикуется текущий
исследовательский snapshot ветки `experiment/motionbricks-somax-hand-living-v1`,
включая исправление idle jitter и описанные ограничения. Это не релиз и не
объявление полного ТЗ / Definition of Done выполненными. Перед staging повторно
прошли Biome check/format/imports, fast 229/229, regression 674/674,
TypeScript, production build / speech asset verification и Python Ruff.
Большие локальные evidence, модели, окружения, credentials и build outputs
в commit не включаются. Защищённые AGENTS.md / ARCHITECTURE.md сохранили hash.

После изолированных cold benchmarks штатный Speech API восстановлен в исходном
подготовленном API checkout. `/health` подтвердил `ready=true`, Fish `ready`,
`mode=real`. HTTP и streaming PCM contract не изменены.

Рекомендация о замене ARDY до прямого сравнения не принимается. Предыдущие
RTX 4090 benchmark и исторические ARDY записи не являются результатом этого
эксперимента на RTX 5090.
