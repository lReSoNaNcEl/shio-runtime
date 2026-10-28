# MotionBricks / SOMA-X — лицензии и возможность поставки

Дата проверки: 28 октября 2026. Ненормативный исследовательский отчёт WI10.
Launcher, packaging и release flow в этом эксперименте не изменены.

| Часть | Проверенный источник / условия | Вывод для исследования и поставки |
| --- | --- | --- |
| MotionBricks source | [Apache 2.0, upstream 54fc563](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/LICENSE) | Коммерческое использование исходников допускается с соблюдением лицензии и notices. |
| MotionBricks документация и media | [Upstream license breakdown](https://github.com/NVlabs/motionbricks/tree/54fc563aeaaf819a753d72cc9fdc6713989cdd43#license): CC-BY-4.0 | Отдельная атрибуция при использовании материалов. Source license не покрывает всё содержимое репозитория одинаково. |
| SOMA / G1 ONNX и checkpoints | [NVIDIA Open Model Agreement](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-agreement/), редакция 2 апреля 2026 | Соглашение допускает коммерческое использование и распространение производных моделей. При распространении необходимо соблюдать весь текст соглашения, передавать лицензию, сохранять notices и обозначать изменения. Это отдельные условия от Apache source license. |
| SOMA-X source | [Apache 2.0, upstream 56a3d957](https://github.com/NVlabs/SOMA-X/blob/56a3d957a549c66425b500fddf7f3183bc6fbdff/LICENSE) | Native hand prior не требует включать MANO или SMPL-X. |
| Native SOMA-X model assets | [NVIDIA SOMA-X model card](https://huggingface.co/nvidia/SOMA-X), Apache 2.0; проверен LICENSE snapshot `f81a01796f652260ff930d5318d6c6b845a505ed` | Карточка заявляет коммерческое использование. Для текущего исследования загружены SOMAHand.npz, SOMA_neutral.npz и SOMA_template_rig.usda; в Git они не включаются. |
| MANO / SMPL-X и другие optional backends | [SOMA-X installation / model-file guidance](https://github.com/NVlabs/SOMA-X/tree/56a3d957a549c66425b500fddf7f3183bc6fbdff) | Сторонние модели сохраняют собственные условия. Пользовательские лицензируемые model files не входят в разрешение на native SOMA-X. В этом эксперименте они не загружаются. |
| Bones-derived BVH / G1 CSV примеры | [Sample Data Evaluation License](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/assets/motions/LICENSE.txt), §§1–2 | Только внутреннее тестирование/оценка NVIDIA технологий. Нельзя автоматически включать эти clips или производные sample assets в коммерческую поставку. Используемая стартовая idle-поза прототипа получена из evaluation BVH; эту зависимость необходимо заменить независимо лицензированным источником перед поставкой. |
| TensorRT Python runtime / binaries | [Upstream dependency notice](https://github.com/NVlabs/motionbricks/tree/54fc563aeaaf819a753d72cc9fdc6713989cdd43#license) | Установленные tensorrt-cu12/bindings/libs покрываются TensorRT Software License Agreement; OSS notice не заменяет условия бинарных пакетов. Нынешний эксперимент не добавляет их в дистрибутив Shio. |

Предварительный инженерный вывод: native SOMA-X и MotionBricks модели не имеют
общего запрета коммерческого использования в проверенных лицензиях. Однако
текущий исследовательский checkout нельзя считать готовым коммерческим пакетом:
он включает evaluation-only стартовый material, локальное GPU-окружение и
непроверенные shipping notices. Разрешение модели не распространяется на все
demo assets или optional identity backends. Отдельный packaging Work Item
должен определить состав поставки, источники стартовых поз, notices,
принадлежность пользовательской VRM и условия runtime dependencies.

Техническая готовность, GPU latency и качество анимации не определяются лицензией.
Этот отчёт не выдаёт разрешение на релиз и не меняет архитектурные документы.
