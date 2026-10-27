# Исторический аудит миграции VRMA → ARDY / Fish

Дата: 26 октября 2026. База: `39310f0d7a17616c30e2becdeeda845670353320`.

До миграции: **39** VRMA и **39** записей manifest. После реальной ARDY/VRM
пробы и совместного Electron playback все 39 ресурсов удалены из рабочей
ветки. До commit `git ls-files '*.vrma'` ещё перечисляет не закоммиченные
удаления; проверка существующих файлов отдельно подтверждает ноль ресурсов.
Актуальный каталог — `contracts/motion.v1.json`, 28 semantic profiles; число 39
ниже относится к прежним ресурсам VRMA, а не к текущему каталогу.
Таблица сохраняет прежние назначения и служит картой покрытия, а не каталогом
физических клипов. Старые пояснения про jaw относятся только к удалённым VRMA.

| Файл | Manifest ID | Назначение | Предлагаемый semantic intent | Проверяемое поведение |
| --- | --- | --- | --- | --- |
| neutral_idle.vrma | neutral_idle | idle; idle | rest/listening | Calm neutral standing idle (idle variety). |
| neutral2.vrma | neutral2 | idle; speaking, idle | rest/listening | Neutral body motion, subtle presence (idle and speaking variety). |
| neutral4.vrma | neutral4 | idle; speaking, idle | rest/listening | Neutral body motion, quiet idle and speaking variant. |
| breathing_idle.vrma | breathing_idle | idle; idle | rest/listening | Calm breathing loop for the character’s baseline idle presence; excluded from Portrait camera. |
| afk_sway_01.vrma | idle_presence_sway_01 | idlePresence; extendedIdle | extended-rest | Extended idle sway for long quiet moments. |
| afk_sway_02.vrma | idle_presence_sway_02 | idlePresence; extendedIdle | extended-rest | Alternate extended idle sway for long quiet moments. |
| afk_swing_01.vrma | idle_presence_swing_01 | idlePresence; extendedIdle | extended-rest | Extended idle swing motion for sustained inactivity. |
| afk_swing_02.vrma | afk_swing_02 | idlePresence; extendedIdle | extended-rest | Compact extended idle swing motion for sustained inactivity. |
| afk_dance_01.vrma | idle_presence_dance_01 | idlePresence; extendedIdle | extended-rest | Playful long-idle dance motion for rare quiet stretches. |
| happy_idle.vrma | happy_idle | idlePresence; extendedIdle | extended-rest | Warm, positive idle-presence loop for rare extended quiet moments. |
| yawn.vrma | yawn | idlePresence; extendedIdle | extended-rest | Rare sleepy yawn one-shot for a sustained AFK period; returns to normal idle. |
| action_greeting.vrma | action_greeting | greeting; speaking | greeting | Greeting gesture. |
| action_greeting1.vrma | action_greeting1 | greeting; speaking | greeting | Alternate greeting gesture. |
| approval.vrma | approval | positive; reaction | joy/support/agreement | Approving, agreeable reaction motion. Not safe for ordinary speaking because the clip keys the jaw bone. |
| admiration.vrma | admiration | positive; reaction | joy/support/agreement | Admiring, impressed reaction motion. Not safe for ordinary conversational speech. |
| thankful.vrma | thankful | positive; reaction | joy/support/agreement | A short thankful or appreciative gesture expressing gratitude, warm acknowledgment, or gentle appreciation. |
| caring.vrma | caring | positive; reaction | joy/support/agreement | Warm, caring reaction motion. Not safe for ordinary conversational speech. |
| amusement.vrma | amusement | positive; speaking | joy/support/agreement | Amused, light-hearted motion. |
| thoughtful_head_nod.vrma | thoughtful_head_nod | thinking; reaction | reflection/question | Measured contemplative nod for thinking or the transition into speech. |
| curiosity.vrma | curiosity | thinking; manual | reflection/question | Curious, attentive thinking/listening motion. |
| confusion.vrma | confusion | thinking; reaction | reflection/question | Puzzled, uncertain reaction motion. Not safe for ordinary conversational speech. |
| confusion2.vrma | confusion2 | thinking; speaking | reflection/question | Puzzled thinking/speaking motion. |
| annoyance.vrma | annoyance | negative; speaking | disagreement/reaction | Annoyed, irritated motion. |
| anger2.vrma | anger2 | negative; speaking | disagreement/reaction | Alternate angry motion. |
| disapproval.vrma | disapproval | negative; speaking | disagreement/reaction | Disapproving, dejected motion. |
| disgust.vrma | disgust | negative; speaking | disagreement/reaction | Disgusted, recoiling motion. |
| embarrassment.vrma | embarrassment | embarrassed; speaking | embarrassment | Embarrassed, flustered motion. |
| arm_stretching.vrma | arm_stretching | idlePresence; extendedIdle | extended-rest | A gentle arm-stretching extended-idle motion with self-embracing arm movement and subtle side-to-side head turns. |
| bored_restless.vrma | bored_restless | idlePresence; extendedIdle | extended-rest | Rare restless idle variation for extended quiet moments. |
| sit_idle2.vrma | sit_idle2 | sitting; manual | seated-rest | Seated idle. |
| sit_idle3.vrma | sit_idle3 | sitting; manual | seated-rest | Alternate seated idle. |
| acknowledge.vrma | acknowledge | interaction; reaction | explicit-action | Brief acknowledgment nod for manual preview until a structured acknowledgment trigger exists. |
| blow_kiss.vrma | blow_kiss | interaction; manual | explicit-action | Warm, playful air-kiss gesture. Manual preview only until a structured affectionate trigger exists. |
| finger_gun.vrma | finger_gun | interaction; manual | explicit-action | Cheeky finger-gun reaction. Manual preview only until a structured playful trigger exists. |
| victory_fingers.vrma | victory_fingers | interaction; speaking | explicit-action | Celebratory victory-fingers reaction. Manual preview only until a structured success trigger exists. |
| salute.vrma | salute | optional; manual | explicit-full-body-action | A short salute gesture where the character raises one hand to her head and returns to neutral. |
| celebratory_dance.vrma | celebratory_dance | optional; manual | explicit-full-body-action | A short energetic celebratory dance with active head and arm movement and several small jumps. |
| dance_pushback.vrma | dance_pushback | optional; manual | explicit-full-body-action | Playful dance / pushback flourish. |
| tiptoe_peek.vrma | tiptoe_peek | interaction; manual | explicit-action | A curious tiptoe motion where the character rises slightly, lifts her head and hands, and appears to peek over something. |

