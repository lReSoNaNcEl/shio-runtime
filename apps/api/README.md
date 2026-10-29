# Python Speech — ASR + Fish Audio S2 Pro

Независимый FastAPI-сервис, порт 8000. ASR использует faster-whisper и Silero VAD;
TTS — локальный `fishaudio/s2-pro` с зафиксированными source/model revisions.
Установка, аппаратные требования, лицензия и измерения:
[эксперимент ARDY/Fish](../../docs/EXPERIMENT-ARDY-FISH-S2-PRO-TZ.md).

```powershell
# Из корня монорепозитория
npm run api:install:dev
npm run api:prefetch
npm run api:voices:sync
npm run api:doctor:strict
npm run api:dev
```

Каноническое окружение — `apps/api/.venv`, Python 3.12. Установка использует
lock-файлы; `npm run api:lock` пересобирает их в чистом временном окружении.
`SHIO_API_PYTHON` выбирает интерпретатор. `.env.example` содержит настройки;
не изменяйте модельные revisions отдельно от release manifest и квалификации.

| Endpoint | Контракт |
|---|---|
| `GET /health` | readiness ASR и synthesis, engine `fish-s2-pro`, mode `real`, revisions |
| `WS /tts/stream` | protocol 2: incremental text/delivery → ordered binary mono Float32 LE PCM |
| `POST /tts/warmup` | прогрев выбранного логического голоса |
| `GET /voices`, `/emotions` | доступные референсы и общий контракт эмоций |
| `GET /voices/status`, `POST /voices/sync` | атомарная синхронизация референсов |
| `POST /recognize` | ASR аудиофайла |
| `WS /ws/asr` | существующий поток ASR; `/ws` — совместимый alias |
| `GET /asr/stream-protocol` | описание протокола ASR |

Синтез: `start` → `ready`, затем `text`/`delivery` с общей возрастающей sequence,
`finish-input`. Каждому JSON `audio` соответствует один бинарный пакет, который
клиент подтверждает `audio-ack`; завершается потоком `complete`. Метаданные audio
содержат `sessionId`, `turnId`, `sequence`, `sampleOffset`, `samples`, `emotion`
и `textSequence`. `sampleOffset` — монотонная позиция в исходных PCM-сэмплах.
`cancel` отменяет и ожидающее, и активное GPU-исполнение. Очереди и время сессии
ограничены. Во время перезагрузки worker health показывает `loading`.

HTTP contract версии 2.1 намеренно удаляет прежний `/synthesize` и альтернативные
TTS-движки. Воспроизведение, LipSync, состояние персонажа и анимация принадлежат
Desktop; API не импортирует код Desktop и не управляет 3D-моделью VRM.

Канонические эмоции, reply-wide intensity, delivery и grammar — `contracts/emotions.v3.json`. Запустите
`npm run emotions:sync` после изменения. Voice Registry остаётся владельцем
логических ID; аудио и точный transcript обязательны. Identity кеша включает
voice ID, хеши обоих референсов и model revision. Референсы не изменяются.
`referencesAvailable` и `conditioningReady` различаются: последнее подтверждает
успешную подготовку текущим живым Fish worker и сбрасывается после его остановки.
Health доступен во время загрузки, сообщает `loading`/`warming`/`ready`/`failed`,
compile mode, warmup и bounded error. После cancel новый worker загружается заново;
отправка `cancelled` ждёт завершения реальной GPU-работы.

Для коротких речевых сегментов Fish Adapter выделяет KV-кэш на 4096 токенов
вместо 32768, используя штатный `max_length` загрузчика. Из них upstream
резервирует 2048 под генерацию; слишком длинный prompt/reference отклоняется явно.
Три неиспользуемые inherited causal masks оконного кодека удаляются до переноса
на CUDA; рабочие маски по длине аудио сохраняются. Модель, checkpoint/source pins,
BF16-веса, FP32-кодек, sampler, compile и HTTP/PCM-протокол остаются прежними.
Свёрточная waveform-часть кодека декодирует блоки по 128 latent frames с полным
левым контекстом, вычисленным из causal convolution topology (19 frames для
pinned revision). Последний блок дополняется справа и обрезается по точному
числу samples. Это ограничивает формы крупных временных CUDA-выделений и
устраняет накопление резерва при декодировании растущих префиксов. Quantizer и
attention получают полный префикс; речь не обрезается и не делится по тексту заново.
Правка не вводит глобальный allocator budget или перенос вычислений в RAM.

Страница `/` поддерживает RU/EN, обе темы, ручной incremental input, ранний звук,
ограниченный буфер 1,5 с, sample offsets, WAV preview и ASR через `/recognize`
и `/ws/asr`. Тестовый WAV ограничен 600 секундами. Эта страница не владеет ARDY.

```powershell
npm run api:lint
npm run api:format:check
npm run api:test
```

Mock-тесты не подтверждают работу весов. Для настоящей проверки нужны готовый
`/health`, бинарный PCM из `/tts/stream`, ранний первый пакет, обработка отмены
и повторная сессия. Не коммитьте `.venv`, модели, кеши, голосовые ассеты или аудио.

