# Реальное A/B Core8 и обычной SOMA

## Architecture Review

Основание: ARCHITECTURE.md, «Core8 versus SOMA live qualification», planned 27 October 2026. Пользователь явно запросил реальное сравнение на своей VRM вместе с Fish и сохранение рабочей Core8 интеграции. Сравниваются Core8 и обычная SOMA; KimodoRep исключена. Владельцы Main/Avatar/AudioPlayer/ExpressionMixer/Overlay сохраняются.

## Work Items

1. Зафиксировать хеши текущих Core8 source/pins и пользовательской VRM. Подтвердить real Fish readiness; не останавливать существующий API или чужие процессы.
2. Подготовить изолированные Desktop snapshots ниже tmp, отдельные userData и outputs. Core8 snapshot сохраняет исходный runtime. SOMA snapshot получает явный native формат, mapping, support height, bounded native queue/rollback и два секунды model history. Сохранять список всех отличий candidate.
3. Загрузить только точный обычный SOMA checkpoint 244215084b22fcd29ab743017330e87411fe168a, сохраняя существующие source/Core8 assets. Validate shapes, rotations, frame counts и build до live. Не изменять production files для SOMA.
4. Последовательно прогнать одинаковые typed fixtures через существующие Conversation Runtime, настоящие Fish stream, AudioPlayer и Avatar Runtime. Fixture заменяет CharacterResponsePort только в изолированном renderer. Дополнительных OpenRouter запросов нет. Проверить реальный consumed PCM, LipSync, Blink, body/hand phases и Overlay.
5. Базовый набор: presence, greeting, explain_one_palm, shy_gather, fox_paw_single, peace_single, kiss_air_soft; три seeds при физической пригодности. После пригодности расширить до библиотеки, отдельно короткая/длинная речь, transitions и cancellation. Failed cases остаются в отчёте; не ослаблять guards ради прохождения матрицы.
6. Сохранить bounded numeric timing/geometry aggregates, screenshots/видеосвидетельства и честное раздельное заключение по плавности, жестам и задержкам. Raw poses/PCM/credentials не сохранять в diagnostics. Закрыть только owned qualification процессы и подтвердить неизменность исходной Core8 интеграции.

## Проверки

До candidate code выполнена сверка архитектуры и этого плана. Static validation и builds выполняются для изолированных snapshots; production pins и runtime hash сравниваются до и после. Real live квалификация явно разрешена текущим запросом пользователя.

## Ограничения

SOMA ещё не интегрирована в продукт. Нативный горизонт два секунды требует отличающихся queue/rollback bounds; эти различия явно попадут в отчёт и не будут выданы за чистый swap весов. GPU background load записывается; чужие нагрузки не отключаются. При неготовности candidate полноценная матрица отмечается незавершённой, но Core8 baseline и доступные измерения продолжаются.
