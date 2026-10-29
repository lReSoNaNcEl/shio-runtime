# MotionBricks, AI SDK и Fish — состояние ветки

## Architecture Review

Сохранены единственный Character Runtime, Main-owned LlmGateway, Tool Loop,
Action Runtime / Permission Guard и runtime-validated IPC. AudioPlayer остаётся
владельцем playback и consumed PCM; AvatarExpressionMixer — финальным writer
лица; Overlay потребляет готовые body/facial projections. Speech API независим,
HTTP 2.1 / stream 2 не менялись. Исходный HEAD рабочей ветки:
62c1a20d7390d1a1219b8a22c2f148082a065d36. Commit/push не выполнялись.
Ранее добавленные описания отменённого inference backend удалены из
архитектурной консолидации; правила владельцев не изменены.

## MotionBricks и presentation

MotionBricks-only + native SOMA-X Hand заменяют прежний ARDY/LLM2Vec backend.
Source revision: 54fc563aeaaf819a753d72cc9fdc6713989cdd43.
Model SHA-256: 6c9f78e23decbda8e1cfd1b0cc96980ea4b24b3ca2c808d03b058f48f82fc9ef.
Каталог expressive-v7-2026-10-29, native history 4 poses, horizon 60 frames / 30 FPS.
Transport leases/epochs, bounded queues, cancellation, teardown и failure recovery
сохранены. SHIO_MOTION_ENABLED=0 также запрещает demand-start.

Standing pose получена offline из breathing_idle.vrma, commit
39310f0d7a17616c30e2becdeeda845670353320, кадр 1,3333333730697632 с.
Анатомическая база SOMA, стабильные knee poles и finger composition применяются
один раз. Head/neck, eyes, jaw и facial channels исключены из generated body.
Overlay не запускает второй генератор и не добавляет второй procedural body слой.
Лицензия исходной standing VRMA не установлена.

SceneManager ограничивает WebGL drawing до 90 FPS со стабильным deadline без
catch-up burst. Composition/PCM clocks не изменены. Последняя полная запись до
этого исправления дала 56,137 encoded FPS при пороге 60; новый полный GPU/FPS
acceptance после исправления не выполнен. Ранний lifecycle run: 300,017 с,
62,010 FPS, Preview/Overlay reconnect/VRM reload и worker recovery прошли.
Ни один CPU build не считается подтверждением live FPS.

## AI SDK и удаление отменённого backend

Vercel ai 7.0.156 и @ai-sdk/openai-compatible 3.0.80 обслуживают cloud Adapters.
Groq, Cloudflare, OpenRouter и Mistral сохранены. SDK не получает execute callbacks,
не создаёт новый agent loop и не принимает authority decisions. Прямой openai
client, ручной SSE parser и старые provider-message converters удалены; Axios
остаётся для model catalogs и существующего proxy bridge. Safe incremental
protocol filter, tool requirements, error normalization и upstream abort сохранены.

Отменённый локальный Character provider полностью удалён из исходников:
provider registry/defaults/types, Main composition/lifecycle, IPC/preload,
capability qualification, Settings/Setup, RU/EN, CLI, asset manifests и его
специфические tests/qualification runners. SDK, Fish и MotionBricks не откатывались.
Неизвестные provider entries нормализуются существующим общим правилом;
конфигурация после нормализации сохраняется без удалённых entries, сохраняя
модели и credentials оставшихся провайдеров. Регрессия проверяет restart/idempotency.
Облачный inference в ходе проверки удаления не вызывается.

По отдельному запросу пользователя 30 октября оставшийся кэш окончательно удалён
из корзины по проверенной исходной записи. Два остальных элемента корзины
сохранены; их список не изменился. Затем очищен tmp проекта: предварительно
удалены 407 junction/symlink entries без удаления их целевых каталогов.
Свободное место на D: увеличилось приблизительно на 121,3 ГиБ, включая 7,4 ГиБ
от кэша. В tmp оставлены два активных лога и около 23 МиБ защищённых Git-данных
старых временных копий; их принудительное удаление отклонено автоматической
проверкой (blocked by policy). Fish/ASR остаются ready, процессы MotionBricks
не перезапускались. Рабочие assets и окружения этих сервисов не изменялись.

## Fish: память и реальный PCM

Эталон Fish найден в Git: experiment/fish-s2-pro-shio-2d-v22,
8eebda28f05de7f49969aa3d6b625391d7830309. Inference body, streaming и FISH_*
settings сверены с эталоном; pinned source cache совпадает с source.zip.
Модель/source revisions, BF16 semantic weights, FP32 codec, compile=true и
sampler сохранены. Квантование не применяется.

Разрешённые пользователем изменения:

- KV capacity 32768 → 4096 через штатный loader max_length. Upstream резервирует
  2048 токенов под generation; слишком длинный prompt/reference отклоняется явно.
