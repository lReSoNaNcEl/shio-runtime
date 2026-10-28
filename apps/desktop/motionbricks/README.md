# MotionBricks + SOMA-X Hand: исследовательский Adapter

Только opt-in запуск из development checkout. По умолчанию приложение использует
ARDY. В packaged приложении выбор экспериментального provider запрещён.
Это не launcher-компонент и не второй Avatar Runtime.

Результаты, ограничения и приёмка:
`docs/EXPERIMENT-MOTIONBRICKS-SOMAX-2026-10-28.md`.
Лицензии: `docs/EXPERIMENT-MOTIONBRICKS-SOMAX-LICENSING-2026-10-28.md`.
Точные source/model/dependency pins: `research-pins.json`.

## Подготовка

Команды выполняются из корня этого worktree. Проверенное окружение: Windows,
CPython 3.12.13, RTX 5090, driver 610.88, TensorRT 10.8.0.43, Warp 1.17.0.

1. Подготовить отдельный checkout `NVlabs/motionbricks` в
   `apps/desktop/motionbricks/.cache/upstream` на commit
   `54fc563aeaaf819a753d72cc9fdc6713989cdd43`. Не заменять его ARDY checkout.
2. В его корне выполнить `uv sync --locked`. Для локальных cache/Python assets
   задать `UV_CACHE_DIR` и `UV_PYTHON_INSTALL_DIR` внутри игнорируемой `.cache/`.
3. Получить Git LFS assets: `motionbricks/assets/human/`,
   `assets/motions/soma/`, оба `motionbricks/assets/onnx/soma/*.onnx`.
   Если LFS передача ONNX зависает, те же файлы доступны через
   `https://media.githubusercontent.com/media/NVlabs/motionbricks/<COMMIT>/<PATH>`.
   Проверить SHA-256 из `research-pins.json` и основного отчёта перед заменой
   LFS pointers. Runtime повторно проверяет FP16 ONNX и upstream revision.
4. Создать junction `apps/desktop/motionbricks/.venv` на `.venv` этого
   upstream checkout. Для уже подготовленного worktree junctions существуют;
   не перезаписывать посторонние junctions или окружения.
5. Создать `apps/desktop/motionbricks/.tmp`.
6. Для варианта с native hands загрузить `SOMAHand.npz` и
   `SOMA_template_rig.usda` из `nvidia/SOMA-X`, immutable revision
   `f81a01796f652260ff930d5318d6c6b845a505ed`, в `.cache/hand/`.
   Оба файла проверяются по SHA-256 при старте. MANO/SMPL-X не нужны.

В текущем worktree `.cache/upstream`, `.cache/hand` и `.venv` ссылаются на
подготовленные assets внутри его `tmp/`. Эти junctions и большие assets не
коммитятся. Текущая начальная standing pose получена из evaluation-only BVH;
это исследовательская зависимость, не готовый shipping material.

## Запуск

```powershell
$env:SHIO_EXPERIMENT_MOTION_PROVIDER = 'motionbricks'
$env:SHIO_EXPERIMENT_SOMA_HAND = '1' # опустить для body-only варианта B
$env:SHIO_MOTION_ROOT = (Resolve-Path 'apps/desktop/motionbricks').Path
$env:SHIO_DESKTOP_USER_DATA_ROOT = (Join-Path (Get-Location) 'tmp/motionbricks-manual-profile')
npm run build
npm --prefix apps/desktop start
```

Новый profile требует собственной настройки/выбора VRM. Не копировать открытые
credentials в Git или логи. Не запускать второй GPU motion provider параллельно.
Speech API запускается отдельно штатным `npm run api:dev` в его подготовленном
checkout; Desktop не импортирует его код и не использует API virtualenv.

## Qualification

```powershell
node apps/desktop/qualifications/speech-motion/prepare-living.cjs
$env:SHIO_QUALIFICATION_DESKTOP_ROOT = Get-Content 'apps/desktop/motion/.artifacts/living-motion/latest-snapshot.txt' -Raw
npm run experiment:qualify -- --conversation-cases --duration-seconds=300 --warm-responses=1 --audible --skip-profiles
npm run experiment:qualify -- --stabilization-cases --stabilization-kind=idle --duration-seconds=60 --warm-responses=1 --audible --skip-profiles
```

`prepare-living.cjs` создаёт отдельный snapshot с test-only inspection hooks.
Обычная production сборка их не содержит. Conversation runner пишет настоящее
видео/звук; ошибки читаемости или FPS остаются FAIL. Старый `--record-video`
не нужен для conversation/stabilization: у них уже есть capture высокой частоты.

Headless benchmark запускается Python-окружением MotionBricks:

```powershell
apps/desktop/motionbricks/.venv/Scripts/python.exe apps/desktop/qualifications/motionbricks/benchmark.py --upstream apps/desktop/motionbricks/.cache/upstream --precision fp16 --output tmp/mb-benchmark --generations 1000
```

Для cold plan build добавить `--force-rebuild`. Не смешивать cold build и warm
generation latency. `engineStartupMs` измеряет конструктор engine; старое имя
`firstUsablePoseFromProcessMs` в JSON означает время от начала benchmark-секции
до первой CPU-позы, без запуска Python интерпретатора и ранних проверок pins.
`gpu.json` — telemetry всей GPU, не per-process VRAM под WDDM.

## Границы и текущая готовность

- Main выбирает один worker, проверяет source/model identity и bounded NDJSON.
  Windows cancellation завершает точное дерево experimental Python processes.
- Model работает с четырьмя native context poses и pose goals. Валидные native
  сегменты 18–58 кадров сшиваются в существующий transport по 60 кадров.
- `conversion.py` удаляет SOMA bind orientations, сохраняя Y-up world deltas.
- `targets.py` использует typed workspace/phase, текущие pose/history/momentum
  и bounded acoustic energy. Это прототип, не универсальная семантика жестов.
- Native hand prior: 32 PCA components на 24 articulation joints без wrist.
  Shape target и его quintic temporal transition задаёт приложение. 25 SOMA
  joints отображаются на 15 VRM finger bones каждой руки через bind/palm basis.
- Body/hand composition, consumed PCM, facial mixer и Overlay сохраняют прежних
  владельцев. Акустическая энергия не является оценкой смысла или фонем.
- Исправление дрожи использует единственный существующий tracker с более
  спокойной настройкой только для MotionBricks presence. Другие providers и
  активные gestures/reactions сохраняют исходную настройку.
- Разговорная читаемость объясняющего жеста пока FAIL. Полная художественная
  приёмка, finger close-up и full-body actions не объявлены пройденными.
