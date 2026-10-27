# ARDY → VRM: исправление качества и полная проверка библиотеки

## Architecture Review

Конфликта с архитектурой нет. ARDY и его один процесс принадлежат Electron Main; ретаргетинг, калибровка и итоговая композиция остаются в Avatar Runtime. AudioPlayer владеет consumed PCM, AvatarExpressionMixer — лицом. Overlay получает ту же композицию. HTTP API, pinned source/checkpoints, модель, skin weights, Spring Bones и пользовательские настройки не изменены.

## Что изменено

- Восстановлены instruct identity и MNTP tokenizer при offline-композиции LLM2Vec. Несовместимый conditioning cache больше не используется. Пересчитаны все 112 embeddings; generated trajectories не кешируются как клипы.
- Геометрия торса и толщина рукавов измеряются по bounded bind-skin samples. Место крепления плеча на своей стороне допускается; проход верхней руки к центру груди и всё предплечье проверяются. Начальная reference ищется боковым расслаблением рук, а не подъёмом к лицу.
- Контактная коррекция учитывает движущиеся torso/clavicle parents, ограничивает скорость и проверяет путь. Малые контакты скользят по поверхности в пределах оставшегося углового бюджета. Вариант, который замораживал тело у границы, отклонён.
- Presence имеет малую амплитуду и отдельный предел скорости; supporting arm не выполняет ведущий жест. Нейронная кисть вместе с hand-score offset ограничена по swing/twist до temporal filtering.
- Standing IK определяет полную ориентацию ноги по стабильной опорной плоскости и больше не сохраняет случайный axial twist нейронной ноги.
- Камера не меняет body pose. Для локальных фаз сохранён bounded физический lead-in без преждевременного подтверждения новой фазы. Recovery использует допустимую reference, канонический бюджет 900–2600 ms и фактическое достижение выхода.
- Исправлен ложный audible underrun: удерживаемый дробный cursor при ожидании новой фазы не считается потерянным PCM-временем. Настоящее отставание от consumed audio продолжает обнаруживаться.
- Cold conditioning rebuild измеренно занял 150 s. Main-owned startup deadline увеличен до bounded 10 min; renderer не запускает отдельный 120 s фазовый timeout во время boot и начинает отсчёт после получения lease. Отмена процесса и прежний generation deadline сохранены.
- В обычном профиле выявлен дополнительный IPC contract mismatch: health schema ещё ограничивала `jointCorrections` четырьмя hinges, хотя теперь учитываются два wrists. Граница исправлена на точные 6 (2 elbows + 2 knees + 2 wrists), значения 7+ по-прежнему отклоняются. Это устраняет поток Zod errors и потерю health publications без подавления диагностики.

## Root Cause

Проблема состояла из нескольких дефектов. Прежние проверки ограничивались transport/readiness и тремя профилями; часть fixtures имела несвязанные кости. Затем даже связанный Green Fox fixture не описывал выбранную пользователем модель.

Live runner наследовал `vrmPath`: фактически он использовал VRM0 с 51 humanoid bone, SHA-256 `bac0c6eb597e3840241f0d319f7cfeace0621a0b198129aa778fd76aba1a4fac`. Bundled Green Fox имеет 54 кости и другой hash. Названия модели в прежних live-отчётах исправлены отдельным уточнением, старые неуспешные результаты сохранены.

У выбранной модели measured torso half-width = 0.2099 m, half-depth = 0.1358 m, sleeve radius = 0.0761 m. Inflated proxy ошибочно запрещал само соединение плеча с корпусом. Уже первоначальная «safe» поза поднимала кисть до Y 1.3931 m при плече Y 1.3818 m. Таким образом, все последующие профили и recovery исходили из плохой reference.

При движении ключицы старая сохранённая local arm pose переставала быть допустимой. Её неограниченная повторная проекция обходила speed limit: regression воспроизвёл скачок 0.39486 rad, около 22.6°. Standing IK дополнительно сохранял source axial twist, хотя стопа была зафиксирована. Нейронный wrist не имел собственного анатомического ограничения.

