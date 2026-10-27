# Сравнение ARDY Core8 и SOMA для Shio

27 октября 2026 года. Core8 остаётся рабочей базой Shio. Для отдельного A/B первым кандидатом предлагается SOMA с обычным ArdyMotionRep: она сохраняет представление корня того же семейства. SOMA KimodoRep полезно включить третьим вариантом для оценки траектории корня. Преимущество SOMA в скорости или качестве на нашей VRM пока не установлено.

Сравнение охватывает текущий Core8 и оба опубликованных SOMA checkpoint. Оно отделяет свойства моделей от ограничений интеграции, приводит публичные метрики и определяет воспроизводимый план измерений на Windows и RTX 5090 вместе с Fish.

## Architecture Review

Конфликта с [ARCHITECTURE.md](D:/Dev/shio-runtime/ARCHITECTURE.md) нет: это исследовательское сравнение без изменения Runtime, выбранной модели или контрактов. Main сохраняет единственный ARDY Adapter; Avatar Runtime — ретаргетинг, физическую композицию и кисти; AudioPlayer — consumed PCM; AvatarExpressionMixer — финальную мимику; Overlay — готовую проекцию.

Потенциальная интеграция SOMA потребует отдельного целевого решения в ARCHITECTURE.md и плана перед implementation. Описанные ниже варианты не являются новым утверждённым wire contract или вторым источником архитектуры.

## Модели и формат

