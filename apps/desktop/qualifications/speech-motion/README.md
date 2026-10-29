# Live qualification: речь и движение

Команды запускаются из корня репозитория после `npm run build`. Нужен работающий Speech API с настоящим Fish; Desktop не запускает и не завершает чужой API. Runner создаёт отдельный профиль в `tmp/`, копирует конфигурацию и зашифрованные LLM credentials, отключает автономные инициативы и закрывает только собственный Electron. Пользовательская конфигурация не изменяется.

```powershell
# 28 профилей × 12 фиксированных seeds, пять камер, реальная выбранная VRM
npm run experiment:qualify -- --body-stability-only --seed-count=12 --body-seconds=6

# Контрольная bundled-модель
npm run experiment:qualify -- --body-stability-only --bundled-model --seed-count=3 --body-seconds=6

# Явная внешняя qualification fixture, например официальный VRM1 sample
npm run experiment:qualify -- --body-stability-only --vrm-fixture=D:\Dev\shio-runtime\tmp\official-vrm1-twist.vrm --seed-count=3 --body-seconds=6

# Совместный прогон с UI/Overlay, длинной реальной речью и отменами
npm run experiment:qualify -- --component-smoke --skip-profiles --replace-model-during-speech --duration-seconds=1800 --warm-responses=3 --seed-count=1

# Отдельно: настоящий PCM до finish-input, отмена inference и повторная сессия
node apps/desktop/qualifications/speech-motion/fish-protocol-probe.cjs
```

Protocol probe ждёт server-owned close после terminal acknowledgement: готовность Fish engine и освобождение admission slot — разные события. Немедленное закрытие клиентом и новая сессия ошибочно воспроизводили `synthesis_busy`; такой run сохранён как failure, а не как проверенная отмена.

Для диагностики доступны `--profile-ids=laugh_soft,shy_gather,fox_paw_single`, `--short-speech`, `--model-only`. Изолированный профиль может выбрать доступный Character provider через `SHIO_QUALIFICATION_LLM_PROVIDER` и `SHIO_QUALIFICATION_LLM_MODEL`; секреты остаются в обычном Main credential store.

`--semantic-cases` добавляет 20 production Character-сценариев на русском и английском. Проверяются ранние typed intent и фактический соответствующий stroke/hold в общей Overlay projection во время активного PCM. Отсутствие жеста допустимо только в отмеченных fixtures; выданный intent должен быть исполнен. Нужен qualified candidate: unavailable/draft case фиксируется как failure, а не засчитывается по одному ответу LLM. Сами fixture-фразы не импортируются Runtime и не образуют phrase router.

Для отдельной диагностики доступен строгий subset, например `--semantic-cases --semantic-case-ids=greeting-not-agreement-ru,shy-gather-not-concern-ru,explicit-peace-sign-ru`. Отчёт содержит только фактически выполненные cases; такой run не заменяет полную двуязычную матрицу.

`--models-only` выполняет только read-only model discovery через штатный Main API в изолированном профиле. Его `provider-model-discovery` report не является speech/motion qualification; наличие модели в списке не доказывает достаточную квоту для Character request.

`--core-only` отключает optional Plugins через штатный Main API только в принадлежащем runner изолированном профиле. Это отдельная проверка независимости Core; исходная конфигурация пользователя и обязательный Character protocol сохраняются.

`--response-spacing-seconds=75` выдерживает паузу между независимыми речевыми сценариями, включая semantic и cancellation cases. Это pacing теста для provider quotas; оно не задерживает PCM, отдельный жест или production turn и не повторяет неуспешные запросы автоматически.

По умолчанию финальный звук отключён только у принадлежащих тесту Electron WebContents. Fish inference, AudioPlayer, consumed PCM и analyser/LipSync остаются настоящими; это не субъективная проверка звучания. Для прослушивания добавьте `--audible`. Громкость ОС и пользовательская конфигурация не меняются.

