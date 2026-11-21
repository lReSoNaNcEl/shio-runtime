# FlashMotion в Shio. Первый офлайн-прогон

21 ноября 2026 года, ветка `codex/flashmotion-living-v1`. Реальные одношаговые
T2M и S2G работают на RTX 5090 через WSL2. Оба режима показаны на VRM0 и VRM1.
Полная замена движка остаётся открытой. Выпуск и обучение
не входят в эксперимент. [Техническое задание](EXPERIMENT-FLASHMOTION-LIVING-V1.md)

## Architecture Review

Код прогона находится в `apps/desktop/qualifications/flashmotion`. Захват использует
существующий Speech API HTTP 2.1 и WebSocket `/tts/stream` v2. Экземпляр Fish
оставался прогретым. Проигрывание сохранённого тестового PCM и показ сгенерированной
позы выполняются отдельно от приложения. В Desktop владение процессом принадлежит
Electron Main, временем воспроизведения — AudioPlayer, телом — Avatar Runtime, лицом —
AvatarExpressionMixer. FlashMotion ещё не подключён к этим владельцам. Overlay и
Preview приложения не участвовали в офлайн-прогоне.

## Что изменено

- Подготовка сверяет ревизию FlashMotion `bed5510b8770762f6df780bf152725d4c49c0f49`,
  ревизию весов `fcf613fa1742b1655c7299e10de8c8dfc332a8c6` и SHA-256 файлов.
- T2M получил два описания из каталога прогона, новые 4096-мерные признаки UMT5
  и по 60 кадров HumanML3D 263D на намерение при 20 FPS. Опциональный кеш
  содержит признаки и их идентичность. Оба движения сгенерированы на месте,
  seed 42, epoch 7150, один шаг.
- S2G получил четыре свежих реплики Fish. Копии моно PCM 44,1 кГц переведены
  в 16 кГц. Русский XLSR-53 и английская CTC-голова HuBERT нашли интервалы слов,
  записанные в исходных сэмплах. Для русских фиксированных реплик использована
  ручная таблица соответствий английскому словарю BEAT2. Паузы используют
  индекс 0, слова вне словаря — индекс 3. Настоящий HuBERT дал 1024 признака на
  кадр, словарь — 300. Выход Full55 включает 55 локальных вращений и три
  компонента корня, 30 FPS, seed 42, speaker condition 2, epoch 3200, один шаг.
- Проверка WSL закрыла stdin отдельного Windows-процесса с активным CUDA-циклом
  и отдельно завершила сам `wsl.exe`. Linux-процесс с проверенным идентификатором
  исчез в пределах 109 и 93 мс соответственно.
- Повторный просмотр использует штатные функции измерения опоры, ограничения
  высоты корня и аналитического решения двух костей ноги. Флаг `--plant-feet`
  сравнивает на тех же кадрах перенос позы с действующим для стоячих профилей
  ограничением опоры.

## Root Cause

