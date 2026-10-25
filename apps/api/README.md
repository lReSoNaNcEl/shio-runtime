# Python Speech — ASR + Fish Audio S2 Pro

Независимый FastAPI-сервис, порт 8000. ASR использует faster-whisper и Silero VAD;
TTS — локальный `fishaudio/s2-pro` с зафиксированными source/model revisions.
Установка, аппаратные требования, лицензия и измерения:
[эксперимент Fish/S22](../../docs/EXPERIMENT-FISH-S22.md).

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
| `WS /tts/stream` | protocol 1: incremental text/delivery → ordered binary mono Float32 LE PCM |
| `POST /tts/warmup` | прогрев выбранного логического голоса |
| `GET /voices`, `/emotions` | доступные референсы и общий контракт эмоций |
| `GET /voices/status`, `POST /voices/sync` | атомарная синхронизация референсов |
| `POST /recognize` | ASR аудиофайла |
| `WS /ws/asr` | существующий поток ASR; `/ws` — совместимый alias |
| `GET /asr/stream-protocol` | описание протокола ASR |

Синтез: `start` → `ready`, затем `text`/`delivery` с общей возрастающей sequence,
`finish-input`. Каждому JSON `audio` соответствует один бинарный пакет, который
клиент подтверждает `audio-ack`; завершается потоком `complete`. Метаданные audio
содержат `emotion` и `textSequence` для синхронизации визуального представления.
`cancel` отменяет и ожидающее, и активное GPU-исполнение. Очереди и время сессии
ограничены. Во время перезагрузки worker health показывает `loading`.

HTTP contract версии 2.0 намеренно удаляет прежний `/synthesize` и альтернативные
TTS-движки. Воспроизведение, LipSync, состояние персонажа и анимация принадлежат
Desktop; API не импортирует код Desktop и не управляет моделью S22.

Канонические эмоции — `contracts/emotions.v2.json`. Запустите
`npm run emotions:sync` после изменения. Voice Registry остаётся владельцем
логических ID; аудио и точный transcript обязательны. Identity кеша включает
voice ID, хеши обоих референсов и model revision. Референсы не изменяются.

```powershell
npm run api:lint
npm run api:format:check
npm run api:test
```

Mock-тесты не подтверждают работу весов. Для настоящей проверки нужны готовый
`/health`, бинарный PCM из `/tts/stream`, ранний первый пакет, обработка отмены
и повторная сессия. Не коммитьте `.venv`, модели, кеши, голосовые ассеты или аудио.
