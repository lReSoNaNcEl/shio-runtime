# ARDY + Fish S2 Pro: экспериментальная сборка

Ветка `codex/experiment-ardy-fish-s2-pro-v1`, база
`39310f0d7a17616c30e2becdeeda845670353320`. Это отдельный эксперимент
3D VRM: S22 и 2D avatar в него не входят. Публикация релиза не выполняется.

## Установка из исходников

Целевой проверяемый профиль: Windows 11, RTX 5090 32 GB, CUDA 12.8,
Python 3.12, около 96 GiB RAM. Совместимость с 8–12 GB VRAM не квалифицирована.
Два приложения имеют отдельные окружения Python и независимые жизненные циклы.

```powershell
npm run desktop:install
npm run api:install:dev
npm run api:prefetch
npm run api:voices:sync
npm run motion:research:install
npm run motion:research:prefetch
npm run motion:catalog:check
npm run motion:research:doctor -- --offline
npm run api:dev
# В другом терминале:
npm run build
npm run desktop:start
```

Доступ Hugging Face нужен именно к `meta-llama/Meta-Llama-3-8B-Instruct`.
Используйте локальное хранилище токена Hugging Face; не помещайте токен в Git,
renderer settings или отчёт. Это Llama 3.0 как база обученного LLM2Vec encoder,
а не Character Chat LLM. Groq Chat API не возвращает необходимые ARDY
4096-мерные embeddings и не заменяет этот encoder. Выбор Character LLM
и существующее хранилище его credentials остаются независимыми.

ARDY использует CPU bf16 encoder и CUDA fp32 motion model. Первый прогрев
кодирует 28 фиксированных профилей. Производный safetensors-кеш привязан к
точным revisions encoder, ID и текстам профилей; это embeddings, не библиотека
записанных движений. Повторный worker использует проверенный кеш без загрузки
Llama. Повреждённый кеш пересоздаётся, а не считается готовым.

## Закреплённые зависимости

| Ресурс | Revision |
| --- | --- |
| NVIDIA ARDY source | `e706e27acc88070918308a10922b8f7174d0825e` |
| ARDY-SOMA-RP-30FPS-Horizon60 | `244215084b22fcd29ab743017330e87411fe168a` |
| Meta-Llama-3-8B-Instruct | `8afb486c1db24fe5011ec46dfbe5b5dccdb575c2` |
| LLM2Vec MNTP adapter | `31474e395ada192e8ed1586db6be79fb3b70c9c0` |
| LLM2Vec supervised adapter | `baa8ebf04a1c2500e61288e7dad65e8ae42601a7` |
| Fish source | `541566932abbaebcb0a40e562a1f846738383f38` |
| Fish S2 Pro weights | `1de9996b6be38b745688de084d87a5633f714e4e` |

Исполняемые pins находятся в `apps/desktop/motion/research-pins.json` и
конфигурации Fish API. Torch — `2.11.0+cu128`; полные зависимости закреплены
отдельными lock-файлами API и Motion. Лицензии исходников и весов различаются:
см. `THIRD_PARTY_NOTICES.md`, `apps/api/licenses` и `apps/desktop/motion/licenses`.
Архив сборки не содержит весов, токенов, референсов, `.venv` или модельных кешей.

## Владельцы и временная шкала

Main владеет ARDY subprocess, его окружением, lease, epoch и shutdown.
Renderer Avatar Runtime владеет нормализованными body bones; генерируемые
фрагменты проходят строгую проверку SOMA30/version, finite quaternions,
session/epoch/model generation и ограниченную очередь. SOMA генерирует
60 кадров при 30 FPS из истории до 60 кадров. Очередь содержит максимум
2 горизонта; отдельная ограниченная история отката хранит до 120 кадров.
Начало PCM clock не сбрасывает готовый запас. Смена профиля перепланируется
с ограниченным опережением по измеренному времени inference внутри уже покрытой
очередью области; воспроизводимый lead-in сохраняется до готовности замены.

AudioPlayer остаётся единственным владельцем воспроизведения. AudioWorklet
сообщает реально потреблённый offset исходного PCM 44,1 kHz с преобразованием
частоты устройства. Именно этот offset двигает разговорную timeline и cues.
При underrun cursor не убегает; опоздавшие горизонты не проигрываются ускоренно.
При deadline miss отображается degraded и безопасный возврат, а не скрытая
подмена генерации. Без речи Avatar использует локальные монотонные часы.

