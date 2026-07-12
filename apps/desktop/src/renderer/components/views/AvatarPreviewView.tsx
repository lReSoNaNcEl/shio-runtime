import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionButton, Badge, Button, Content, ContextualHelp, Heading, ProgressCircle, SearchField, Tooltip, TooltipTrigger } from '@react-spectrum/s2'
import RotateCCW from '@react-spectrum/s2/icons/RotateCCW'
import { controller } from '../../Controller'
import { getAnimationTitle, getGroupedAnimations, isAnimationAutomaticallySelectable } from '../../avatar/animationManifest'
import type { AnimationManifestEntry } from '../../avatar/animationManifest'

type Phase = 'closed' | 'loading' | 'ready' | 'error'

function cameraLabel(entry: AnimationManifestEntry): string | null {
  if (!entry.compatibleCameraModes || entry.compatibleCameraModes.length === 0) return null
  return entry.compatibleCameraModes
    .map((mode) => mode.charAt(0).toUpperCase() + mode.slice(1))
    .join('/')
}

export function AvatarPreviewView({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mountedRef = useRef(true)
  const [phase, setPhase] = useState<Phase>('loading')
  const [hasModel, setHasModel] = useState<boolean | null>(null)
  const groups = useMemo(() => getGroupedAnimations(), [])
  const [animationId, setAnimationId] = useState('')
  const [query, setQuery] = useState('')

  const selectedAnimation = useMemo(
    () => groups.flatMap((group) => group.animations).find((animation) => animation.id === animationId),
    [groups, animationId]
  )

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return groups
      .map((group) => ({
        ...group,
        animations: needle
          ? group.animations.filter((animation) =>
              getAnimationTitle(animation).toLowerCase().includes(needle) ||
              animation.id.toLowerCase().includes(needle) ||
              animation.file.toLowerCase().includes(needle))
          : group.animations
      }))
      .filter((group) => group.animations.length > 0)
  }, [groups, query])

  // Open the preview automatically on entering the Avatar tab, and tear the
  // renderer down on leaving so the process is not kept alive in the background.
  useEffect(() => {
    let cancelled = false
    void window.api.config.get().then((cfg) => {
      if (cancelled) return
      const has = Boolean(cfg.vrmPath)
      setHasModel(has)
      if (has) void open()
    })
    return () => { cancelled = true; mountedRef.current = false; controller.detachCanvas() }
  }, [])

  async function open(): Promise<void> {
    if (!canvasRef.current) return
    setPhase('loading')
    try {
      await controller.attachCanvas(canvasRef.current)
      // The preview may have unmounted (tab left) while the load was in flight;
      // never move a torn-down preview into ready/error.
      if (!mountedRef.current) return
      setPhase(controller.getState().vrmLoaded ? 'ready' : 'error')
    } catch { if (mountedRef.current) setPhase('error') }
  }

  const ready = phase === 'ready'

  if (hasModel === false) return <section className="empty-state"><h2>Аватар ещё не настроен</h2><p>Выберите модель, чтобы открыть Avatar Preview.</p><Button variant="accent" onPress={onOpenSettings}>Открыть настройки Avatar</Button></section>

  return <section className="avatar-preview-view">
    {!ready && <div className="preview-loader">
      {phase !== 'error'
        ? <><ProgressCircle aria-label="Загрузка предпросмотра" isIndeterminate size="L" /><p className="preview-loader-title">Загружаем предпросмотр</p><p className="preview-loader-hint">Готовим модель и библиотеку анимаций…</p></>
        : <><p className="preview-loader-title">Не удалось загрузить модель</p><Button variant="secondary" onPress={() => void open()}>Повторить</Button></>}
    </div>}

    <div className={ready ? 'avatar-preview-workspace' : 'avatar-preview-workspace collapsed'}>
      {ready && <aside className="animation-library">
        <div className="animation-library-header">
          <div className="animation-library-title">
            <strong>Animation Library</strong>
            <ContextualHelp variant="info" size="S" aria-label="Что означают теги анимаций">
              <Heading>Теги анимаций</Heading>
              <Content>
                <dl className="animation-tags-help">
                  <div><dt>Loop</dt><dd>Клип зациклен и играет непрерывно, пока не остановить или не сменить.</dd></div>
                  <div><dt>One-shot</dt><dd>Разовое проигрывание: клип отыгрывается один раз и завершается.</dd></div>
                  <div><dt>Front / Bust / Face / Portrait</dt><dd>Ракурсы камеры, для которых клип выглядит корректно.</dd></div>
                  <div><dt>Нет бейджа камеры</dt><dd>Клип не имеет ограничений по ракурсу.</dd></div>
                  <div><dt>Auto</dt><dd>Runtime может автоматически выбрать клип в подходящем состоянии и контексте.</dd></div>
                  <div><dt>Manual</dt><dd>Клип доступен только для ручного запуска в Preview.</dd></div>
                </dl>
              </Content>
            </ContextualHelp>
          </div>
          <SearchField aria-label="Поиск анимаций" value={query} onChange={setQuery} placeholder="Имя, ID или файл…" size="S" />
        </div>
        <div className="animation-library-list">
          {filteredGroups.length === 0 && <p className="animation-library-empty">Ничего не найдено.</p>}
          {filteredGroups.map((group) => (
            <div key={group.category} className="animation-library-group">
              <div className="animation-library-category">{group.label}</div>
              {group.animations.map((animation) => (
                <button
                  key={animation.id}
                  type="button"
                  className={`animation-row${animation.id === animationId ? ' active' : ''}`}
                  aria-pressed={animation.id === animationId}
                  onClick={() => { setAnimationId(animation.id); controller.previewAvatarAnimation(animation.id) }}
                >
                  <span className="animation-row-title">{getAnimationTitle(animation)}</span>
                  <span className="animation-row-file">{animation.file}</span>
                  <span className="animation-row-badges">
                    <Badge size="S" variant={animation.loop ? 'informative' : 'neutral'}>{animation.loop ? 'Loop' : 'One-shot'}</Badge>
                    {cameraLabel(animation) && <Badge size="S" variant="gray">{cameraLabel(animation)}</Badge>}
                    <Badge size="S" variant={isAnimationAutomaticallySelectable(animation) ? 'positive' : 'neutral'}>{isAnimationAutomaticallySelectable(animation) ? 'Auto' : 'Manual'}</Badge>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>}

      <div className="preview-viewport">
        <div className={ready ? 'avatar-preview-stage' : 'avatar-preview-stage collapsed'}>
          {ready && <div className="preview-camera-toolbar">
            <Button variant="secondary" onPress={() => controller.previewCameraPreset('full')}>Full</Button>
            <Button variant="secondary" onPress={() => controller.previewCameraPreset('bust')}>Bust</Button>
            <Button variant="secondary" onPress={() => controller.previewCameraPreset('face')}>Face</Button>
            <TooltipTrigger delay={200}>
              <ActionButton aria-label="Вернуть вид спереди" onPress={() => controller.resetPreviewCamera()}><RotateCCW /></ActionButton>
              <Tooltip>Вернуть вид спереди</Tooltip>
            </TooltipTrigger>
          </div>}
          <canvas ref={canvasRef} className={ready || phase === 'loading' ? 'avatar-preview-canvas visible' : 'avatar-preview-canvas'} />
        </div>

        {ready && <div className="preview-playback">
          <span className="settings-hint">Локальный preview: не публикуется в Overlay.</span>
          {selectedAnimation
            ? <p className="preview-animation-summary">{getAnimationTitle(selectedAnimation)} · {groups.find((group) => group.category === selectedAnimation.category)?.label ?? selectedAnimation.category} · {selectedAnimation.loop ? 'Loop' : 'One-shot'} · {selectedAnimation.file}</p>
            : <p className="preview-animation-summary">Выберите анимацию из библиотеки слева.</p>}
          <div className="preview-actions">
            <Button variant="accent" isDisabled={!animationId} onPress={() => controller.previewAvatarAnimation(animationId)}>Play</Button>
            <Button variant="secondary" isDisabled={!animationId} onPress={() => controller.previewAvatarAnimation(animationId)}>Replay</Button>
            <Button variant="secondary" onPress={() => controller.stopAnimation()}>Stop</Button>
            <Button variant="secondary" onPress={() => controller.previewAvatarMode('idle')}>Вернуть в Idle</Button>
          </div>
          <div className="preview-actions preview-actions-secondary">
            <Button variant="secondary" onPress={() => void open()}>Reload Model</Button>
          </div>
          {selectedAnimation && <details className="preview-animation-details">
            <summary>Подробности</summary>
            <dl className="preview-animation-meta">
              <div><dt>ID</dt><dd>{selectedAnimation.id}</dd></div>
              <div><dt>Файл</dt><dd>{selectedAnimation.file}</dd></div>
              <div><dt>Категория</dt><dd>{groups.find((group) => group.category === selectedAnimation.category)?.label ?? selectedAnimation.category}</dd></div>
              <div><dt>Loop</dt><dd>{selectedAnimation.loop ? 'Да' : 'Нет'}</dd></div>
              <div><dt>Camera</dt><dd>{cameraLabel(selectedAnimation) ?? 'Без ограничений'}</dd></div>
              <div><dt>Выбор</dt><dd>{isAnimationAutomaticallySelectable(selectedAnimation) ? 'Автоматический' : 'Только вручную'}</dd></div>
              <div><dt>Описание</dt><dd>{selectedAnimation.description}</dd></div>
            </dl>
          </details>}
        </div>}
      </div>
    </div>
  </section>
}