Опция `--record-video` записывает принадлежащий runner Overlay в `overlay.mp4` через ffmpeg; запись без звука, 10 кадров/с. Пропуски таймера могут сократить длительность файла относительно `video.durationMs` в отчёте, поэтому для измерения синхронизации используют PCM и timestamps диагностики, а не шкалу видео. Запись помогает сравнивать крупные движения, но не подтверждает качество звука, синхронизацию фонем или отсутствие мелкой дрожи. Ошибка записи отмечается в отчёте как failure.

Результаты находятся в `apps/desktop/motion/.artifacts/joint-*/report.json` и соседних изображениях. Hash и версия fixture, реальные seeds, execution/phase/outcome, FK wrist/palm/finger aggregates, contacts и численные thresholds сохраняются отдельно от художественной приёмки. Raw poses используются только transient и в отчёт не записываются.

Autonomous Living v1 использует полный 900-s сценарий через существующий Chat UI:

```powershell
$env:SHIO_EXPERIMENT_MOTION_PROVIDER = 'motionbricks'
$env:SHIO_EXPERIMENT_SOMA_HAND = '1'
$env:SHIO_MOTION_ROOT = (Resolve-Path 'apps/desktop/motionbricks').Path
node apps/desktop/qualifications/speech-motion/prepare-living.cjs
$env:SHIO_QUALIFICATION_DESKTOP_ROOT = (Get-Content 'apps/desktop/motion/.artifacts/living-motion/latest-snapshot.txt' -Raw).Trim()
npm run experiment:qualify -- --conversation-cases --autonomous-living --duration-seconds=900 --warm-responses=1 --skip-profiles --living-v2-telemetry --body-trace-only --stabilization-trace --fixed-preview-smoke --autonomous-policy-smoke
```

`--autonomous-living` запрещает subset и требует 900 s. Schedule включает паузу без новых сообщений, Stop во время PCM и новый вопрос
после Stop. Runner дополнительно ждёт 120 s после фактического завершения речи
перед возвращением к вопросам; при медленном provider видео может быть длиннее
900 s, и фактическая длительность фиксируется в отчёте. Ответы и intents
создаёт настоящий Character LLM. `--recovery-chat-smoke` отдельно проверяет только
Stop/new turn и не заменяет длительную qualification. `--autonomous-policy-smoke`
после записи проверяет настоящие one-shot reminder через Scheduler/Gate/Admission:
Off, Suspend и Privacy блокируют речь, Full допускает одну инициативу. Исходные
settings восстанавливаются; пользовательский профиль не меняется. Quiet hours,
cooldown и daily cap не отключаются. Если они не дают выполнить проверку, это
честный непрошедший gate. Позитивный результат не доказывает художественное качество.

Длительная diagnostic trace ограничивается 30-Hz sampling и полным duration budget;
фактическая частота и overflow объявляются. Video/FPS capture остаётся независимой.

Для обеих кистей выполните `--body-stability-only --finger-close-up` отдельно с
`--finger-side=left` и `--finger-side=right`. Имена видео содержат сторону. Один
ракурс поддерживающей кисти не заменяет проверку ведущей кисти соответствующего
профиля. `--living-lifecycle-smoke` после основного набора проверяет model reload,
Overlay reconnect и точечный fault/reload единственного Python worker именно
этого worktree. Он не завершает чужие Python процессы или Speech API. Переход к
новому worker должен закончиться одним inference owner и спокойной base-позой.

`--finger-warmup` перед первым измеряемым close-up выполняет одну настоящую
вариацию через тот же UI и сохраняет её целиком в `fingers-*-initialization.webm`.
Это отдельное evidence первого запуска; его FPS не засчитывается как PASS.
Затем каждый измеряемый жест снова исполняется целиком с prepare/stroke/hold/recover.
В report явно записаны warmup outcome/video и actual measured FPS каждого клипа;
порог 60 FPS и geometric thresholds сохраняются. Без этого флага измеряется
первое исполнение, включая initialization stalls. Источник hand fit фиксируется
SHA-256 `motionbricks/hand_prior.py` вместе с остальными build identities.