Отдельно в pinned LLM2Vec loader local base snapshot терял `_name_or_path`. Его formatter выбирал plain text вместо instruct template. Проверен фактический formatter pinned source; cosine similarity старых и новых 112 embeddings: min 0.93435, mean 0.96111, max 0.97122. Это подтверждённое отличие conditioning; оно не является единственным объяснением геометрических дефектов.

## Почему фикс работает

Reference теперь допустима для загруженной модели и держит кисти ниже плеч. Это проверено через production GLTF/VRM loader и совпадение normalized/raw joint positions после `humanoid.update()`, а не только на искусственных quaternion targets. Constraints применяются после композиции один раз, имеют отдельную непрерывную память и не возвращаются в neural filter как новый input. Камера и Overlay не создают другую траекторию. Body/wrist/fingers используют один phase cursor.

## Файлы

- `apps/desktop/motion/backend.py`, `tests/test_conditioning_cache.py` — encoder и совместимость derived cache.
- `apps/desktop/src/main/motion/ArdyMotionService.ts`, `apps/desktop/src/shared/motion/index.ts` — bounded cold startup и точная validation граница шести суставов.
- `apps/desktop/src/renderer/avatar/rendering/three/GeneratedBodyCalibration.ts`, `GeneratedBodySafety.ts`, `GeneratedBodyPlayback.ts`, `plantLeg.ts` — калибровка, композиция, непрерывность, wrist и support.
- `contracts/motion.v1.json` и синхронизированный каталог — recovery budget.
- `apps/desktop/tests/support/avatar/greenFoxRig.ts`, Avatar unit tests — фактическая иерархия, production loader, wide costume, движущиеся parents, breathing, wrist, support plane, audio clock и фазовые переходы.
- `apps/desktop/qualifications/speech-motion/qualify.cjs` — реальные Electron previews, все фазы, исход движения, bounded metrics и screenshots. Модель фиксируется hash, неподвижная поза не проходит проверку движения.

## Проверки

Полный финальный motion run: [`joint-2026-10-26T17-45-58-422Z/report.json`](../apps/desktop/motion/.artifacts/joint-2026-10-26T17-45-58-422Z/report.json). Real Electron + ARDY, выбранная пользовательская VRM, seed 17, 268.772 s. **28/28** численных проверок прошли. Все **22/22** одноразовых жеста наблюдались в prepare/stroke/hold/recover и завершились `completed`; все 30 finger bones присутствовали в проекции.

| Метрика финальной композиции | Результат | Порог |
| --- | ---: | ---: |
| Unresolved arm contacts, sampled maximum | 0 | 0 |
| Максимальный накопленный наклон корпуса | 5.2712° | 6° |
| Максимальный angular step между публикациями | 2.8985° | 3° |
| Худший p95 angular step presence | 0.6757° | 1° |
| Sampled motion errors | 0 | 0 |
| Максимальный source-frame hold вне local recovery | 162 ms | Отчётная метрика |

Первый полный прогон после новых физических исправлений (`17-38-45-333Z`) сохранил 0 contacts во всех 28 случаях, но не прошёл: `present_side` имел один step 3.1685°, а короткий `agree_soft` был ошибочно пропущен readiness-проверкой стенда. Стенд теперь учитывает фактически опубликованные matching-seed source frames и наблюдавшийся stroke вместо ожидания совпадения короткой фазы с кешированным health. Численные пороги не повышены. До этого отклонялись варианты с branch jumps и с зажатым неподвижным телом.

Проверки включают разные сценарии причины, а не повторение одной проверки: реальный rig/skin, moving-parent continuity, свободный source twist при одинаковой опоре, folded wrist, неподвижный PCM cursor на фазовой границе и настоящий delayed-audio underrun.

