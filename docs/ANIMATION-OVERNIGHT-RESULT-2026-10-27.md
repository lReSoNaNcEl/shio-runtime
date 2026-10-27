# Ночная проверка анимаций — 27 октября 2026

**Промежуточный отчёт. Работа продолжается; итоговая live-матрица и совместный soak ещё не завершены.**

## Принятая пользовательская physical matrix — 08:15 MSK

`joint-2026-10-27T04-18-54-545Z` завершён: **336/336 numerical passes**, 28 профилей × 12 seeds, 3275.494 s. Contacts 0, максимальный torso tilt 5.35356°, максимальный нормированный angular step 2.23097° / 33.333 ms. Все gesture executions завершены и содержат prepare/stroke/hold/recover; presence остаётся корректным loop. V index/middle opening — 26.59044°. SHA-256 выполняемых build files дополнительно сверен после run: отличий от initial report нет.

Визуально просмотрены full body и обе кисти всех 28 профилей на seeds 17, 503 и 10009; scope и ограничения записаны отдельно в `visual-review.json`. Последовательные снимки камер относятся к разным фазам; точная фаза сохранена в `views`. Recovery image не выдаётся за accent endpoint. Для kiss отдельно проверен face preparation и дальнейшее outward opening по сохранённым bounded FK aggregates.

Frame probe за весь run: Main mean RAF cadence 351.57 Hz, p95 interval ≤3 ms, max 372.3 ms; Overlay 358.88 Hz, p95 ≤3 ms, max 33.2 ms. Это измерения callback cadence в данном окружении с UI/camera captures, не гарантия реального presentation FPS при любой нагрузке. Остальные rigs и совместная речь ещё проверяются; physical pass не закрывает прежний открытый audible handoff risk.

## Текущая контрольная точка — 07:37 MSK

Финальная physical matrix на пользовательской VRM: `joint-2026-10-27T04-18-54-545Z`, 99 завершённых cases без численных failures на контрольной точке. Полная приёмка 336 cases ещё не завершена; после неё последовательно выполняются bundled VRM0 и официальный VRM1, по 84 cases. Все 28 профилей seed 17 просмотрены в full-body и обеих hand views; `visual-review.json` сохраняет границы приёмки. Руки в presence теперь естественно опущены. Предыдущий A-pose candidate `joint-2026-10-27T01-22-28-226Z` отклонён, остановлен и не считается успехом.

Подтверждённое дополнительное RCA: общий upper-sleeve radius завышал толщину forearm; arm-deforming sleeve vertices попадали в неподвижный torso; skeleton fallback оставался нижней границей поверх фактически меньшей measured geometry. Исправлены калибровка raw shoulder/arm subtree, отдельный forearm envelope и использование реальной torso geometry при достаточных finite samples. Временные дополнительные reference-search prototypes полностью удалены: геометрический fix самостоятельно дал green actual-user-rig regression. Canonical recovery regression затем обнаружил dead-end waypoint: теперь проверяются обе части пути previous→waypoint→actual rest. Padding, скорости, модели и skin weights не ослаблены.

На этой body calibration прошли 469 Desktop tests / 110 files, Avatar 203 / 22 files, check/format/imports/typecheck/build. Focused spatial/hand/camera/real-rig files: 74 passes с пользовательской fixture и 74 с VRM1; часть cases намеренно фиксирует bundled rig. Motion Python — 45, API — 58 tests. Выполняющийся out неизменен: renderer `index-CUYfkKtt.js`.

Пользователь настроил OpenRouter `dots-studio/dots-3-note-preview:free` и сообщил о видимом `<happy]`. Точный дефект воспроизведён: emotion matcher/prefix hold распознавали только квадратные скобки. Отдельный protocol patch подавляет malformed canonical emotion delimiters без выдачи им emotion authority; code, escaped literals, URLs и unknown literals сохраняются. Focused stream/speech/embodiment tests: 16/16, включая три новых tests; до исправления два failures. Этот patch ещё не включён в текущую matrix: отдельная сборка и совместный OpenRouter/Fish soak следуют после физической проверки.

**Далее сохранена история предыдущих контрольных точек. Её сведения о текущем candidate, draft status и ожидаемых проверках могут быть устаревшими; итоговый отчёт ещё не составлен.**

Контрольная точка 04:27 MSK: routed/front VRM1 `joint-2026-10-27T00-07-10-582Z` — 84/84; bundled с recovery max 4500 `joint-2026-10-27T00-35-52-534Z` — 84/84, contacts 0, max normalized step 2.696°, max torso tilt 5.343°. Full-body и обе кисти всех 28 профилей seed 17 просмотрены, отдельные `visual-review.json` сохраняют границы этой приёмки. Пользовательская окончательная 28×12 matrix выполняется в `joint-2026-10-27T01-22-28-226Z`; незавершённый run не считается pass.