Полные имена: [Core8](https://huggingface.co/nvidia/ARDY-Core-RP-20FPS-Horizon8), [SOMA60](https://huggingface.co/nvidia/ARDY-SOMA-RP-30FPS-Horizon60), [SOMA60 KimodoRep](https://huggingface.co/nvidia/ARDY-SOMA-RP-30FPS-KimodoRep-Horizon60).

| Свойство | Core8 | SOMA60 | SOMA60 KimodoRep |
| --- | --- | --- | --- |
| Скелет | CoreSkeleton27 | SOMASkeleton30 | SOMASkeleton30 |
| Суставов | 27 | 30 | 30 |
| Частота исходного движения | 20 FPS | 30 FPS | 30 FPS |
| Горизонт одного вызова | 8 кадров | 60 кадров | 60 кадров |
| Длительность горизонта | 0,4 с | 2 с | 2 с |
| Представление | ArdyMotionRep | ArdyMotionRep | KimodoMotionRep |
| Корневая траектория | Raw hips | Raw hips | Представление относительно сглаженной траектории корня |
| Базовые шаги диффузии в config | 10 | 10 | 10 |
| Кадров на motion token | 4 | 4 | 4 |
| Новых motion tokens на полный горизонт, без history | 2 | 15 | 15 |
| Размер denoiser + tokenizer файлов | 765,1 MB | 769,0 MB | 769,4 MB |
| Подключение в Shio | Реализовано | Требует адаптации | Требует адаптации, включая root semantics |

Частоты, горизонт, representation и шаги проверены по точным конфигурациям: [Core8 config](https://huggingface.co/nvidia/ARDY-Core-RP-20FPS-Horizon8/resolve/9acbfc61f93fb5fd392019a7487c3d7bf4f74e6d/config.yaml), [SOMA60 config](https://huggingface.co/nvidia/ARDY-SOMA-RP-30FPS-Horizon60/resolve/244215084b22fcd29ab743017330e87411fe168a/config.yaml), [KimodoRep config](https://huggingface.co/nvidia/ARDY-SOMA-RP-30FPS-KimodoRep-Horizon60/resolve/e6c6804fb6b55636ad927145d74959fd46882ccd/config.yaml). Размеры взяты из публичных HF file metadata; MB означает 1 000 000 байт. Это размер файлов, а не расход VRAM. Расчёты длительности и числа tokens следуют из config.

Обе SOMA выпущены 15 октября 2026 года по [таблице NVIDIA](https://github.com/nv-tlabs/ardy#checkpoints). Модельные карточки указывают примерно 192 M параметров без text encoder для всех трёх вариантов. Близкий размер весов не означает одинаковую стоимость вызова: длина генерируемой последовательности и history различаются.

### Точные кандидаты

| Артефакт | Revision для воспроизведения сравнения |
| --- | --- |
| ARDY source, уже закреплённый проектом | `e706e27acc88070918308a10922b8f7174d0825e` |
| Core8, production pin | `9acbfc61f93fb5fd392019a7487c3d7bf4f74e6d` |
| SOMA60, кандидат | `244215084b22fcd29ab743017330e87411fe168a` |
| SOMA60 KimodoRep, кандидат | `e6c6804fb6b55636ad927145d74959fd46882ccd` |

SOMA revisions разрешены через публичный HF metadata API 27 октября 2026 года. Рабочий [research-pins.json](D:/Dev/shio-runtime/apps/desktop/motion/research-pins.json) не менялся. Существующий закреплённый ARDY source уже содержит оба SOMA имени в registry; обновление исходников только ради распознавания имени не требуется. Это ещё не проверка загрузки и генерации с SOMA весами.

## Плавность и жесты на VRM

### Скелет и анатомические оси

Core27 и SOMA30 различаются иерархией и порядком суставов. В Core цепочка корпуса содержит Spine, Spine1, Spine2, Spine3 и один Neck; в SOMA — Spine1, Spine2, Chest и два Neck. В SOMA есть Jaw и глаза. Индексы рук и ног также другие. Перенос массива из 30 вращений в существующую Core27 таблицу по индексам недопустим. [Определения скелетов в закреплённом source](https://raw.githubusercontent.com/nv-tlabs/ardy/e706e27acc88070918308a10922b8f7174d0825e/ardy/skeleton/definitions.py).

Для SOMA нужно независимо проверить rest orientation, parent transforms, стандартную позу, scale и преобразование global rotations в normalized VRM. Текущий body owner использует Core27 mapping и опорную высоту `0.9544128`; их нельзя переносить на SOMA без калибровки. Ограничения локтей, коленей, контактов и стоящих стоп остаются обязательными после ретаргетинга.

Из SOMA body input необходимо исключить оба Neck, Head, Jaw и глаза. Эти каналы уже имеют собственных владельцев в Shio. Большее число исходных суставов не даёт разрешения писать LipSync, Blink или gaze из нейросетевого тела.

### Пальцы и точные жесты

SOMA30 содержит только сокращённые hand end joints. Метод преобразования SOMA30 в SOMA77 заполняет отсутствующие пальцы расслабленной rest pose; это не генерация полного finger motion. Поэтому fox-paw, V-жест, положение большого пальца и coordinated release продолжат зависеть от существующих hand score и VRM calibration. Источник тот же: SOMASkeleton30 и `to_SOMASkeleton77` в определениях скелетов.

30 FPS увеличивает частоту исходных образцов с интервалом 50 до 33,3 мс. Renderer уже интерполирует движение между образцами. Само повышение FPS не исправляет конкурирующие writers, неверный retarget, скачок фазы или расхождение с PCM. Сравнивать нужно итоговую композицию тела и кистей, включая переходы и recovery.

### Корень и стоящие стопы

У обычной SOMA сохраняется ArdyMotionRep, но её rest skeleton всё равно требует адаптации. KimodoRep меняет смысл root features и constraints. Сглаженное представление корня является свойством модели; плавное конечное движение VRM после наших constraints нужно проверять отдельно. Описание варианта: [NVIDIA model card](https://huggingface.co/nvidia/ARDY-SOMA-RP-30FPS-KimodoRep-Horizon60).

Для стоящих профилей важны высота таза, опора обеих стоп, отсутствие скольжения и бокового изгиба. Возможное преимущество smooth-root нельзя оценивать только на свободной ходьбе: основной workload Shio — разговорные жесты с закреплённой опорой.

## Что показывают публичные метрики качества

Ниже выбран один блок опубликованного NVIDIA benchmark — Content, Overview. Это качество исходного SOMA motion на benchmark dataset; здесь нет Core8 строки, ретаргетинга на нашу VRM или совместной нагрузки с Fish.

| Модель | R@3 выше лучше | FID ниже лучше | Skate ниже лучше, см/с | Contact выше лучше |
| --- | --- | --- | --- | --- |
| SOMA60 | 77,86 | 0,058 | 2,760 | 0,982 |
| SOMA60 KimodoRep | 75,57 | 0,066 | 2,230 | 0,984 |

KimodoRep в этом блоке имеет меньше foot skating, а обычная SOMA выше по R@3 и ниже по FID. Единого победителя по всем метрикам нет. Протокол NVIDIA использует batch 32, FP32 text encoder и выключенный TF32. Root/Pelvis ошибки из ardy и smooth-root suites напрямую несопоставимы: различаются целевые траектории. [Метрики и условия NVIDIA](https://github.com/nv-tlabs/ardy#motion-generation-benchmark).

Эти числа не обосновывают утверждение «SOMA лучше Core8 для Shio». Такое сравнение должно включать одинаковые физические задачи, поддержку стоп, hand score и итоговую позу на одном и том же VRM.

## Скорость и отзывчивость

Горизонт 2 секунды — длительность выдаваемого движения, не задержка реакции и не длительность inference. Если использовать каждый полный горизонт без перепланирования, для непрерывного движения Core8 нужны 2,5 вызова/с, SOMA60 — 0,5 вызова/с. У SOMA каждый вызов генерирует больше данных. При частых сменах intent или фазы часть будущего движения может быть отброшена, поэтому это только расчёт для непрерывного использования горизонта.

Разделять нужно три результата:

- **Пропускная способность:** время генерации относительно длительности выданного и реально использованного движения.
- **Отзывчивость:** время от нового intent или фазы до первого соответствующего применённого кадра. Большой запас уже готового движения не должен задерживать новую просьбу.
- **Плавность воспроизведения:** underrun, frame pacing, angular speed/acceleration, переходы и совпадение с consumed PCM.

В старом совместном Core8 прогоне зафиксированы 560,71 мс на 400 мс движения и underrun: отношение времени генерации к длительности горизонта около 1,40. Это единичное измерение того сценария, не текущий p95 и не сравнение с SOMA. [Сохранённый live-отчёт](D:/Dev/shio-runtime/docs/LIVE-SPEECH-MOTION-2026-10-26.md).

Текущий `inferenceMs` в [backend.py](D:/Dev/shio-runtime/apps/desktop/motion/backend.py) охватывает весь `generate`: constraints, autoregressive step, decode, CUDA→CPU и преобразование результата. Для выбора ускорения нужен отдельный breakdown; это поле нельзя подписывать как чистое время denoiser на GPU.

Сравнение следует начинать с одинаковых 10 шагов, eager FP32, явно зафиксированного TF32 и одинаковых conditioning embeddings. `torch.compile`, TensorRT, mixed precision и 8/6 шагов — отдельные эксперименты после этого baseline. Иначе эффект checkpoint смешается с эффектом backend. В штатном demo NVIDIA предусмотрены compile/TensorRT, но выигрыш на Windows и RTX 5090 не измерен. В model cards заявлен Linux; готовность текущего Core8 на Windows не квалифицирует новый SOMA путь автоматически.

## Объём адаптации в Shio

| Слой | Подтверждённая привязка Core8 | Что требуется проверить для SOMA |
| --- | --- | --- |
| Backend | `frames = history + 8`, 20 FPS, history 40, reshape 8×27; canonical support targets | Размеры из выбранного формата, history в секундах, skeleton-specific constraints, root semantics |
| Shared contract | Литералы Core revision/skeleton, 20 FPS, horizon 8, history 40; rotations 8×27 | Отдельный версионированный формат с точным checkpoint; ограничения payload и совместимости |
| Main Adapter | Валидация format/lease/plan и bounded subprocess transport | Допустимый размер результата, deadlines и cancellation для большего горизонта |
| Renderer body | Core joint mapping, расчёты cursor через 20, chunk boundaries через 8, Core reference height | SOMA mapping/rest calibration, время в секундах, корректное покрытие и invalidation фаз |
| Phase planning | Forecast и границы горизонта связаны с текущим source frame | Перепланирование без проигрывания устаревших 2 секунд; history и continuity anchor |
| Hand score | Пальцы синхронны с body phase и PCM | Сохранение владельца кистей, новая проверка wrist basis и anatomical targets |
| Overlay | Получает готовые VRM bones | Сохранение потребителя и прежней clock ownership; новый генератор в Overlay не нужен |
| Qualification | Fixtures и guards проверяют Core8 | Матрица нового формата, retargeting, переходов, отмен и совместного Fish |

Локальные основания: [backend.py](D:/Dev/shio-runtime/apps/desktop/motion/backend.py), [catalogSchema.ts](D:/Dev/shio-runtime/apps/desktop/src/shared/motion/catalogSchema.ts), [shared motion](D:/Dev/shio-runtime/apps/desktop/src/shared/motion/index.ts), [ArdyMotionService.ts](D:/Dev/shio-runtime/apps/desktop/src/main/motion/ArdyMotionService.ts), [GeneratedBodyPlayback.ts](D:/Dev/shio-runtime/apps/desktop/src/renderer/avatar/rendering/three/GeneratedBodyPlayback.ts).

Объём перехода значительный: затрагиваются формат, physical calibration и временная модель playback. Обычная SOMA уменьшает число одновременно меняющихся факторов по сравнению с KimodoRep; это причина выбрать её первой для A/B, не доказательство лучшего качества. Подмена 60 кадров тридцатисуставного движения на существующие 8×27 с фиктивным Core identity недопустима. Смена FPS простым ускорением воспроизведения также исказит жесты.

## План отдельного A/B

План ниже подготовлен для последующей квалификации; в текущей работе он не запускался.

### Условия

1. Зафиксировать три checkpoint revision из таблицы, source revision, хеши backend/retargeting/fixtures, Torch/CUDA/driver, настройки precision и состояния Fish. Кандидаты держать отдельно от production pins и настроек пользователя.
2. Использовать одинаковую длительность history: текущие 40 кадров Core = 2 с; для SOMA это 60 кадров. Не переносить число 40 как эквивалентный контекст. Сохранять constraints одной физической задачи с правильным representation для каждой модели.
3. Прогревать каждый вариант отдельно. Замерять cold start, warm steady state и смену фазы раздельно. Порядок A/B чередовать, фоновые нагрузки фиксировать. Одинаковый seed нужен для воспроизводимости; при разных tensor shapes он не означает одинаковый шум и попарно идентичные движения.
4. Сначала подавать фиксированные typed semantic intents без Character provider: это изолирует model/retargeting от выбора жеста. В совместном этапе использовать одну и ту же реальную Fish речь и consumed PCM. Дополнительные OpenRouter запросы для физического A/B не нужны.

### Сценарии

Быстрый набор: спокойная стойка, greeting, explain_one_palm, shy_gather, fox_paw_single, peace_single, kiss_air_soft, возврат в покой. Для каждого — seeds 17, 503, 10009, одинаковая камера и свет. Проверять фронт, боковой вид и обе кисти; оценивать видео нормальной скорости и покадрово.

Полная матрица после пригодности быстрого набора: все 28 profiles × 3 seeds × VRM0 и VRM1 = 168 исполнений на вариант, 504 для трёх вариантов. Это будущий объём, не число выполненных проверок. Отдельно добавить короткую/длинную речь, позднее намерение, смену жеста во время protected stroke, speech end во время подготовки, interruption, model replacement и Overlay.

### Метрики

| Область | Что сравнивать |
| --- | --- |
| Генерация | Constraints/denoiser/decode/CPU conversion/transport отдельно; p50/p95/p99, cold и warm |
| Полезная производительность | Generated seconds / wall seconds и фактически использованные секунды; доля отброшенного forecast |
| Отзывчивость | Intent→первый применённый кадр новой подготовки; phase request→первый matching horizon; соответствие акцента PCM |
| Совместная нагрузка | Те же метрики при Fish, peak VRAM/RAM, underrun и deadline misses |
| Тело | Body/arm contacts, knee flips, foot slip, hips drift, angular speed/acceleration, recovery outcome |
| Кисти | Ошибка wrist/palm orientation, форма пальцев на stroke/hold, отсутствие пересечений и continuity release |
| Presentation | RAF/frame pacing, main→Overlay задержка, пропуски и coalescing; фактическое время между projections |
| Lifecycle | Отмена реальной inference, отсутствие stale replay, один generator/body owner, освобождение процесса и lease |

Для GPU breakdown нужны CUDA events или profiler без изменения production clock. Полное wall time измеряется отдельно. Обычное суммирование wall intervals вокруг асинхронных CUDA launch не даёт точной GPU длительности. В отчёт сохраняются bounded aggregates и видео/изображения; сырые poses, PCM, prompts и credentials в диагностический JSON не попадают.

### Условия выбора

Кандидат должен одновременно сохранять все обязательные физические и lifecycle guards, исполнять смысл жестов и не ухудшать LipSync/Blink. Быстрее генерировать неправильную позу недостаточно. Численная физическая проверка и визуальная оценка отмечаются отдельно; пропущенный case не считается успешным.

При совместной нагрузке целевой результат — отсутствие audible underrun и запоздалого акцента, с запасом генерации относительно реально доступного буфера. Дополнительно сравниваются p95 реакции и cold start: более высокий throughput при заметно худшем отклике может быть непригоден для короткого диалога. До замеров конкретный коэффициент ускорения и победитель по качеству не назначаются.

## Что изменено

Подготовлено отдельное сравнение трёх checkpoint, проверены публичные конфигурации и revision, выявлены места адаптации и определён A/B. Изменён только этот документ. Рабочие pins, backend, VRM assets, provider settings и Runtime не менялись.

## Root Cause

N/A — исследовательское сравнение. Старый underrun подтверждает пропуск срока в сохранённом сценарии, но не устанавливает единственную причину всех геометрических артефактов и не доказывает преимущество другой модели.

## Почему фикс работает

N/A — исправление или миграция не выполнялись. Решение о следующем кандидате основано на совместимости формата и проверяемом плане; фактический эффект определяется отдельным A/B.

## Файлы

Добавлен `docs/ARDY-CORE8-SOMA-COMPARISON-2026-10-27.md`. Остальные изменения рабочего дерева принадлежат предыдущей и параллельной работе.

## Проверки

Статически сверены production pins, backend, shared schemas, renderer playback и закреплённые skeleton/registry definitions. Публичные model metadata и три небольших config прочитаны без загрузки весов. Проверены ссылки на локальные основания, арифметика горизонтов и матрицы, отсутствие whitespace ошибок и структура документа.

## Ограничения

SOMA веса не загружались. GPU benchmark, Electron, ARDY/Fish live и provider calls в этой работе не запускались; предыдущая просьба остановить live сохраняется. Сравнение содержит опубликованные свойства и внешний benchmark, а не новые локальные измерения. Build и тесты приложения не перезапускались: изменена только исследовательская документация. Commit/push не создавались.
