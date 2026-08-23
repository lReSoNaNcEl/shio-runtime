import {
  ActionButton,
  Badge,
  Button,
  Content,
  ContextualHelp,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  ProgressCircle,
  SearchField,
  Text,
  ToggleButton,
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
import { resolveVrmSource } from '../../avatar/defaultVrm'
import { controller } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

type Phase = 'closed' | 'loading' | 'ready' | 'error'

const CAMERA_LABEL: Record<string, TranslationKey> = {
  full: 'avatarPreview.cameraPreset.full',
  bust: 'avatarPreview.cameraPreset.bust',
  face: 'avatarPreview.cameraPreset.face',
  portrait: 'avatarPreview.cameraPreset.portrait',
}

function cameraLabel(
  entry: AnimationManifestEntry,
  t: (key: TranslationKey) => string,
): string | null {
  if (!entry.compatibleCameraModes || entry.compatibleCameraModes.length === 0) return null
  return entry.compatibleCameraModes
    .map((mode) => t(CAMERA_LABEL[mode] ?? 'avatarPreview.cameraPreset.full'))
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
    observeRendererPromise(
      window.api.config.get().then((cfg) => {
        if (cancelled) return
        const has = Boolean(resolveVrmSource(cfg.vrmAssetHandle))
        setHasModel(has)
        if (has) observeRendererPromise(open(), 'open Avatar Preview')
      }),
      'load Avatar Preview configuration',
    )
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
        <Heading level={2}>{t('avatarPreview.notConfigured.title')}</Heading>
        <Text>{t('avatarPreview.notConfigured.description')}</Text>
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
              <Heading level={2} UNSAFE_className="preview-loader-title">
                {t('avatarPreview.loadingTitle')}
              </Heading>
              <Text UNSAFE_className="preview-loader-hint">{t('avatarPreview.loadingHint')}</Text>
            </>
          ) : (
            <>
              <Heading level={2} UNSAFE_className="preview-loader-title">
                {t('avatarPreview.loadFailed')}
              </Heading>
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
            <header className="animation-library-header">
              <div className="animation-library-title">
                <Heading level={2}>{t('avatarPreview.library')}</Heading>
                <ContextualHelp variant="info" size="S" aria-label={t('avatarPreview.tagsHelp')}>
                  <Heading>{t('avatarPreview.tagsTitle')}</Heading>
                  <Content>
                    <dl className="animation-tags-help">
                      <div>
                        <dt>{t('avatarPreview.tag.loop')}</dt>
                        <dd>{t('avatarPreview.tags.loop')}</dd>
                      </div>
                      <div>
                        <dt>{t('avatarPreview.tag.oneShot')}</dt>
                        <dd>{t('avatarPreview.tags.oneShot')}</dd>
                      </div>
                      <div>
                        <dt>{t('avatarPreview.tag.cameraModes')}</dt>
                        <dd>{t('avatarPreview.tags.camera')}</dd>
                      </div>
                      <div>
                        <dt>{t('avatarPreview.tags.noCamera')}</dt>
                        <dd>{t('avatarPreview.tags.noCameraDescription')}</dd>
                      </div>
                      <div>
                        <dt>{t('avatarPreview.tag.auto')}</dt>
                        <dd>{t('avatarPreview.tags.auto')}</dd>
                      </div>
                      <div>
                        <dt>{t('avatarPreview.tag.manual')}</dt>
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
            </header>
            <div className="animation-library-list">
              {filteredGroups.length === 0 && (
                <Text UNSAFE_className="animation-library-empty">{t('avatarPreview.empty')}</Text>
              )}
              {filteredGroups.map((group) => (
                <section key={group.category} className="animation-library-group">
                  <Heading level={3} UNSAFE_className="animation-library-category">
                    {categoryLabel(group.category)}
                  </Heading>
                  {group.animations.map((animation) => (
                    <ToggleButton
                      key={animation.id}
                      isSelected={animation.id === animationId}
                      UNSAFE_className="animation-row"
                      onChange={(isSelected) => {
                        if (!isSelected) return
                        setAnimationId(animation.id)
                        controller.previewAvatarAnimation(animation.id)
                      }}
                    >
                      <span className="animation-row-content">
                        <span className="animation-row-title">{getAnimationTitle(animation)}</span>
                        <span className="animation-row-file">{animation.file}</span>
                        <span className="animation-row-badges">
                          <Badge size="S" variant={animation.loop ? 'informative' : 'neutral'}>
                            {animation.loop
                              ? t('avatarPreview.tag.loop')
                              : t('avatarPreview.tag.oneShot')}
                          </Badge>
                          {cameraLabel(animation, t) && (
                            <Badge size="S" variant="gray">
                              {cameraLabel(animation, t)}
                            </Badge>
                          )}
                          <Badge
                            size="S"
                            variant={
                              isAnimationAutomaticallySelectable(animation) ? 'positive' : 'neutral'
                            }
                          >
                            {isAnimationAutomaticallySelectable(animation)
                              ? t('avatarPreview.tag.auto')
                              : t('avatarPreview.tag.manual')}
                          </Badge>
                        </span>
                      </span>
                    </ToggleButton>
                  ))}
                </section>
              ))}
            </div>
          </aside>
        )}

        <section className="preview-viewport" aria-labelledby="avatar-preview-workspace-title">
          {ready && (
            <header className="preview-viewport-header">
              <Heading level={2} id="avatar-preview-workspace-title">
                {t('avatarPreview.workspace')}
              </Heading>
              <Text>{t('avatarPreview.localOnly')}</Text>
            </header>
          )}
          <div className={ready ? 'avatar-preview-stage' : 'avatar-preview-stage collapsed'}>
            {ready && (
              <fieldset className="preview-camera-toolbar">
                <legend className="visually-hidden">{t('avatarPreview.cameraPresets')}</legend>
                <Button variant="secondary" onPress={() => controller.previewCameraPreset('full')}>
                  {t('avatarPreview.cameraPreset.full')}
                </Button>
                <Button variant="secondary" onPress={() => controller.previewCameraPreset('bust')}>
                  {t('avatarPreview.cameraPreset.bust')}
                </Button>
                <Button variant="secondary" onPress={() => controller.previewCameraPreset('face')}>
                  {t('avatarPreview.cameraPreset.face')}
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
              </fieldset>
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
            <section className="preview-playback" aria-labelledby="avatar-preview-playback-title">
              <Heading level={3} id="avatar-preview-playback-title">
                {t('avatarPreview.playbackControls')}
              </Heading>
              {selectedAnimation ? (
                <Text UNSAFE_className="preview-animation-summary">
                  {getAnimationTitle(selectedAnimation)} ·{' '}
                  {categoryLabel(selectedAnimation.category)} ·{' '}
                  {selectedAnimation.loop
                    ? t('avatarPreview.tag.loop')
                    : t('avatarPreview.tag.oneShot')}{' '}
                  · {selectedAnimation.file}
                </Text>
              ) : (
                <Text UNSAFE_className="preview-animation-summary">
                  {t('avatarPreview.selectAnimation')}
                </Text>
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
                <Disclosure isQuiet UNSAFE_className="preview-animation-details">
                  <DisclosureTitle level={4}>{t('avatarPreview.details')}</DisclosureTitle>
                  <DisclosurePanel>
                    <dl className="preview-animation-meta">
                      <div>
                        <dt>{t('avatarPreview.id')}</dt>
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
                        <dt>{t('avatarPreview.tag.loop')}</dt>
                        <dd>{selectedAnimation.loop ? t('common.yes') : t('common.no')}</dd>
                      </div>
                      <div>
                        <dt>{t('avatarPreview.camera')}</dt>
                        <dd>
                          {cameraLabel(selectedAnimation, t) ?? t('avatarPreview.noCameraLimit')}
                        </dd>
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
                  </DisclosurePanel>
                </Disclosure>
              )}
            </section>
          )}
        </section>
      </div>
    </section>
  )
}
