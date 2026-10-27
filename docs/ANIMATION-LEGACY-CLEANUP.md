# Очистка потребителей ARDY после миграции

Архитектурная опора: `ARCHITECTURE.md`, раздел Generated Body Adapter,
Generated-motion migration correction (27.10.2026). Владельцы, IPC и протоколы
Main, Avatar, AudioPlayer, facial mixer и Overlay сохраняются.

## RCA и подтверждение

Ревью подтвердило: loop guard оставляет failed presence в очереди; позиционный
fallback теряет speechBound и provenance; HUD читает всегда пустое имя файла;
диагностика имитирует удалённые клипы; root-track и Overlay exclusion policies
больше не имеют потребителя. Первые два случая воспроизведены изолированно.
Прежний legacy-check проверял загрузчики и ресурсы, но не эти контракты.

## Work Items

1. Документация: зафиксировать намеренную коррекцию в канонической архитектуре.
2. Queue/fallback: согласовать все terminal outcomes и не терять request context;
   аварийный terminal освобождает очередь без скрытого retry. Добавить регрессии.
3. Diagnostics: заменить файловые поля реальными bounded ARDY signals, перевести
   snapshot, invariant observer и recorder, сохранить диагностические возможности.
4. HUD: использовать применённый profile ID из существующей body presentation;
   Spectrum Text, семантические токены обеих тем, локализованные RU/EN подписи.
5. Cleanup: удалить неработающие root-track/Overlay policies, старую перегрузку,
   фиктивные caches и clip types; обновить guards и fixtures.
6. Проверить focused regressions, Desktop regression, Biome check/format/imports,
   typecheck, build, catalog/legacy checks. Live не запрошен и не запускается.

Архитектура и план сверены до изменения кода. Реализация остаётся внутри уже
существующих владельцев; raw pose данные в диагностику не добавляются.

## Результат

Все пять замечаний исправлены:

- Queue связывает запись с точным execution ID. Failed startup, failure,
  timeout и cancellation освобождают запись и pending intents без retry.
  Completed/superseded сохраняют обычное возвращение в presence. Отсутствие
  playback без outcome не означает завершения. Явная variation того же профиля
  проходит admission; защищёнными фазами продолжает владеть body executor.
- Fallback использует единственный object-options contract и сохраняет
  speechBound, seed, blend, frame, semantic source и provenance.
- HUD читает metadata применённой body presentation, не имя файла или новую
  заявку. Spectrum Text и семантические токены поддерживают обе темы; подписи
  HUD и новых diagnostic fields добавлены в RU/EN.
- GeneratedMotionTypes заменяет клиповые types. Diagnostics различает заявку,
  текущее execution и применённую позу; сообщает реальные generation/sequence,
  source time, transition duration, readiness, underruns, late chunks и errors.
  Mirror сообщает primary execution metadata и ноль собственных executions.
  Recorder сохраняет bounded ARDY trace и отдельно реагирует на underrun,
  late chunk и motion error. Синтетические caches, files, mixer actions,
  root-track flags и ложные restart/ownership counters удалены.
- Удалены OverlayAnimationPolicy и старые manifest presentation helpers,
  неиспользуемый loop argument физического generated playback и clip tuning.
  Legacy guard дополнительно проверяет диагностические projections и manifests
  зависимостей. Root/support constraints канонического ARDY catalog сохранены.

## Проверки

27.10.2026:

- Focused Avatar/diagnostics/architecture: 26 файлов, 223 теста прошли.
- Полный `npm run desktop:test:regression`: 111 файлов, 488 тестов прошли.
  Старый integration fixture, принимавший остановку за завершение, переведён
  на явные execution identity и completed outcome. Ранний прогон с этим fixture
  был красным; итоговый полный прогон успешен.
- `desktop:check`, `desktop:format:check`, `desktop:imports:check`,
  `npm run typecheck` и `npm run build` прошли. Build проверил emitted Worklet.
- `experiment:legacy-check` и `motion:catalog:check` прошли: 28 profiles,
  25 emotion cues, 0 существующих VRMA, 39 ранее отслеживаемых удалений.
- Проверены source и emitted renderer: удалённых clip projections нет;
  VRMA ресурсов в source assets и build output нет. Diff whitespace check
  затронутой области проходит.

## Ограничения

Live Electron/ARDY/Fish и художественная квалификация не запрошены и не
запускались. Протокол Main и Speech API не менялся; API implementation не
редактировалась и API suite для этой работы не запускался. Коммит, staging
и публикация не выполнялись. Ранее существовавшие изменения миграции сохранены.