Старая регистрация `FoxSinnerAI` ссылалась на отсутствующий VHDX, поэтому для
опыта импортирован отдельный Ubuntu 24.04 в `tmp/flashmotion/wsl`. Авторский архив
данных S2G был закрыт для текущего аккаунта Hugging Face. Первая реконструкция
нормализатора на Python 3.12 и NumPy 1.26.4 дала другой SHA-256 и была отвергнута.
Повтор на авторских версиях Python 3.10.12, NumPy 1.23.5 и SciPy 1.15.3 из тех же
1093 обучающих клипов BEAT2 дал точное совпадение
`cc65a7737f6ef09a727987ca73cde8cb320c66b16645d5bc0579ffd57fbe2e28`.
[Окружение релиза](https://github.com/Sun-Happy-YKX/FlashMotion-release/blob/bed5510b8770762f6df780bf152725d4c49c0f49/docs/environment.md)

## Почему стенд работает

Нормализатор S2G годится после проверки байтов, а T2M использует параметры
нормализации и EMA непосредственно из проверенного чекпойнта. Нативные
расширения Mamba и causal-conv1d собраны для `sm_120` из проверенных PyPI
архивов. Для S2G восстановлена зафиксированная авторами правка Python-интерфейса
Mamba. Для новых T2M-описаний используется усреднение выходов UMT5-XXL по
токенам с учётом attention mask в BF16 на GPU. Это принятый для стенда способ,
поскольку релиз использует готовый банк признаков и не публикует его процедуру
усреднения. [Описание T2M](https://github.com/Sun-Happy-YKX/FlashMotion-release/blob/bed5510b8770762f6df780bf152725d4c49c0f49/docs/t2m.md)

## Файлы и воспроизведение

Команды выполняются из корня экспериментального worktree. Веса, выходы моделей,
PCM, видео и VHDX находятся в исключённом из Git `tmp/flashmotion`. Исходный
стенд использовал RTX 5090 32 ГБ, драйвер 621.01, WSL 2.7.11.0 и ядро
6.18.33.2-microsoft-standard-WSL2. Скачанные три части UMT5 занимают около 30 ГБ.

Для нового стенда импортировать Ubuntu 24.04 только в отдельный дистрибутив.
Использованный образ `ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz` имел SHA-256
`8251e27ffff381a4af5f41dcb94d867de3e0d9774a9241908ab34555d99315ea`.
Образ и актуальный список контрольных сумм публикует Ubuntu.
[Ubuntu WSL Noble](https://cloud-images.ubuntu.com/wsl/releases/noble/current/)

```powershell
python -B apps/desktop/qualifications/flashmotion/assets.py tmp/flashmotion --include-umt5 --include-s2g-inputs
wsl --import ShioFlashMotionV1 tmp/flashmotion/wsl tmp/flashmotion/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz --version 2
wsl -d ShioFlashMotionV1
```

Внутри нового WSL использовать официальный репозиторий NVIDIA для WSL.
Для компиляции достаточно CUDA Toolkit и заголовков. Используется драйвер
Windows. [Установка CUDA в WSL](https://docs.nvidia.com/cuda/wsl-user-guide/index.html)

```bash
curl -fLsS -o /opt/cuda-keyring_1.1-1_all.deb https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/cuda-keyring_1.1-1_all.deb
dpkg -i /opt/cuda-keyring_1.1-1_all.deb
apt-get update
apt-get install -y --no-install-recommends python3.12-venv python3.12-dev build-essential ninja-build cuda-nvcc-12-8 cuda-cudart-dev-12-8
python3.12 -m venv /opt/shio-flashmotion
P=/opt/shio-flashmotion/bin/python
$P -m pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128
$P -m pip install numpy==1.26.4 scipy==1.15.3 einops==0.8.1 transformers==4.57.0 sentencepiece==0.2.1 wheel==0.45.1 uv==0.10.12
$P -B apps/desktop/qualifications/flashmotion/build_cuda.py tmp/flashmotion /opt/flashmotion-kernel-build
export UV_PYTHON_INSTALL_DIR=/opt/flashmotion-python UV_CACHE_DIR=/opt/flashmotion-uv-cache
UV=/opt/shio-flashmotion/bin/uv
$UV python install 3.10.12
$UV venv --python 3.10.12 /opt/flashmotion-stats
$UV pip install --python /opt/flashmotion-stats/bin/python numpy==1.23.5 scipy==1.15.3
OPENBLAS_CORETYPE=Haswell OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 \
  /opt/flashmotion-stats/bin/python -B apps/desktop/qualifications/flashmotion/rebuild_s2g_stats.py tmp/flashmotion \
  --output tmp/flashmotion/reconstructed-stats-full55-reference-python.npz
```

Зафиксированный Transformers 4.57.0 был помечен PyPI как yanked из-за ошибки установки.
На этом стенде пакет установился и отработал. Репозиторий сохраняет версию авторов
для воспроизводимости данного опыта. [Сведения о релизе](https://pypi.org/project/transformers/4.57.0/)

```powershell
$q = 'apps/desktop/qualifications/flashmotion'
$v = '/opt/shio-flashmotion/bin/python'
node "$q/capture-fish.cjs" tmp/flashmotion/fish-new
wsl -d ShioFlashMotionV1 --exec $v -B "$q/t2m.py" tmp/flashmotion tmp/flashmotion/t2m-new --runs 8 --text-cache tmp/flashmotion/t2m-embeddings.npz
wsl -d ShioFlashMotionV1 --exec $v -B "$q/s2g.py" tmp/flashmotion tmp/flashmotion/fish-new tmp/flashmotion/s2g-new --stats tmp/flashmotion/reconstructed-stats-full55-reference-python.npz --runs 8
node "$q/preview.cjs" tmp/flashmotion/t2m-new/wave-right.json tmp/flashmotion/vrm-new apps/desktop/src/renderer/assets/vrm/green_fox.vrm --plant-feet
python -B "$q/wsl_lifecycle.py" ShioFlashMotionV1 $v
```

| Источник | Лицензия и доступ |
| --- | --- |
| [Код FlashMotion](https://github.com/Sun-Happy-YKX/FlashMotion-release/blob/bed5510b8770762f6df780bf152725d4c49c0f49/LICENSE) | MIT для оригинального кода. |
| [Веса FlashMotion](https://huggingface.co/yangkaixing/FlashMotion-models/tree/fcf613fa1742b1655c7299e10de8c8dfc332a8c6) | Публичные файлы. На карточке нет отдельной декларации лицензии весов. |
| [UMT5-XXL](https://huggingface.co/google/umt5-xxl), [HuBERT](https://huggingface.co/facebook/hubert-large-ls960-ft), [русский XLSR-53](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-russian) | Apache-2.0 по карточкам. |
| [BEAT2](https://huggingface.co/datasets/haiyangliu0/BEAT2), [BEAT2 Tools](https://huggingface.co/datasets/haiyangliu0/BEAT2_Tools) | Apache-2.0 по карточкам. С этих страниц использованы обучающие позы, заголовки WAV и словарь. |
| [SMPL-X](https://smpl-x.is.tue.mpg.de/modellicense.html) | Лицензия поставщика и доступ по регистрации. Нейтральная модель с исходной позой кистей для этого прогона не загружалась. |
| [VRM1 Constraint Twist Sample](https://github.com/pixiv/three-vrm/blob/ff42fae4fcee1fcbca2cd262c7f5f8cbddeaf5ab/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm) | VRM Public License 1.0 по metadata модели. |

## Проверки

Сборка Desktop, typecheck, Biome с 10 существующими предупреждениями, формат,
импорты, 389 быстрых и 892 полных детерминированных теста прошли. Пять тестов
стенда проверили SHA-256, структуру WAV, перевод индексов в исходные сэмплы
и обработку пауз и неизвестных слов.

| Замер | Наблюдение |
| --- | --- |
| T2M | Загрузка энкодера + признаки 46,2–60,4 с, пик выделенной памяти 10,6 ГиБ. Декодер загрузился за 1,41 с, первый расчёт 60 кадров занял 8,95 с. Прогретые 22–51 мс, медианы 27,09 и 30,55 мс. Пик выделенной памяти декодера 278 МиБ. |
| S2G | Первый расчёт 70 кадров после загрузки декодера занял 2,76 с. Генерация из готовых признаков после первого вызова занимала 21–55 мс для 70–399 кадров. Пик выделенной памяти декодера 285 МиБ. Выделенная память признаков доходила до 1,43 ГиБ при последовательной загрузке распознавателя и HuBERT. |
| Fish | Повторный захват четырёх фраз дал первый пакет PCM через 231–372 мс. Прогретое состояние Fish проверено до и после запусков. |
| Отмена Fish | Протокол выдал ранний PCM до `finish-input` и подтвердил отмену за 610 мс. Прогрев нового процесса превысил 120-секундный бюджет отдельной проверки. После тайм-аута сервис вернулся в `ready` и синтезировал все четыре новые реплики. |
| S2G и слова | Короткая русская реплика 5/5 слов в словаре, пауза и незнакомое слово 9/11, длинная 28/28, английская 10/10. Самый длинный интервал между словами в тесте с паузой — 900 мс по CTC. |
| VRM0 | Правое запястье в приветствии поднялось на 39,3 см, левое — на 1,25 см по диапазону высот, приведённых к 1,65 м. Максимальный горизонтальный сдвиг стопы от первого кадра составил 1,28 см в ожидании, 1,96 см в приветствии, и 19,9 см в диагностическом S2G без решателя опоры. |
| VRM1 | Диапазон правого запястья 49,0 см против 1,54 см у левого. Максимальный сдвиг стопы 2,02 см. |
| Штатный решатель опоры | Максимальный трёхмерный сдвиг от первого кадра при росте 1,65 м меньше 0,01 см для T2M на обеих моделях. Для короткой S2G — 0,327 см на VRM0 и 0,442 см на VRM1. Приветствие сохранило диапазон правого запястья 39,35 и 49,01 см соответственно. |

Офлайн-замеры получены с прогретым Fish в соседнем процессе. Они не охватывают
PCM-курсора AudioPlayer, IPC, получение входного окна, непрерывное покрытие или
рисование 60 FPS. Память относится к пику аллокатора PyTorch соответствующего шага.
Отчёты генерации `t2m-run-2/report.json` и `s2g-run-1/report.json` находятся под
`tmp/flashmotion`. Там же есть видео с действующим решателем опоры
`t2m-stand-planted.mp4`, `t2m-wave-planted.mp4`, `t2m-wave-vrm1-planted.mp4`,
`s2g-ru-short-planted.mp4` и `s2g-vrm1-ru-short-planted.mp4`. Видео S2G содержит
исходный PCM Fish.

База сравнения — рабочая демка ветки `experiment/shio-autonomous-living-v1`,
`e01ef809d2ca3ba36de368936699e62483814460` и локальные правки. По состоянию
на момент аудита в демке были изменения кривой перехода и позы размышления,
реакции на живой RMS и сброса захвата, каталога резервной LLM и сетевой
диагностики, а также их тесты. Имеющаяся запись ожидания на green fox длится
25,1 с и даёт 53,58 кадра/с MediaRecorder, запись речи после исправления —
56,10 кадра/с. Отчёт содержит 26,71 мс последней генерации в режиме idle и
ноль опоздавших пакетов на тот момент. Эти числа относятся к съёмке от
30 октября и пока не составляют парного сравнения на 120 с с FlashMotion.
[Отчёт демки](SHIO-LIVING-EXPRESSIVENESS-REPORT-2026-10-30.md)

## Ограничения

- Ручной глоссарий покрывает тестовые реплики. Потоковое выравнивание открытой
  русской речи и работа до завершения фразы требуют отдельного прогона.
- Показ T2M использует направления 22 суставов. У T2M нет выходных каналов
  пальцев. Диагностический показ S2G применяет сырой SMPL-X axis-angle
  без авторского `pose_mean` кистей. Правильность обеих кистей, большой палец,
  открытая ладонь и V требуют калибровки и отдельной проверки. Показ использует
  встроенную модель green fox и контрольную VRM1. Пользовательская VRM отдельно
  не проверена.
- Допуск стопы подтверждён в коротких офлайн-клипах с решателем опоры.
  Непрерывность перехода из фактически показанной позы и на границах
  потоковых окон предстоит проверить в приложении. Штатный контракт движения, Main worker,
  consumed PCM, сроки устаревания, Overlay и Runtime Health ещё не интегрированы.
  MotionBricks и SOMA-X остаются в активной конфигурации до проверки этой
  интеграции. Живой чек Electron после замены и художественная приёмка остаются открытыми.