- Три unused inherited causal masks 32768×32768 удалены у точного pinned
  WindowLimitedTransformer до переноса на CUDA. Рабочие маски сохранены.
- Waveform-свёртки декодируют блоки 128 latent frames с полным causal left
  context, вычисленным из topology: 4757/256, округление до 19 frames.
  Формы крупных выделений ограничены 128/147; последний блок padded/cropped
  по точным sample offsets. Quantizer/attention получают полный prefix.

Причина пика на 220 символах подтверждена профилированием: каждые 8 code frames
повторно декодировался растущий waveform-prefix, allocator накапливал резерв
крупных блоков разных размеров. Для 351 code frame active peak 12,410 ГиБ,
reserved 22,682 ГиБ, после forward allocated возвращался к 10,735 ГиБ.
Сокращение KV/статических масок не устраняло этот временный резерв.

| Замер Fish | Исходный Adapter | KV/masks + bounded waveform |
| --- | --- | --- |
| После загрузки/прогрева | 19,263 ГиБ | 11,449–11,470 ГиБ |
| 220 символов: dedicated peak | 21,396 ГиБ после KV/masks | 11,750 ГиБ |
| Shared GPU memory на 220 символах | 7296 МиБ после KV/masks | baseline 86 МиБ |

Три реальных запроса по 220 символов + вторая фраза выдали 22,477 / 21,502 /
22,477 с аудио. Первый PCM 314 / 453 / 431 мс, до finish-input. Два запроса шли
с параллельной текстовой inference нагрузкой и активным MotionBricks. Fish
возвращался к исходному idle расходу, признаков дополнительного WDDM GPU
вытеснения в RAM в этой серии не было. Пик всей GPU 20,883 ГиБ, включая другие
приложения; после штатного рестарта короткий smoke дал 20,968 ГиБ.
WDDM sampling не доказывает универсальный предел при произвольной нагрузке.
CPU private resident memory — отдельная метрика, не shared GPU offload.

Same-code сравнение 351 frames / 718848 samples: strict FP32 max error
9,835e-7, RMS 6,444e-8. При исходной CUDA/TF32 policy max 5,465e-4,
RMS 2,638e-5; исходный prefix-stream против full decode давал большее
расхождение. Scoped strict FP32 использовался только для A/B, policy восстановлена.
Файлы, env, pins, пакеты и настройки до/после квалификации сверены fingerprint.
API lint / format и 63 tests PASS; health/voices/emotions/warmup/real stream PASS.
Исторические сырые замеры и profiling artifacts из tmp очищены 30 октября по
запросу пользователя; итоговые результаты сохранены выше. Profiling обвязка
остановлена, API запущен штатно, его активный production-api.log сохранён.

## Проверки удаления и оставшиеся ограничения

Итоги проверок удаления сохранены ниже; временные логи и screenshots очищены
30 октября, кроме активного running-app.log.
Desktop check / format / imports, TypeScript и основной build PASS; 10 прежних
CSS warnings. Полная regression: 755 tests / 151 files PASS. Node syntax checks
трёх изменённых qualification runners и git diff whitespace PASS.
Live Electron smoke на новом build: Main/preload/renderer стартуют без page errors,
доступны ровно четыре облачных provider, engine IPC/preload API отсутствует,
устаревший provider очищается с сохранением модели другого provider. Settings
проверены визуально в light/dark после завершения смены темы. Тестовый профиль
изолирован, Motion выключен через штатный флаг, cloud inference не запускался.
Поиск имён/IPC/CLI отменённого backend по исходникам, документации и build пуст.
Старые model-specific результаты не считаются приёмкой оставшегося cloud стека.
После smoke штатное приложение перезапущено с новым build и обычным профилем:
активный Mistral сохранён, providers содержат только четыре облачных записи.
MotionBricks worker работает; независимый Fish/ASR API сообщает ready. Процессов
удалённого backend нет. Commit/push и переписывание истории не выполнялись.

Отложены полный Chat/FPS acceptance, Avatar idle/speaking/transitions/Preview/
LipSync/Overlay/VRM reload после presentation cleanup, художественная приёмка
жестов и русских ответов, длительный Fish soak и все voice/reference профили.
Холодная перезагрузка Fish после cancel остаётся медленной. Реальные cloud API
calls, authenticated GitHub sync и новый live microphone/ASR не выполнялись.
Release/packaging и commit/push не выполнялись.


## Обновление DSH — 30 октября 2026

По запросу выбран передовой alpha-канал, а не устаревший npm dist-tag `latest`.
45 прямых DSH-зависимостей закреплены на `0.2.2-alpha.2`; весь разрешённый
DSH-граф (322 пакета) использует ту же версию. Cordis: `4.0.6-alpha.1`,
include `1.0.11-alpha.1`, loader `1.0.7-alpha.1`, timer `1.1.8-alpha.1`.
`npm ls --all` PASS, без force/legacy-peer-deps. Удалены устаревшие прямые
agent-spine-demo, code-runtime и invariants; demo больше не совместим с этой
линией. Явная минимальная композиция монтирует только модельный PowerShell tool,
без Browser, файловых tools, jobs, skills или subagent tools. Внутренний fs-local
нужен новой working-directory service и не публикует модели файловые операции.
SDK запускается через `dshBin`, `processCwd` и явный credential-minimal env;
прямой shell RPC использует новый `execute(spec).result()` вместо удалённого `run`.

