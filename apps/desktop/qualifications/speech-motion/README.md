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

Результаты находятся в `apps/desktop/motion/.artifacts/joint-*/report.json` и соседних изображениях. Hash и версия fixture, реальные seeds, execution/phase/outcome, FK wrist/palm/finger aggregates, contacts и численные thresholds сохраняются отдельно от художественной приёмки. Raw poses используются только transient и в отчёт не записываются.

Новые отчёты также фиксируют SHA-256 самого runner и его geometry/semantic/standing fixtures. После обычного ответа runner проверяет отсутствие служебных emotion/voice/embodiment markers в видимом чате и сохраняет только boolean результата, не полный текст ответа.

`steps` сохраняет исходные angular deltas между IPC projections. `normalizedSteps` приводит их к 33.333 ms по monotonic времени primary composition: несколько coalesced render frames не считаются одним кадром. Исходные скачки, интервалы и снимки остаются в отчёте. Это проверка скорости composed projection, а не обещание постоянного FPS; frame probe отдельно сохраняет пропуски RAF и histogram.

`recoveryBlockers` содержит только bounded имена недостигнутых exit conditions из Runtime Health. Таймаут recovery остаётся failure даже при безопасной конечной позе и нулевом contact count.

`component-smoke` позволяет продолжить проверку реального Fish и Avatar при отказе Character provider, но такой отказ остаётся в failures и не может дать общий pass. Наличие плана `standingQualification` или снимков не переводит профили в `qualified`: визуальная приёмка остаётся отдельной. Моргание проверяется по циклам закрытия/открытия при существующей настройке Blink, без требования насильно менять её амплитуду.

Официальная VRM1 fixture в ночной проверке: [pixiv/three-vrm sample](https://github.com/pixiv/three-vrm/blob/ff42fae4fcee1fcbca2cd262c7f5f8cbddeaf5ab/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm), SHA-256 `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2`. Модель не включается в git; её metadata разрешает everyone/avatar и redistribution по VRM Public License 1.0.