Настоящий Fish protocol probe `fish-protocol-2026-10-27T00-53-28-807Z` прошёл normal → cancel → normal: первый PCM до finish-input во всех трёх сессиях, отмена 729 ms, следующая сессия получила настоящий PCM. Предыдущие transport runs ошибочно закрывали клиентский socket до освобождения server admission slot; они сохранены как failures. API engine readiness и освобождение transport slot не приравниваются.

Candidate activation проведена через настоящий canonical qualification gate, без test-only overrides. На этой сборке прошли 467 Desktop / 45 Motion tests и build. Первый последующий joint reply выявил новый STALE_PLAN на окончании короткого PCM: Main уже принял hold forecast, а защищённый stroke повторно запрашивался после release clock. Постоянный owner regression устойчиво red→green после явного normal speech release в local recovery; последующий Avatar suite — 202/22 files. Main stale guard не ослаблен. Также исправлено ложное `rig-unsupported` / `draft` при degraded generator. Физические скорости, scores и seeds этим не меняются.

Production semantic scenarios пока **не приняты**: фактические Cloudflare, Groq и Mistral запросы возвращали RATE_LIMITED, Groq Llama 70b отсутствует в текущем штатном model list, OpenRouter Gemma также не дал квалифицированного Character ответа. Real Fish PCM и LipSync при provider-failure presentation не засчитываются как Character pass. Отдельные runs сохраняют AUDIBLE_UNDERRUN; эта проблема остаётся открытой. Core-only qualification без optional Plugins готовится отдельно. Catalog остаётся candidate, а не объявленным итоговым успехом.

## Architecture Review

Владельцы сохранены: Main управляет одним ARDY worker; Avatar Runtime выполняет retargeting, constraints и hand composition; AudioPlayer задаёт consumed PCM clock; Expression Mixer остаётся единственным facial writer. Overlay получает ту же transient composed projection. API независимо владеет Fish. HTTP 2.1 / stream protocol 2, закреплённые ARDY/Fish веса и исходники не менялись. Модель, skin weights, Spring Bones и colliders не редактировались.

## Что изменено и Root Cause

- Следующие canonical phases подготавливаются заранее, не исполняясь до границы. Matching forecast сохраняется при первой привязке PCM; late speech accent не проигрывается задним числом.
- Initial prepare использует существующий inference budget 2500 ms. Прежние 400 ms отвергали реальный первый чанк в 570 ms; строгий бюджет последующих audible boundaries сохранён.
- Workspace, palm/finger orientation и завершение проверяются по фактической геометрии VRM. Учитываются неколлинеарные bind axes локтей, поверхность одежды, стабильные IK branches и bounded подход к ним.
- Микроскопический contact metric 0.99997775 блокировал любой путь из уже слегка penetrating старта. Разрешён только неуглубляющий выход с прежним speed limit; исходно clear руки по-прежнему не проходят через торс.
- При неизменном consumed PCM constraint approach больше не продолжает движение по render clock. Actual-rig regression до фикса измерял до 0.821 rad смещения руки при buffering; теперь проверяет удержание и ограниченное возобновление.
- Recovery root интерполируется от сохранённой начальной позиции. Ранее повторный lerp ускорял возврат на 360 Hz на 0.465 относительно 30 Hz. Новый тест сравнивает оба режима.
- Низкие жесты получили достижимую собранную зону перед талией и достаточное время подготовки из предыдущего жеста. Проверяется реальное расстояние кистей и положение «лапки» ниже груди.
- Благодарность и смех получили более низкую heart-zone; palm остаётся inward, направление пальцев может быть диагональным. Height regression сначала воспроизвёл wrist на 0.1756 m выше chest при допустимых 0.0908 m.
- Ручной Preview удаляет устаревшие pending requests. Presence с ожидающим следующим intent уступает через recovery. Два постоянных теста воспроизводили starvation; live agree_soft/907 до фикса не получил ни одного кадра.
- Overlay учитывает monotonic время primary composition, в том числе при held source cursor во время recovery. Stale packets отвергаются в пределах полной lease identity; новая renderer generation может начать clock заново.
- Исправлен model-specific знак разведения пальцев по измеренной palm basis. V на пользовательской VRM раскрывался лишь на 5.446°, хотя разгибание пальцев проходило прежний тест. Новый regression измеряет индивидуальный bind flexion и угол index/middle; диапазон 12–45° прошёл на пользовательской VRM0, bundled VRM0 и официальном VRM1. Амплитуды score и пределы суставов не увеличены.
- API session finally теперь отменяет и наблюдает receiver/sender перед завершением producer. Существующий cancellation regression был устойчиво red; после исправления API suite проходит. Независимый пользовательский API на 8000 не перезапускался: новая shutdown-ветка ещё не загружена в этот процесс.
- Local recovery clock теперь использует тот же bounded integration step, что и safety. Отдельный wall deadline предотвращает зависание при сильном throttling. Невосстановленная опора/рука даёт latched failure с bounded причиной, а не зелёный Runtime Health.
- Первый matching кадр новой фазы начинает её фактический elapsed с нуля. Прежний local lead-in ошибочно засчитывался новому stroke/hold: regression измерил 21.875% progress уже на первом кадре. Поэтому короткий hold мог исчезать из Overlay, а цель — не успевать достигаться.
- Conversational availability использует реальные selection weight/automatic/speaking gates и отсутствие latched error. Manual kiss и reaction-only stretch не рекламируются как исполнимый opening speech gesture. Сам каталог пока draft.
- Transition hand probe использует ту же loaded finger calibration; раньше уже совпавшая форма давала ложную transition error 0.28 rad.
- Hand Preview кадрируется по composed wrist/palm/finger bounds, с запасом для fingertip, реальным FOV/aspect и стабильным радиусом. Прежняя камера обрезала длинные пальцы на bundled VRM0. Новые frustum/resize tests проходят на трёх rigs.
- Камера получает front convention VRM0/VRM1 от Avatar owner. VRM1 ранее показывался со спины; новые full/bust/face/hand presets и Overlay меняют только камеру, сохраняя модель и кости.
- VRM1 kiss выявил contact trap при recovery. Canonical clear-start regression оставлял 2.7427 rad ошибки после 300 ticks. Конечный bounded recovery-only search включает outside/front/back/up варианты, каждый со swept-path проверкой; actual arm approach использует общий fraction при прежних per-joint speed budgets. Canonical test проверяет также max step и отсутствие контактов.
- Сохранён точный hold при buffering: clear held arm не ремонтируется из-за одного padding; wrist repair разрешён только для затронутой руки. Actual collision guard сохранён. Новая пользовательская preservation-проверка сначала воспроизвела 0.0216 rad drift, затем стала green.