Совместный component run на окончательной сборке: [`joint-2026-10-26T18-18-46-377Z/report.json`](../apps/desktop/motion/.artifacts/joint-2026-10-26T18-18-46-377Z/report.json). **Общий pass не выставлен.** Cloudflare вернул rate limit: озвучено фактическое Runtime failure presentation, а не подтверждённая Character provider reply. Это не mock PCM и не успешная квалификация Character.

- Fish выдал 264192 consumed mono PCM samples, около 5.99 s при 44100 Hz; peak mouth 0.28391, peak RMS 0.05028, measured cue error 0 ms.
- Наблюдались 21 цикл Blink close/open, peak weight 0.61. Полное закрытие век не подтверждено.
- Все три отмены упражнялись через UI: до первого PCM — 0 ms, во время PCM — 53 ms, после передачи текста — 113 ms до наблюдаемого прекращения вывода. Проверка больше не завершается по `turn_terminal`, пока ещё не наблюдалась остановка локального вывода. После отмены новый generator запрашивается явно для следующего независимого сценария; `ARDY_CANCELLED` сам по себе не означает, что старый worker должен автоматически продолжить работу.
- Скрытый Main продолжал публиковать matching-lease source motion; Overlay toggle, renderer reload и обе UI themes прошли presentation probes. Короткое `loading` между физическими фазами не используется стендом как доказательство остановки Runtime.
- Под совместной нагрузкой сохранился `ARDY_PHASE_DEADLINE_MISSED`. Предыдущий ложный fractional-cursor underrun устранён, но оставшийся реальный phase deadline не объявляется исправленным. В первом совместном прогоне inference доходил до 521 ms при horizon 400 ms.

Проверены, но не включены экспериментальные изменения precision: TF32/high и autocast BF16 не дали устойчивого доказанного решения совместной нагрузки. Pinned веса, FP32 motion inference и число denoising steps не изменены ради проходящего теста.

Финальные статические проверки: Biome check/format/imports, TypeScript, build и `motion:catalog:check` прошли. Полный Desktop regression после исправления health schema: 109 файлов, **402 теста**. Motion Python: **45 тестов**; Ruff check/format для изменённых Python файлов прошли. Production-loader regression отдельно выполнен на выбранной пользовательской VRM. Реальный cold encoder rebuild выполнен отдельно; проход 150 s через Main/renderer deadlines проверен с fake clock. Полный Electron запуск с физически удалённым новым cache не повторялся.

## Ограничения

- `visualAcceptance` остаётся `pending`, профили — `draft`. Pass выше подтверждает стабильность одного seed на выбранной VRM, а не художественную приёмку каждого описания, все seeds, все rigs или длительный soak. Например, на сохранённом stroke-кадре air kiss кисть ещё ниже зоны губ.
- Нулевой контакт относится к измеренному torso/limb proxy и sampled diagnostics; это не доказательство отсутствия любого пересечения mesh, волос, пальцев и свободного костюма.
- Совместная Character/Fish/ARDY квалификация остаётся не принятой из-за provider rate limit и `ARDY_PHASE_DEADLINE_MISSED`. Наблюдаемые LipSync/Blink и успешные отмены не подменяют эти два результата; full Blink closure также не принято.
- После закрытия изолированных qualification instances проверено отсутствие открытого Shio и запущена новая собранная dev-версия в обычном пользовательском профиле. Пользовательский Speech API не останавливался. Сохранённая численная приёмка относится к указанным изолированным прогонам; художественная приёмка открытого пользовательского окна остаётся отдельной.
- В финальном пользовательском запуске оставлен один Main process (PID 38800), открыто окно `Shio Runtime`; повторных `avatar-runtime:publish-health`/Zod/cache ошибок в новом stdout log не наблюдается. Лишние экземпляры, созданные при проверке запуска, и их дочерние процессы остановлены; исходный Speech API сохранил Fish/ASR readiness.
- Коммит, публикация и изменение статуса `qualified` не выполнялись.