ARDY не получает head/neck/eye/jaw/finger authority. Gaze, Head Motion,
моргание, speaking eyes, spring bones и AvatarExpressionMixer сохраняют
владение. Мимика и амплитудный LipSync используют фактически играющий звук;
это не phoneme/word alignment. Stationary-профили фиксируют root XZ,
ограничивают наклон корпуса и используют foot planting. Bust/Portrait
ограничивают амплитуду и учитывают реальные размеры VRM.

Overlay получает ту же проверенную body pose и речевую проекцию через Main.
Второго ARDY или AudioPlayer в Overlay нет. Основная skeleton composition
продолжает работать без открытого Preview. Смена VRM, reload renderer и cancel
инвалидируют старые результаты до нового применения позы.

### Исправления качества движения

Композиция тела выполняется один раз за кадр. Ретаргетинг учитывает поворот
модели в сцене и вычисляет целевые локальные вращения до сглаживания; остановленный
PCM-курсор удерживает сгенерированную позу. Положение root интерполируется между
кадрами ARDY, а не переключается ступенчато с частотой генерации.

Ограничения нормализованного скелета защищают локти и колени от обратного и бокового
сгиба. Направление колена при foot planting задаётся в системе координат аватара,
поэтому почти прямая нога не меняет сторону сгиба от небольшого шума. Руки проверяются
по сегментам относительно приближённого объёма торса; это защита скелета, а не полная
коллизия треугольников кожи, одежды или окружения. Runtime Health показывает
ограниченные счётчики коррекций суставов и рук.

SOMA30 не генерирует полные пальцевые цепочки. Существующий body owner добавляет
процедурные расслабленные кисти, небольшие вариации пальцев, `finger_gun` и V-жест
`victory_fingers`. Переходы зависят от общего курсора и seed; отдельного генератора,
таймера или случайной траектории в Overlay нет.

Проекция Overlay снимается после композиции и включает пальцы и положение chest
для дыхания. Overlay интерполирует эти значения, сохраняет собственные лицо и взгляд,
но не повторяет дыхание и body micro-motion. Передача поз сохраняет остаток таймера
30 Hz и допускает только один активный IPC-запрос и одну последнюю ожидающую позу.
Отмена заменяет ожидающее движение сбросом.

## Эмоции и безопасный протокол

`contracts/emotions.v3.json` и `contracts/motion.v1.json` — источники истины.
`npm run emotions:sync` и `npm run motion:sync` генерируют manifests.
Их согласованность проверяет `npm run motion:catalog:check`.

Grammar v1: вне Markdown code, escaped text и ссылок допускаются известный
`[emotion]` и `[voice:description]`. Description — максимум 120 символов,
без вложенных скобок, angle brackets и управляющих символов. Известные
эмоции и VRM mappings объявлены в contract. Неизвестные обычные скобки,
Markdown links и code сохраняются. Повреждённые внутренние voice/tool/shio
маркеры изолируются до chat, TTS и истории; потоковый и финальный parser
используют один grammar. Круглые `(happy)` — обычный текст, не S2-команда.

```text
[happy][voice:bright playful tone]Привет! Рада тебя видеть.
[whisper][voice:whisper in small voice]А теперь маленький секрет.
```

Максимум три сегмента подачи, две смены после начала текста. Соседние emotion
и voice перед текстом образуют одну границу. Интенсивность subtle/normal/strong
передаётся существующим типизированным embodiment intent. Fish Adapter один
превращает typed delivery в provider square tags; буквальный `[voice:...]`
до Fish не доходит. Речевая подача не перезаписывает разговорную Character State
emotion. External tool evidence не приобретает delivery authority.

## Speech API и страница на 8000

HTTP contract **2.1**, `/tts/stream` protocol **2**. Стандартный output — mono
Float32 LE, 44100 Hz. `ready` объявляет формат. Каждая пара audio metadata/binary
связана точными sessionId, turnId, sequence, textSequence, samples и
монотонным sampleOffset. ACK освобождает транспортный кредит, а не сообщает
факт звучания. Лимит кредита — 4 пакета, ACK timeout — 5 секунд; Desktop и
web playback ограничены 1,5 секунды. Сессия ограничена 120 секундами и 12000
символами; один активный Fish session, конкурент получает typed busy.

```text
start → ready → (text | delivery | audio-ack)* → finish-input
     ← audio metadata + binary PCM* ← complete
cancel возможен также после finish-input; terminal — cancelled или error.
```

