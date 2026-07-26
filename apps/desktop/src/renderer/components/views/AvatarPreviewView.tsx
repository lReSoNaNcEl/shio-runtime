import {
  ActionButton,
  Badge,
  Button,
  Content,
  ContextualHelp,
  Heading,
  ProgressCircle,
  SearchField,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import RotateCCW from '@react-spectrum/s2/icons/RotateCCW'
import { useEffect, useMemo, useRef, useState } from 'react'

import { type TranslationKey } from '../../../shared/localization'
import {
  type AnimationManifestEntry,
  getAnimationTitle,
  getGroupedAnimations,
  isAnimationAutomaticallySelectable,
} from '../../avatar/animationManifest'
import { controller } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'

type Phase = 'closed' | 'loading' | 'ready' | 'error'

function cameraLabel(entry: AnimationManifestEntry): string | null {
  if (!entry.compatibleCameraModes || entry.compatibleCameraModes.length === 0) return null
  return entry.compatibleCameraModes
    .map((mode) => mode.charAt(0).toUpperCase() + mode.slice(1))
    .join('/')
}

export function AvatarPreviewView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mountedRef = useRef(true)
  const [phase, setPhase] = useState<Phase>('loading')
  const [hasModel, setHasModel] = useState<boolean | null>(null)
  const groups = useMemo(() => getGroupedAnimations(), [])
  const [animationId, setAnimationId] = useState('')
  const [query, setQuery] = useState('')

  const selectedAnimation = useMemo(
    () =>
      groups.flatMap((group) => group.animations).find((animation) => animation.id === animationId),
    [groups, animationId],
  )

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return groups
      .map((group) => ({
        ...group,
        animations: needle
          ? group.animations.filter(
              (animation) =>
                getAnimationTitle(animation).toLowerCase().includes(needle) ||
                animation.id.toLowerCase().includes(needle) ||
                animation.file.toLowerCase().includes(needle),
            )
          : group.animations,
      }))
      .filter((group) => group.animations.length > 0)
  }, [groups, query])

  // Open the preview automatically on entering the Avatar tab, and tear the
  // renderer down on leaving so the process is not kept alive in the background.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount/unmount effect — bootstrap once on mount and tear down on unmount; adding `open` would re-run it and break the once-per-tab-entry lifecycle.
  useEffect(() => {
    let cancelled = false
    void window.api.config.get().then((cfg) => {
      if (cancelled) return
      const has = Boolean(cfg.vrmPath)
      setHasModel(has)
      if (has) void open()
    })
    return () => {
      cancelled = true
      mountedRef.current = false
      controller.detachCanvas()
    }
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
    } catch {
      if (mountedRef.current) setPhase('error')
    }
  }

  const ready = phase === 'ready'
  const categoryLabel = (category: AnimationManifestEntry['category']): string =>
    t(`avatarPreview.category.${category}` as TranslationKey)

  if (hasModel === false)
    return (
      <section className="empty-state">
        <h2>{t('avatarPreview.notConfigured.title')}</h2>
        <p>{t('avatarPreview.notConfigured.description')}</p>
        <Button variant="accent" onPress={onOpenSettings}>
          {t('avatarPreview.openSettings')}
        </Button>
      </section>
    )

  return (
    <section className="avatar-preview-view">
      {!ready && (
        <div className="preview-loader">
          {phase !== 'error' ? (
            <>
              <ProgressCircle aria-label={t('avatarPreview.loading')} isIndeterminate size="L" />
              <p className="preview-loader-title">{t('avatarPreview.loadingTitle')}</p>
              <p className="preview-loader-hint">{t('avatarPreview.loadingHint')}</p>
            </>
          ) : (
            <>
              <p className="preview-loader-title">{t('avatarPreview.loadFailed')}</p>
              <Button variant="secondary" onPress={() => void open()}>
                {t('common.retry')}
              </Button>
              <Button variant="secondary" onPress={onOpenSettings}>
                {t('avatarPreview.openSettings')}
              </Button>
            </>
          )}
        </div>
      )}

      <div className={ready ? 'avatar-preview-workspace' : 'avatar-preview-workspace collapsed'}>
        {ready && (
          <aside className="animation-library">
            <div className="animation-library-header">
              <div className="animation-library-title">
                <strong>{t('avatarPreview.library')}</strong>
                <ContextualHelp variant="info" size="S" aria-label={t('avatarPreview.tagsHelp')}>
                  <Heading>{t('avatarPreview.tagsTitle')}</Heading>
                  <Content>
                    <dl className="animation-tags-help">
                      <div>
                        <dt>Loop</dt>
                        <dd>{t('avatarPreview.tags.loop')}</dd>
                      </div>
                      <div>
                        <dt>One-shot</dt>
                        <dd>{t('avatarPreview.tags.oneShot')}</dd>
                      </div>
                      <div>
                        <dt>Front / Bust / Face / Portrait</dt>
                        <dd>{t('avatarPreview.tags.camera')}</dd>
                      </div>
                      <div>
                        <dt>{t('avatarPreview.tags.noCamera')}</dt>
                        <dd>{t('avatarPreview.tags.noCameraDescription')}</dd>
                      </div>
                      <div>
                        <dt>Auto</dt>
                        <dd>{t('avatarPreview.tags.auto')}</dd>
                      </div>
                      <div>
                        <dt>Manual</dt>
                        <dd>{t('avatarPreview.tags.manual')}</dd>
                      </div>
                    </dl>
                  </Content>
                </ContextualHelp>
              </div>
              <SearchField
                aria-label={t('avatarPreview.search')}
                value={query}
                onChange={setQuery}
                placeholder={t('avatarPreview.searchPlaceholder')}
                size="S"
              />
            </div>
            <div className="animation-library-list">
              {filteredGroups.length === 0 && (
                <p className="animation-library-empty">{t('avatarPreview.empty')}</p>
              )}
              {filteredGroups.map((group) => (
                <div key={group.category} className="animation-library-group">
                  <div className="animation-library-category">{categoryLabel(group.category)}</div>
                  {group.animations.map((animation) => (
                    <button
                      key={animation.id}
                      type="button"
                      className={`animation-row${animation.id === animationId ? ' active' : ''}`}
                      aria-pressed={animation.id === animationId}
                      onClick={() => {
                        setAnimationId(animation.id)
                        controller.previewAvatarAnimation(animation.id)
                      }}
                    >
                      <span className="animation-row-title">{getAnimationTitle(animation)}</span>
                      <span className="animation-row-file">{animation.file}</span>
                      <span className="animation-row-badges">
                        <Badge size="S" variant={animation.loop ? 'informative' : 'neutral'}>
                          {animation.loop ? 'Loop' : 'One-shot'}
                        </Badge>
                        {cameraLabel(animation) && (
                          <Badge size="S" variant="gray">
                            {cameraLabel(animation)}
                          </Badge>
                        )}
                        <Badge
                          size="S"
                          variant={
                            isAnimationAutomaticallySelectable(animation) ? 'positive' : 'neutral'
                          }
                        >
                          {isAnimationAutomaticallySelectable(animation) ? 'Auto' : 'Manual'}
                        </Badge>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        )}

        <div className="preview-viewport">
          <div className={ready ? 'avatar-preview-stage' : 'avatar-preview-stage collapsed'}>
            {ready && (
              <div className="preview-camera-toolbar">
                <Button variant="secondary" onPress={() => controller.previewCameraPreset('full')}>
                  Full
                </Button>
                <Button variant="secondary" onPress={() => controller.previewCameraPreset('bust')}>
                  Bust
                </Button>
                <Button variant="secondary" onPress={() => controller.previewCameraPreset('face')}>
                  Face
                </Button>
                <TooltipTrigger delay={200}>
                  <ActionButton
                    aria-label={t('avatarPreview.resetCamera')}
                    onPress={() => controller.resetPreviewCamera()}
                  >
                    <RotateCCW />
                  </ActionButton>
                  <Tooltip>{t('avatarPreview.resetCamera')}</Tooltip>
                </TooltipTrigger>
              </div>
            )}
            <canvas
              ref={canvasRef}
              className={
                ready || phase === 'loading'
                  ? 'avatar-preview-canvas visible'
                  : 'avatar-preview-canvas'
              }
            />
          </div>

          {ready && (
            <div className="preview-playback">
              <span className="settings-hint">{t('avatarPreview.localOnly')}</span>
              {selectedAnimation ? (
                <p className="preview-animation-summary">
                  {getAnimationTitle(selectedAnimation)} ·{' '}
                  {categoryLabel(selectedAnimation.category)} ·{' '}
                  {selectedAnimation.loop ? 'Loop' : 'One-shot'} · {selectedAnimation.file}
                </p>
              ) : (
                <p className="preview-animation-summary">{t('avatarPreview.selectAnimation')}</p>
              )}
              <div className="preview-actions">
                <Button
                  variant="accent"
                  isDisabled={!animationId}
                  onPress={() => controller.previewAvatarAnimation(animationId)}
                >
                  {t('avatarPreview.play')}
                </Button>
                <Button
                  variant="secondary"
                  isDisabled={!animationId}
                  onPress={() => controller.previewAvatarAnimation(animationId)}
                >
                  {t('avatarPreview.replay')}
                </Button>
                <Button variant="secondary" onPress={() => controller.stopAnimation()}>
                  {t('avatarPreview.stop')}
                </Button>
                <Button variant="secondary" onPress={() => controller.previewAvatarMode('idle')}>
                  {t('avatarPreview.returnIdle')}
                </Button>
              </div>
              <div className="preview-actions preview-actions-secondary">
                <Button variant="secondary" onPress={() => void open()}>
                  {t('avatarPreview.reloadModel')}
                </Button>
              </div>
              {selectedAnimation && (
                <details className="preview-animation-details">
                  <summary>{t('avatarPreview.details')}</summary>
                  <dl className="preview-animation-meta">
                    <div>
                      <dt>ID</dt>
                      <dd>{selectedAnimation.id}</dd>
                    </div>
                    <div>
                      <dt>{t('avatarPreview.file')}</dt>
                      <dd>{selectedAnimation.file}</dd>
                    </div>
                    <div>
                      <dt>{t('avatarPreview.category')}</dt>
                      <dd>{categoryLabel(selectedAnimation.category)}</dd>
                    </div>
                    <div>
                      <dt>Loop</dt>
                      <dd>{selectedAnimation.loop ? t('common.yes') : t('common.no')}</dd>
                    </div>
                    <div>
                      <dt>{t('avatarPreview.camera')}</dt>
                      <dd>{cameraLabel(selectedAnimation) ?? t('avatarPreview.noCameraLimit')}</dd>
                    </div>
                    <div>
                      <dt>{t('avatarPreview.selection')}</dt>
                      <dd>
                        {isAnimationAutomaticallySelectable(selectedAnimation)
                          ? t('avatarPreview.automatic')
                          : t('avatarPreview.manualOnly')}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('avatarPreview.description')}</dt>
                      <dd>{selectedAnimation.description}</dd>
                    </div>
                  </dl>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