## Проверки на контрольной точке 03:17 MSK

| Проверка | Реальный результат |
|---|---|
| Desktop regression | 467 passed, 110 files |
| Desktop check / format / imports / typecheck | passed |
| Desktop build | passed; renderer asset hashes включены в qualification report |
| Motion Python | 45 passed |
| API lint / format / tests | passed; 58 tests |
| VRM1 production-loader/geometry regression | 40 passed до последней heart calibration; новый heart workspace также прошёл 23 spatial tests |
| Ранний совместный Groq/Fish/ARDY smoke | настоящий Character stream и Fish PCM; LipSync/Blink прошли; требуется повтор на итоговом коде |
| Предыдущая большая matrix | остановлена на 172 cases после обнаружения starvation agree_soft/907; не считается pass |
| Candidate 2 пользовательская matrix | остановлена после обнаружения недостаточного V-opening на целевой VRM; numerical execution failures до остановки не наблюдались |
| Пользовательская candidate 3 matrix | завершены 336 cases; 333 passed, два recovery timeout и один незафиксированный hold; это failure |
| Новый applied-phase-clock candidate | disagree + thank, 24/24 passed на 12 seeds, все четыре фазы наблюдались |
| Bundled VRM0 до recovery-routing correction | 84/84 passed; затем потребовался новый candidate для VRM1 |
| Первый VRM1 run | 27 sampled, kiss/17 recovery failure; сохранён как failure |
| Новый routed/front-facing candidate | VRM1 выполняется, первый seed 28/28 pass; затем последовательно bundled VRM0 |

## Доказательства

- План и подробное RCA: [ANIMATION-OVERNIGHT-PLAN-2026-10-26.md](ANIMATION-OVERNIGHT-PLAN-2026-10-26.md).
- Ранний настоящий совместный smoke: `joint-2026-10-26T20-14-04-924Z`.
- Завершённая targeted matrix до уточнения gathered geometry: `joint-2026-10-26T21-16-58-264Z`, 9/9 pass.
- Предыдущая full candidate matrix: `joint-2026-10-26T21-27-41-591Z`, остановлена, содержит снимки всех 28 профилей и derived review sheets.
- Candidate 2 matrix до finger-binding fix: `joint-2026-10-26T22-01-06-999Z`, остановлена.
- Текущая итоговая matrix с finger calibration: `joint-2026-10-26T22-13-37-282Z`. Первый live V-opening — 26.5904°; завершены все четыре фазы, contacts 0.
- Все указанные каталоги находятся в `apps/desktop/motion/.artifacts/`; отчёты не содержат raw poses, аудио или credentials.

## Ограничения и оставшаяся работа

Повторная полная matrix после applied-phase-clock fix, bundled VRM0, live VRM1 и длительный Fish/ARDY/LipSync/Blink soak ещё ожидаются. Снимки и численные passes не подменяют художественную приёмку; profiles остаются draft. Torso proxy не доказывает отсутствие контактов каждой вершины волос/одежды/пальцев. Внешние Character providers могут ограничивать квоту; ошибки не считаются успешной речью. API shutdown patch требует обычного перезапуска отдельной службы для применения.