## Замена владельцев и потребителей

- `animationManifest.ts`: проекция генерируемого semantic catalog; glob/URL загрузки удалены, selection constraints и cooldowns сохранены.
- `AvatarAnimationController`, `AvatarBehaviorEngine`, `AvatarBehaviorResolver`, `AvatarAnimationCooldownManager`, `AvatarPlaybackCoordinator`, `OverlayAnimationPolicy`: выбор, playback, переходы и Overlay.
- `VrmBodyPlayback`, `AvatarAnimationLoader`, `RootMotionController` и `@pixiv/three-vrm-animation` удалены. Main `ArdyMotionService` владеет процессом; `GeneratedBodyPlayback` принимает проверенные Core27 chunks и ретаргетит только body.
- VRMA file picker/read IPC и preload удалены; motion start/next/stop/status/reroll проходят sender authorization, strict payload schemas и canonical inventory.
- `AvatarPreviewView.tsx`: реальная генерация и reroll, source/seed/queue/inference/error, RU/EN Spectrum UI. Runtime Health показывает независимое owned motion state.
- Tests, `electron.vite.config.ts`, Electron packaging и asset inventory должны проверяться отдельно от исходного каталога.

## Исторический список F5 consumers до миграции

```text
apps/api/.env.example
apps/api/.env.release
apps/api/README.md
apps/api/app/__init__.py
apps/api/app/config.py
apps/api/app/main.py
apps/api/app/routes/health.py
apps/api/app/routes/synthesize.py
apps/api/app/tts/f5_local.py
apps/api/app/tts/voice_registry.py
apps/api/requirements-dev.lock.txt
apps/api/requirements.lock.txt
apps/api/requirements.txt
apps/api/scripts/doctor_strict.py
apps/api/scripts/prefetch_models.py
apps/api/tests/test_release_health.py
apps/api/tests/test_speech_polish_synthesize.py
apps/api/tests/test_voice_dataset_revision.py
apps/api/tests/test_voice_warmup.py
apps/api/voice_manifest.json
apps/api/web/index.html
apps/desktop/.env.example
apps/desktop/package-lock.json
apps/desktop/src/main/app/SpeechApplicationService.ts
apps/desktop/src/main/config.ts
apps/desktop/src/main/orchestrator.ts
apps/desktop/src/main/schemas.ts
apps/desktop/src/main/speech/speechClient.ts
apps/desktop/src/renderer/Controller.ts
apps/desktop/src/renderer/avatar/embodiment/speech/LipSyncVariationController.ts
apps/desktop/src/renderer/components/settings/state/useSettingsDialogState.ts
apps/desktop/src/renderer/styles/chat.css
apps/desktop/tests/integration/project-evidence.test.ts
apps/desktop/tests/integration/speech-reliability.test.ts
apps/desktop/tests/support/browser/BrowserControlScenarios.ts
launcher/ShioLauncher.ps1
launcher/release-manifest.json
scripts/check-alpha-release-integrity.ps1
```

## Выполненная очистка

27.10.2026 выполнена дополнительная очистка потребителей ARDY: queue terminal
outcomes, fallback speech binding, applied-profile Overlay HUD, generated-motion
diagnostics и удаление неработающих clip policies. Подробности, RCA и итоговые
проверки: [ANIMATION-LEGACY-CLEANUP.md](ANIMATION-LEGACY-CLEANUP.md). Исторический
инвентарь VRMA выше не является текущим semantic catalog.

F5 engine/routes/configuration/dependencies, два synthesis workers и WAV reorder
buffer удалены. Используется одна логическая Fish session с реальным incremental
PCM. Активные инструкции установки, API/web и launcher используют Fish и
отдельный ARDY env. Исторические release notes не переписывались.

`npm run experiment:legacy-check` проверяет отсутствие ресурсов/старых execution
paths/dependencies, единый catalog и отдельный emitted AudioWorklet. Упаковка
и `experiment:verify-package` дополнительно проверяют чистый дистрибутив.
Оставшиеся `.vrma` строки в source filter и pronunciation dictionary описывают
пользовательские файлы и технический термин; не являются runtime loader.

## Live evidence и ограничения

26.10.2026: ARDY retargeting проверен на настоящей VRM; исправлены VRM0 оси,
stationary root/контакт стоп и камера по фактическим bounds/head. Joint report
`apps/desktop/motion/.artifacts/joint-2026-10-26T08-24-05-550Z/report.json`:
1800,578 секунды, 32 ответа, три cancel, Overlay, без ошибок runner.
Лицо/глаза/моргание/LipSync наблюдались во время реальной речи.
Core27 не генерирует отдельные пальцы. Все 39 semantic profiles доступны,
но один успешный диалог не доказывает визуальное качество каждого manual intent.
Остальная матрица и окончательная упаковочная проверка учитываются отдельно.
