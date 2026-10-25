# Эксперимент Fish Audio S2 Pro + Shio S22

Ветка `experiment/fish-s2-pro-shio-2d-v22` начата непосредственно от
`origin/main` (`39310f0d7a17616c30e2becdeeda845670353320`). Предыдущая
экспериментальная ветка CosyVoice не является её базой. Из неё перенесены
проверенные части безопасного потокового транспорта с адаптацией под Fish.

## Состав

- `apps/desktop`: Electron, React Spectrum 2, Avatar Runtime с адаптером S22.
- `apps/api`: независимый FastAPI, прежний faster-whisper/Silero ASR и новый Fish TTS.
- `apps/shio-2d`: третий проект, автономная копия S22 и необходимых ресурсов.

Исходник модели `D:\AI-tools\shio-2d` используется только импортёром. Запущенное
приложение не обращается к нему. `provenance.json` содержит пути и SHA-256
исходных и адаптированных файлов. Рисунок и геометрия модели не перерабатывались.
Это нативный S22/PSD2Live runtime из исходного проекта; Cubism SDK не добавлялся.

## Установка и запуск

Windows, Python 3.12 x64, Node 22.12+, NVIDIA CUDA. Проверенный компьютер:
RTX 5090 32 ГБ, PyTorch/torchaudio 2.11.0+cu128. Модель имеет **5B параметров**,
файлы весов занимают около 11 ГБ; это отличается от памяти при исполнении.
В исходном smoke измерялось около 20,35 ГБ занятой GPU-памяти.

```powershell
npm run desktop:install
npm run avatar:install
npm run api:install:dev
npm run api:prefetch
npm run api:voices:sync
npm run api:doctor:strict
npm run api:dev
# В другом терминале:
npm run desktop:dev
```

Обычная установка использует сгенерированные dependency lock-файлы.
Модели, ссылки голосов, кеш компиляции и `.venv` не коммитятся.
`FISH_COMPILE=true` по умолчанию: первая компиляция занимает примерно минуту
после загрузки модели и выполняется при прогреве. `FISH_COMPILE=false` позволяет
диагностировать eager-режим, который на проверенной машине оказался медленнее
реального времени. Сервис объявляет готовность после прогрева.

Зафиксированы:

| Компонент | Репозиторий / revision |
|---|---|
| Fish S2 Pro | `fishaudio/s2-pro` / `1de9996b6be38b745688de084d87a5633f714e4e` |
| Fish Speech | `fishaudio/fish-speech` / `541566932abbaebcb0a40e562a1f846738383f38` |
| audiotools | `descriptinc/audiotools` / `348ebf2034ce24e2a91a553e3171cb00c0c71678` |
| Windows compiler | `triton-windows==3.6.0.post26` |

## Поток и эмоции

HTTP contract — `2.0`; `/tts/stream` — WebSocket protocol `1`.
Сначала `start`, затем монотонные `text` / `delivery`, потом `finish-input`.
Сервер выдаёт `ready`, пары `audio` metadata + бинарный mono Float32 LE PCM
44,1 кГц, затем `complete`. Клиент подтверждает каждый пакет `audio-ack`;
кредитное окно ограничивает очередь. `cancel` доступен также после `finish-input`.
Нормальный Character turn использует одну логическую сессию. Старый `/synthesize`
и F5 удалены. ASR `/recognize`, `/ws/asr`, `/voices` и `/emotions` сохранены.

Штатный upstream streaming выдаёт готовые текстовые сегменты. Адаптер Shio
наблюдает кодовые кадры того же sampler и декодирует префиксы каждые 8 кадров,
удерживая 2 последних кадра кодека. Повторно передаётся только новый PCM-суффикс.
Проверка сигнатуры запрещает молча использовать несовместимый upstream decoder.

`contracts/emotions.v2.json` — единый источник 25 семантических cues.
`npm run emotions:sync` обновляет все три проекта. Каждый cue связывает Fish-теги,
одну из 17 S22-эмоций и её веса. У модели также 19 жестов, 6 форм рта и 2 хвоста.
Raw Fish-теги из произвольного текста не передаются как инструкции провайдеру.
К cue прилагается номер текстового сегмента; лицо и Overlay переключаются
по позиции фактически потреблённого PCM. Разговорная эмоция Character State
не перезаписывается речью. Виземы вычисляются из звучащего сигнала.

AudioPlayer остаётся владельцем воспроизведения. Прерывание синхронно освобождает
локальный буфер и отменяет API-сессию. У upstream нет полноценной отмены inference,
поэтому завершается принадлежащий API процесс Fish. Повторная загрузка занимает
десятки секунд; `/health` честно показывает `loading`, затем `ready`.

## Воспроизводимые проверки

```powershell
npm run desktop:check
npm run desktop:format:check
npm run desktop:imports:check
npm run typecheck
npm run desktop:test:fast
npm run desktop:test:regression
npm run api:lint
npm run api:format:check
npm run api:test
npm run avatar:test
npm run avatar:qualify
npm run build
# При работающем реальном API:
npm run desktop:qualify:speech-2d
```

GPU qualification проверяет все 17 выражений, 19 жестов, формы рта, хвосты,
состояния, WebGL, конечность координат и повторный dispose. Electron qualification
снимает обе темы и Overlay, проводит реальный PCM через Main MessagePort,
AudioPlayer/AudioWorklet и LipSync, проверяет смену cues и синхронную отмену.
Артефакты проверок находятся в игнорируемой `.work`.

Измерено 25 октября 2026 на RTX 5090: прогретый direct engine — первый PCM
0,203 с, 3,95 с речи за 1,66 с; API — 0,234 с, 26 пакетов, 9,24 с речи за
4,34 с. Второй текст поступил уже после первого PCM. Whisper распознал обе
русские фразы полностью. Сравнение префиксов с полным декодированием на тех же
кодах: максимальное численное расхождение < 0,0006, RMS < 0,00004.
Эти измерения относятся к указанной машине и коротким фразам.

## Лицензии и границы эксперимента

Fish S2 Pro распространяется по Fish Audio Research License, ограничивающей
коммерческое использование. См. [model card](https://huggingface.co/fishaudio/s2-pro)
и [исходный LICENSE](https://github.com/fishaudio/fish-speech/blob/541566932abbaebcb0a40e562a1f846738383f38/LICENSE).
Модель не включается в Git и этот эксперимент не является публикацией релиза.
Для PSD2Live сохранены MIT license и notices внутри `apps/shio-2d`.
Качество эмоциональной интонации зависит от референса и языка; наличие тега
не гарантирует одинаковую силу эмоции во всех голосах. Полная субъективная
оценка всех голосов, длительная эксплуатация и чистая установка на другом
компьютере требуют отдельной квалификации.