Architecture Review: DSH остаётся Main-owned shell Adapter; Action Runtime,
Permission Guard, Browser Control и Desktop–API contract не меняются.
Архитектурная перестройка для обновления не потребовалась.

Проверки: native PowerShell, exit 7, фактическое завершение PID при отмене,
таймаут, отклонение лишних RPC-полей и модельный tool loop через локальный
OpenAI-compatible SSE fixture. Модели виден ровно один tool — pwsh.
Desktop check / format / imports, TypeScript, build PASS; 10 прежних lint warnings.
Regression: 757 tests / 151 files PASS, два воркера, 67.47 s.
Изолированный Electron smoke PASS: Main/preload/renderer, версия в IPC,
PowerShell из Node 24.18.0 внутри Electron, stdout electron-dsh-ok, exit 0,
page errors 0. В тестовом профиле Motion выключен, Speech endpoint направлен
на недоступный локальный порт, облачные/GPU модели не запускались.

Не проверены настоящий облачный provider через DSH, Windows release/packaging,
длинный soak и интерактивная пользовательская приёмка. Fish/MotionBricks source,
конфигурации и веса этим обновлением не изменялись; commit/push не выполнялись.


## Аудит прямых зависимостей клиента — 30 октября 2026

Проверены imports, runtime YAML/MJS, scripts, qualifications, tests, type/build
configuration и electron-builder. Удалены 24 избыточные прямые записи DSH;
production dependencies: 71 → 47, DSH: 45 → 21, devDependencies: 17 без изменений.
Удалённые имена с префиксом @deepseek-ai/dsh-:
agent-instructions, anonymous-user-id, atomic-write, attachment, brand, credentials,
goal, goal-round-driver, home-paths, jobs-local, launch-environment, settings,
shell, skill, skill-filesystem, subagent, subprocess, timeout, tool-bash, tool-goal,
tool-jobs, tool-skill, typert-protocol, user-approval.
Это удаление лишних прямых деклараций, не удаление обязательных SDK-модулей:
все 24 остаются транзитивными зависимостями актуального DSH, npm install сообщает
up to date. Принудительное вырезание их из node_modules не выполнялось.
Других подтверждённых unused зависимостей не найдено. Tooling, @types и
используемые в qualifications/test пакеты сохранены. Lezer и Octokit активны.

Springbone уже включён: @pixiv/three-vrm 3.5.5 зависит от
@pixiv/three-vrm-springbone 3.5.5. VrmModelLoader регистрирует VRMLoaderPlugin,
который по умолчанию создаёт VRMSpringBoneLoaderPlugin; VrmModel.update вызывает
vrm.update(delta), который обновляет springBoneManager. Это физика пружинных
цепочек волос, одежды и аксессуаров при наличии настроек в VRM asset.
Отдельная прямая зависимость и второй update-loop сейчас не нужны.
Проверено по установленным исходникам и upstream v3.5.5 VRMLoaderPlugin.ts/VRM.ts.

Architecture Review: cleanup сохраняет поведение и владельцев Runtimes,
DSH остаётся shell Adapter, Desktop–API contract не меняется. Fish, MotionBricks
и Avatar source не менялись. npm ls --all, TypeScript, build, Biome check,
format и imports PASS; прежние 10 lint warnings сохранены.
Новый Electron smoke, визуальная приёмка springbone на конкретном VRM,
облачные/GPU модели, release packaging и длительные нагрузки не запускались.

Regression после cleanup: 757 tests / 151 files PASS, 62.29 s, два воркера;
включая native DSH PowerShell, отмену процесса, таймаут и модельный tool loop.


## Проверки перед push — 30 октября 2026

Desktop check / format / imports, TypeScript, build и regression (757 tests /
151 files, 71.23 s) PASS. API Ruff lint / format и pytest (63 tests) PASS.
MotionBricks deterministic unittest: 19 tests PASS, без моделей/GPU.
Motion/emotion catalog checks, legacy guard и git diff whitespace PASS.
Проверены 212 изменённых/новых файлов: без файлов больше 5 MiB, model weights,
cache/env/audio/log файлов и совпадений с сигнатурами приватных ключей/токенов.
HTTP contract smoke: настоящий API с lifespan off на временном loopback-порту
18000 прошёл Desktop HealthSchema / contract 2.1; процесс штатно остановлен.
Штатный порт 8000 на момент проверки недоступен. Это не проверка готовности
Fish/ASR или реального inference. GPU-модели и длительные прогоны не запускались.
