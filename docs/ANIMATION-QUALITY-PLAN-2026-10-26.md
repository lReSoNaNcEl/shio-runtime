# Проверка и исправление качества ARDY → VRM

Запрос: исправить лаги, рывки и артефакты всей библиотеки. Предыдущая проверка трёх профилей по угловым step-метрикам не является приёмкой остальных профилей или геометрии костюма.

## Architecture Review

Работа следует существующему Body Animation Domain и planned rig-calibration correction в `ARCHITECTURE.md`. Main остаётся единственным владельцем ARDY, renderer — ретаргетинга/композиции, AudioPlayer — consumed PCM. Новых Runtime и обходов IPC нет; body не получает facial/head/ear/tail authority.

## Подтверждённый baseline

- Core27 joint order сопоставлен с pinned source. Canonical rotations — world xyzw, Y-up/+Z-forward; VRM0 преобразуется поворотом базиса на π вокруг Y.
- На Green Fox normalized joints верхних рук расположены на X ±0.0862 m. Старый proxy ошибочно использовал их расстояние 0.1724 m как полную ширину торса, его глубина получалась около 5 cm. Это не поверхность груди и костюма.
- Камеры `bust`/`face` дополнительно ограничивали rotations рук прямо в body composer. Наблюдение меняло анимацию.
- Каждый phase replan очищает будущие horizons; это требует отдельного измерения holds и source-cursor continuity. Малый step при остановившемся cursor не доказывает плавность.
- Полный прогон после исправления conditioning обнаружил скачок плеча до 23°: сохранённая local arm pose не остаётся допустимой при движении clavicle/torso. Неограниченная повторная проекция этой позы обходила ограничитель скорости. Проверка непрерывности должна двигать и родителей цепи, а откат — проверять всю затронутую цепь.
- Live runner наследовал пользовательский `vrmPath`: фактически это VRM0 с 51 humanoid bone, SHA-256 `bac0c6eb597e3840241f0d319f7cfeace0621a0b198129aa778fd76aba1a4fac`, а не bundled Green Fox с 54 bones. Прежние подписи модели в live-отчётах неверны. Production-loader regression теперь также запускается явно на выбранной модели; live-отчёт фиксирует hash.
- На выбранной VRM torso half-width 0.2099 m и sleeve radius 0.0761 m. Проверка inflated верхней руки ошибочно запрещала само крепление плеча и уже в исходной «safe» позе поднимала кисть до Y 1.3931 при плече Y 1.3818. Reference калибруется lateral relaxation; медиальный проход верхней руки и весь elbow-to-wrist продолжают проверяться. Проверки «нет пересечений» дополнены проверками низкой исходной кисти, фактического движения и совпадения normalized/raw joints после `humanoid.update()`.
- Standing IK фиксировал стопу и knee hemisphere, но сохранял произвольный axial twist исходной нейронной ноги. Постановка должна определять полную ориентацию по support plane. Wrist candidate вместе с hand-score offset проходит анатомический swing/twist domain до фильтрации; source wrist не может свободно складывать кисть к предплечью.
- Cold conditioning rebuild занял 150 s и превысил прежние 120 s startup timers. Main владеет bounded warming deadline 10 min; renderer начинает фазовый readiness clock после получения lease. Отмена pending startup сохраняется.

## Work Items

1. **Калибровка и геометрия.** Построить regression rig из фактической иерархии VRM, проверить rest pose, обе стороны и известный сгиб локтя; откалибровать torso по полной высоте и bounded skin samples. Проверить передний, боковой и противоположный контакт. Убрать camera-dependent pose clamp. Не менять mesh/weights.
2. **Непрерывность и задержка.** Измерить реальные пропуски horizons, phase readiness и исходный cursor. Исправлять подтверждённые причины; не заменять генерацию замороженной safe pose и не объявлять hold плавным движением. Проверить playback при совместной Fish-нагрузке.
3. **Вся библиотека.** Выполнить реальные previews 28 профилей с фиксированным seed, наблюдать prepare/stroke/hold/recover и возврат, сохранить фактические кадры и bounded metrics. Проверить upper-body intersections и artifact-prone gestures отдельно; более широкая квалификация seed/rig остаётся явной отдельной матрицей.
4. **Финальная проверка.** Biome, TypeScript, build, focused meaningful regressions и live Electron. Отдельно сообщить о стабильности, соответствии жеста описанию и оставшихся дефектах; `qualified` не выставляется автоматически.

План проверен на соответствие указанным архитектурным владельцам. Реализация следует отдельными изменениями кода; этот документ не является второй канонической архитектурой.

## Результат

WI 1–4 реализованы и проверены; полный motion run seed 17 прошёл 28/28, 22 one-shots завершились. Старые некорректные названия модели и слишком узкие выводы исправлены. Художественная квалификация, другие seeds/rigs и общий joint pass не объявлены завершёнными. Совместный тест сохранил явные failures: Cloudflare rate limit и motion phase deadline под Fish. Подробности и границы проверки — в `ANIMATION-QUALITY-RESULT-2026-10-26.md`.
