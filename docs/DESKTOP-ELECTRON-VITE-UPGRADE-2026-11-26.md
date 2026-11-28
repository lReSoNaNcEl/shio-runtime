# Обновление Electron и Vite в Desktop

## ТЗ

1. В ветке `codex/desktop-companion-v1` обновить Electron с `43.1.1` до `45.5.0`, Vite с `7.3.6` до `8.4.0` и `electron-vite` с `5.0.0` до `6.0.0`.
2. Проверить диапазоны Node.js и совместимость React-плагина, Vitest и макросов React Spectrum 2. Сохранить точки входа main, worker, обоих preload и renderer, а также работу npm-скриптов, вызывающих `esbuild`.
3. Обновить Desktop-манифест и lock-файл поверх текущих изменений в ветке. Проверить Biome, TypeScript, production-сборку и детерминированные тесты. Сопоставить обнаруженные сбои с исходным состоянием ветки.

Vite `8.4.0` опубликован 26 ноября 2026 года и заменил `8.3.8` из первоначального плана. [Electron 45.5.0](https://releases.electronjs.org/release/v45.5.0) · [Vite 8.4.0](https://github.com/vitejs/vite/releases/tag/v8.4.0) · [electron-vite 6.0.0](https://github.com/alex8088/electron-vite/releases/tag/v6.0.0)

## Architecture Review

Обновление инструментов сборки следует инвариантам §3 и §12 `ARCHITECTURE.md`. Electron Main, preload и renderer сохраняют свои роли, а Desktop и Speech API остаются независимыми и взаимодействуют через существующий HTTP-контракт. Проверка совместимости Electron учитывает песочницу preload и изоляцию контекстов.

## Что изменено

- Три целевые версии зафиксированы в `apps/desktop/package.json` и `apps/desktop/package-lock.json`. `esbuild` `0.28.2` стал прямой dev-зависимостью. Существующие скрипты квалификации и бенчмарков вызывают его CLI, а Vite 8 объявляет его опциональным.
- `apps/desktop/electron.vite.config.ts` использует `rolldownOptions` и штатное исключение внешних зависимостей в `electron-vite`. Сохранены точки входа main, worker, обоих preload и renderer. Макросы Spectrum 2 по-прежнему выполняются перед React-преобразованиями.
- `apps/desktop/vitest.config.mts` задаёт автоматический JSX через Oxc и загружается в формате ESM. `apps/desktop/tsconfig.test.json` включает конфигурацию по новому пути.

## Root Cause

N/A. Задача обновляет зависимости.

## Почему фикс работает

`electron-vite` `6.0.0`, Vitest `4.1.11` и `@vitejs/plugin-react` `5.2.0` объявляют поддержку Vite 8. Чистая установка разрешает для всех трёх один экземпляр Vite `8.4.0`. Сборка выдаёт ожидаемые CommonJS-файлы main и worker. Оба собранных preload зарегистрировали свои API при проверке в Node VM с доступом только к заглушкам Electron и стандартным глобальным объектам JavaScript.

## Проверки

- В изолированной копии на Windows с Node.js `24.22.3` прошли `npm ci`, `npm ls`, `npm run typecheck`, `npm run build` и `npm run desktop:imports:check`. Проверка production-сборки подтвердила локальный PCM AudioWorklet под существующей CSP. Отдельная проверка Vite подтвердила преобразование renderer в режиме разработки и обработку макроса Spectrum 2.
- Biome прошёл для изменённых конфигураций. `desktop:check` и `desktop:format:check` на всей рабочей копии выявили существующие проблемы с форматированием и type-импортами. Те же проблемы воспроизвелись с исходными зависимостями.
- В итоговом прогоне `desktop:test:regression -- --maxWorkers=4` прошли 1074 из 1077 тестов. `layout-contracts.test.ts` упал на селекторе предпросмотра и воспроизвёлся на исходном Vite 7. Два теста Browser Control, упавшие в полном прогоне, прошли в отдельном последовательном прогоне с Vite 8.4.0.
- SHA-256 Windows-архива Electron `45.5.0` совпал с контрольной суммой из пакета. Установка бинарника в проверочную копию прошла.

## Ограничения

Live-проверка Electron не запрашивалась и не проводилась. Установка для проверок выполнена в отдельной копии, чтобы сохранить работающий экземпляр Shio и его локальные зависимости.