`complete` завершает producer, AudioPlayer может ещё доигрывать. Fish выдаёт
ранний PCM инкрементальным декодированием, не ожидая весь ввод. Cancel сразу
очищает local output, cues и mouth, затем останавливает реальную GPU-работу
завершением worker. Следующий turn ждёт settlement; reload явно показывает
loading/warming. Быстрое mute не называется мгновенной готовностью GPU.

`GET /health`, `/voices`, `/emotions`, `/voices/status`, `POST /voices/sync`,
`/tts/warmup`, `/recognize` и `/ws/asr` доступны на порту 8000.
`/synthesize` удалён: старый клиент несовместим. `/voices` разделяет наличие
исходных references, conditioningReady и available. Производный reference
кеш зависит от checksum и model revision, оригиналы не перезаписываются.

`http://localhost:8000` — RU/EN Fish Audio S2 Pro playground с обеими темами,
readiness, revisions, голосами, delivery, incremental text, bounded playback,
отменой и ASR file/microphone streaming. Он не владеет 3D avatar или ARDY.
В Desktop speech endpoint задаётся только Main environment
`SHIO_SPEECH_API_URL`, default `http://127.0.0.1:8000`, до запуска приложения.

## Проверки и артефакты

```powershell
npm run desktop:check
npm run desktop:format:check
npm run desktop:imports:check
npm run typecheck
npm run desktop:test:fast
npm run desktop:test:regression
npm run api:lint
npm run api:format:check
npm run api:test
npm run api:doctor:strict
npm run motion:research:test
npm run motion:catalog:check
npm run experiment:legacy-check
npm run build
npm run experiment:qualify -- --duration-seconds=1800 --warm-responses=20
npm run experiment:pack
npm run experiment:verify-package
```

Live qualification требует готовых моделей и настроенного Character LLM.
Runner копирует конфигурацию и encrypted credential store в отдельный профиль
в `tmp`, выключает автономные инициативы, запускает реальный built Electron
и пишет отчёт/скриншоты в `apps/desktop/motion/.artifacts/joint-*`.
Секреты и raw PCM не попадают в отчёт. Для installed executable используется
`SHIO_QUALIFICATION_DESKTOP_EXECUTABLE`, для отдельного Motion env —
`SHIO_MOTION_ROOT`; renderer эти пути не задаёт.

Первый совместный прогон 26.10.2026: 20 прогретых ответов, первый PCM median
311 ms / p95 330 ms; первое ненулевое Worklet rendering median 316 ms /
p95 336 ms; cue error p95 4,7 ms. Отдельная аппаратная base+output latency
52 ms. Это программные timestamps, физический speaker loopback не измерялся.
Baseline Fish без ARDY: first PCM median 200,4 ms / p95 211,1 ms, 20 ответов.
Полная матрица, окончательные ресурсы/frames и 30-минутный результат фиксируются
в отчёте квалификации; эти промежуточные числа не заменяют все пункты приёмки.

## Установка экспериментального пакета

`experiment:pack` создаёт отдельный ZIP с суффиксом `-ardy-fish-experiment` из
текущей рабочей ветки; опубликованный Alpha ZIP не перезаписывается.
`Start Shio Runtime.cmd install` устанавливает Speech Pack и отдельный Motion
Pack, `repair` восстанавливает их, `doctor` выполняет read-only проверки.
Motion Python env расположен в `Motion/<version>/.venv`; launcher передаёт
Main только установленный `SHIO_MOTION_ROOT`. Для изолированной проверки
можно задать абсолютный `SHIO_LOCAL_ROOT` внутри рабочей папки.

Первый install скачивает большие зависимости, gated Llama assets и public
weights. Normal startup работает с кешем, не скачивает модели. Для миграции
из F5 нужен новый Fish env из lock-файла; старые F5/Cosy `.env` не являются
валидной конфигурацией. Нельзя использовать их как fallback.

## Границы подтверждённого качества

SOMA30 не имеет отдельных finger joints. Профили finger-gun/victory сохраняют
смысловую доступность рук/плеч, но отдельный сгенерированный жест пальцев
не заявляется. Word-level gesture alignment также не заявляется.
Холодный Fish compile, GPU cancellation/reload и CPU LLM2Vec warmup заметно
дороже warm inference. Первая проверка выполняется на существующей Windows
машине с изолированными каталогами; это не новая чистая ОС.