Новые отчёты также фиксируют SHA-256 самого runner и его geometry/semantic/standing fixtures. После обычного ответа runner проверяет отсутствие служебных emotion/voice/embodiment markers в видимом чате и сохраняет только boolean результата, не полный текст ответа.

`steps` сохраняет исходные angular deltas между IPC projections. `normalizedSteps` приводит их к 33.333 ms по monotonic времени primary composition: несколько coalesced render frames не считаются одним кадром. Исходные скачки, интервалы и снимки остаются в отчёте. Это проверка скорости composed projection, а не обещание постоянного FPS; frame probe отдельно сохраняет пропуски RAF и histogram.

`recoveryBlockers` содержит только bounded имена недостигнутых exit conditions из Runtime Health. Таймаут recovery остаётся failure даже при безопасной конечной позе и нулевом contact count.

`component-smoke` позволяет продолжить проверку реального Fish и Avatar при отказе Character provider, но такой отказ остаётся в failures и не может дать общий pass. Наличие плана `standingQualification` или снимков не переводит профили в `qualified`: визуальная приёмка остаётся отдельной. Моргание проверяется по циклам закрытия/открытия при существующей настройке Blink, без требования насильно менять её амплитуду.

Официальная VRM1 fixture в ночной проверке: [pixiv/three-vrm sample](https://github.com/pixiv/three-vrm/blob/ff42fae4fcee1fcbca2cd262c7f5f8cbddeaf5ab/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm), SHA-256 `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2`. Модель не включается в git; её metadata разрешает everyone/avatar и redistribution по VRM Public License 1.0.

Для безопасной регрессии закрытого stdout/stderr:

```powershell
node apps/desktop/qualifications/speech-motion/epipe-smoke.cjs
```

Это headless Electron fixture со штатным safe logger. Принадлежащий Node parent
намеренно закрывает оба pipe. Неожиданное исключение записывается в файл и даёт
FAIL/exit 1 до стандартного Electron dialog. Тест не запускает inference.

`--overlay-width=840 --overlay-height=720 --view-mode=bust` выбирает более широкий
обычный Overlay ракурс только в тестовом профиле, через существующие настройки.
Он не меняет production camera или пользовательскую конфигурацию. Narrow view
может честно исключить compare и другие жесты из runtime availability.

`--stabilization-summary` вместе с `--stabilization-trace` сохраняет все render
deltas, sampled CPU stage timings, consumed PCM cursor, lifecycle/safety counts,
projection age и timing каждого consumed horizon. Полные poses/horizons в этом
режиме не копируются. Это уменьшает влияние диагностических allocations на GC;
для spectral/pose RCA сохранены отдельные полные traces и 120-s idle recordings.
Baseline full-pose и summary-only performance нельзя сравнивать как эффект одной
production поправки. Video/FPS и thresholds независимы от выбора trace.

`--autonomous-living-smoke --conversation-case-ids=calm,explanation` — явно
помеченный diagnostic subset через Chat UI, без финальной приёмки. Он не меняет
120-s conversation deadline и не заменяет полный `--autonomous-living`.

`--recovery-repro` сохраняет ограниченные числовые snapshots entry/timeout и
последние стадии failed gesture для offline воспроизведения solver. Только этот
opt-in diagnostic режим сохраняет pose/target values в отчёт; обычный report
остаётся агрегированным. Все временные observers и wrappers восстанавливаются
при stop. Эти hooks отсутствуют в production build.

`--living-facial-matrix` отдельно задаёт девять semantic emotions через existing
facial owner. Report сохраняет actual facial capabilities пользовательской VRM;
missing independent channels нельзя считать проверенными по compound presets.
Эта component matrix не подменяет ordinary Character LLM Chat или художественную
оценку. Полный final run также использует `--living-lifecycle-smoke` и
`--fixed-preview-smoke`; обе кисти проверяются отдельными полными close-ups на том
же frozen snapshot.
