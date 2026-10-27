import {
  ActionButton,
  Badge,
  Button,
  Content,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  InlineAlert,
  ListView,
  ListViewItem,
  NumberField,
  Picker,
  PickerItem,
  ProgressCircle,
  SearchField,
  StatusLight,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import RotateCCW from '@react-spectrum/s2/icons/RotateCCW'
import { useEffect, useMemo, useRef, useState } from 'react'

import { type TranslationKey } from '../../../shared/localization'
import { type GeneratedMotionHealth, MOTION_PROFILES } from '../../../shared/motion'
import { resolveVrmSource } from '../../avatar/defaultVrm'
import { type MotionLibraryDebug } from '../../avatar/MotionLibraryDebug'
import { controller } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

type Phase = 'closed' | 'loading' | 'ready' | 'error'
type AvailabilityFilter = 'all' | 'available' | 'unavailable'
type GroupFilter = 'all' | (typeof LIBRARY_GROUPS)[number]

const LIBRARY_GROUPS = ['presence', 'conversation', 'reactions', 'special'] as const
const AVAILABILITY_REASONS: Record<string, TranslationKey> = {
  'generator-unavailable': 'avatarPreview.reason.generator',
  'model-not-ready': 'avatarPreview.reason.model',
  'rig-unsupported': 'avatarPreview.reason.rig',
  'calibration-missing': 'avatarPreview.reason.calibration',
  'qualification-required': 'avatarPreview.reason.qualification',
  disabled: 'avatarPreview.reason.disabled',
  'camera-incompatible': 'avatarPreview.reason.camera',
  cooldown: 'avatarPreview.reason.cooldown',
  'transition-blocked': 'avatarPreview.reason.transition',
  'stale-intent': 'avatarPreview.reason.stale',
}
const PHASE_LABELS: Record<string, TranslationKey> = {
  prepare: 'avatarPreview.phase.prepare',
  stroke: 'avatarPreview.phase.stroke',
  hold: 'avatarPreview.phase.hold',
  recover: 'avatarPreview.phase.recover',
}
const ROUTE_LABELS: Record<string, TranslationKey> = {
  relaxed: 'avatarPreview.route.relaxed',
  front: 'avatarPreview.route.front',
  raised: 'avatarPreview.route.raised',
  heart: 'avatarPreview.route.heart',
  side: 'avatarPreview.route.side',
  waist: 'avatarPreview.route.waist',
  face: 'avatarPreview.route.face',
  'bridge-via-recovery': 'avatarPreview.route.bridge',
  'direct-continuation': 'avatarPreview.route.direct',
  'recover-to-standing': 'avatarPreview.route.recovery',
}
const STATE_LABELS: Record<string, TranslationKey> = {
  unavailable: 'avatarPreview.state.unavailable',
  loading: 'avatarPreview.state.loading',
  ready: 'avatarPreview.state.ready',
  degraded: 'avatarPreview.state.degraded',
  stopped: 'avatarPreview.state.stopped',
  mirror: 'avatarPreview.state.mirror',
}
const OUTCOME_LABELS: Record<string, TranslationKey> = {
  completed: 'avatarPreview.outcome.completed',
  superseded: 'avatarPreview.outcome.superseded',
  cancelled: 'avatarPreview.outcome.cancelled',
  'timed-out': 'avatarPreview.outcome.timedOut',
  failed: 'avatarPreview.outcome.failed',
}

export function AvatarPreviewView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { locale, t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mountedRef = useRef(true)
  const [phase, setPhase] = useState<Phase>('loading')
  const [hasModel, setHasModel] = useState<boolean | null>(null)
  const [selectedId, setSelectedId] = useState('presence_poised')
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all')
  const [query, setQuery] = useState('')
  const [variationSeed, setVariationSeed] = useState(Number.NaN)
  const [turnDirection, setTurnDirection] = useState<'clockwise' | 'counterclockwise'>('clockwise')
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all')
  const [motion, setMotion] = useState<GeneratedMotionHealth>()
  const [library, setLibrary] = useState<MotionLibraryDebug>()
  const nextSequenceId = useRef(0)
  const [sequence, setSequence] = useState<Array<{ id: number; profileId: string }>>([])

  useEffect(() => {
    const refresh = () => {
      setMotion(controller.getGeneratedMotionDebug())
      setLibrary(controller.getMotionLibraryDebug())
    }
    refresh()
    const timer = window.setInterval(refresh, 300)
    return () => window.clearInterval(timer)
  }, [])

  const selected = MOTION_PROFILES.find((profile) => profile.id === selectedId)
  const running = MOTION_PROFILES.find((profile) => profile.id === library?.runningProfileId)
  const selectedAvailability = selected ? library?.profiles[selected.id] : undefined
  const reasonText = (reason: string | null | undefined) =>
    t(AVAILABILITY_REASONS[reason ?? 'model-not-ready'] ?? 'avatarPreview.reason.transition')
  const profileTitle = (id: string) =>
    MOTION_PROFILES.find((profile) => profile.id === id)?.labels[locale] ?? id
  const phaseText = (value: string | null | undefined) =>
    t(PHASE_LABELS[value ?? ''] ?? 'avatarPreview.phase.none')
  const routeText = (value: string) =>
    value === 'standing'
      ? t('avatarPreview.posture.standing')
      : PHASE_LABELS[value]
        ? t(PHASE_LABELS[value])
        : ROUTE_LABELS[value]
          ? t(ROUTE_LABELS[value])
          : profileTitle(value)

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale)
    return LIBRARY_GROUPS.map((group) => ({
      id: group,
      profiles: MOTION_PROFILES.filter((profile) => {
        if (
          profile.libraryGroup !== group ||
          (groupFilter !== 'all' && profile.libraryGroup !== groupFilter)
        )
          return false
        const available = library?.profiles[profile.id]?.available ?? false
        if (availabilityFilter === 'available' && !available) return false
        if (availabilityFilter === 'unavailable' && available) return false
        return (
          !needle ||
          [profile.labels[locale], profile.descriptions[locale], profile.id].some((value) =>
            value.toLocaleLowerCase(locale).includes(needle),
          )
        )
      }),
    })).filter((group) => group.profiles.length > 0)
  }, [query, locale, availabilityFilter, library, groupFilter])

  // biome-ignore lint/correctness/useExhaustiveDependencies: bootstrap once per mounted Preview; open depends on its canvas lifecycle.
  useEffect(() => {
    let cancelled = false
    mountedRef.current = true
    observeRendererPromise(
      window.api.config.get().then((config) => {
        if (cancelled) return
        const configured = Boolean(resolveVrmSource(config.vrmAssetHandle))
        setHasModel(configured)
        if (configured) observeRendererPromise(open(), 'open Avatar Preview')
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
      if (mountedRef.current) setPhase(controller.getState().vrmLoaded ? 'ready' : 'error')
    } catch {
      if (mountedRef.current) setPhase('error')
    }
  }

  async function reload(): Promise<void> {
    setPhase('loading')
    try {
      await controller.reloadPreviewModel()
      if (mountedRef.current) setPhase(controller.getState().vrmLoaded ? 'ready' : 'error')
    } catch {
      if (mountedRef.current) setPhase('error')
    }
  }

  const ready = phase === 'ready'
  const generatorUnavailable =
    !running &&
    (motion?.state === 'unavailable' || (motion?.state === 'degraded' && Boolean(motion.error)))
  const selectionReason = selectedAvailability?.reason
  const canPlay =
    ready &&
    Boolean(selected) &&
    (selectedAvailability?.available === true || selectionReason === 'generator-unavailable')
  const visibleProfiles = groups.flatMap((group) => group.profiles)
  const profileProblem =
    !generatorUnavailable && selected && !selectedAvailability?.available
      ? reasonText(selectedAvailability?.reason)
      : null
  const validSeed =
    Number.isNaN(variationSeed) ||
    (Number.isInteger(variationSeed) && variationSeed >= 0 && variationSeed <= 2_147_483_647)
  const canPlaySequence =
    ready &&
    sequence.length >= 3 &&
    sequence.every((entry) => library?.profiles[entry.profileId]?.available === true)

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
              <Heading level={2}>{t('avatarPreview.loadingTitle')}</Heading>
              <Text>{t('avatarPreview.loadingHint')}</Text>
            </>
          ) : (
            <>
              <Heading level={2}>{t('avatarPreview.loadFailed')}</Heading>
              <Button
                variant="secondary"
                onPress={() => observeRendererPromise(reload(), 'reload Avatar Preview')}
              >
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
          <aside className="animation-library" aria-label={t('avatarPreview.library')}>
            <header className="animation-library-header">
              <div className="preview-section-heading">
                <Heading level={2}>{t('avatarPreview.library')}</Heading>
                <span className="preview-library-count">
                  <Badge size="S" variant="neutral">
                    {String(visibleProfiles.length)}
                  </Badge>
                </span>
              </div>
              <SearchField
                aria-label={t('avatarPreview.search')}
                value={query}
                onChange={setQuery}
                placeholder={t('avatarPreview.searchPlaceholder')}
              />
              <div className="animation-library-filters">
                <Picker
                  aria-label={t('avatarPreview.groupFilter')}
                  selectedKey={groupFilter}
                  onSelectionChange={(key) => setGroupFilter(String(key) as GroupFilter)}
                >
                  <PickerItem id="all">{t('avatarPreview.filter.all')}</PickerItem>
                  {LIBRARY_GROUPS.map((group) => (
                    <PickerItem key={group} id={group}>
                      {t(`avatarPreview.group.${group}` as TranslationKey)}
                    </PickerItem>
                  ))}
                </Picker>
                <Picker
                  aria-label={t('avatarPreview.availabilityFilter')}
                  selectedKey={availabilityFilter}
                  onSelectionChange={(key) =>
                    setAvailabilityFilter(String(key) as AvailabilityFilter)
                  }
                >
                  <PickerItem id="all">{t('avatarPreview.availabilityFilter')}</PickerItem>
                  <PickerItem id="available">{t('avatarPreview.filter.available')}</PickerItem>
                  <PickerItem id="unavailable">{t('avatarPreview.filter.unavailable')}</PickerItem>
                </Picker>
              </div>
            </header>
            {visibleProfiles.length ? (
              <ListView
                aria-label={t('avatarPreview.library')}
                items={visibleProfiles}
                selectionMode="single"
                selectionStyle="highlight"
                isQuiet
                selectedKeys={new Set([selectedId])}
                onSelectionChange={(keys) => {
                  if (keys === 'all') return
                  const id = keys.values().next().value
                  if (typeof id === 'string') setSelectedId(id)
                }}
                UNSAFE_className="animation-library-list"
              >
                {(profile) => (
                  <ListViewItem
                    id={profile.id}
                    aria-label={profile.labels[locale]}
                    textValue={profile.labels[locale]}
                  >
                    <Text slot="label">{profile.labels[locale]}</Text>
                    <Text slot="description">
                      {t(`avatarPreview.group.${profile.libraryGroup}` as TranslationKey)} ·{' '}
                      {library?.profiles[profile.id]?.available
                        ? t('avatarPreview.available')
                        : t('avatarPreview.unavailable')}
                    </Text>
                  </ListViewItem>
                )}
              </ListView>
            ) : (
              <div className="preview-library-empty">
                <Text>{t('avatarPreview.empty')}</Text>
              </div>
            )}
          </aside>
        )}

        <section className="preview-viewport" aria-labelledby="avatar-preview-workspace-title">
          {ready && (
            <header className="preview-viewport-header">
              <Heading level={2} id="avatar-preview-workspace-title">
                {t('avatarPreview.workspace')}
              </Heading>
              <TooltipTrigger delay={200}>
                <ActionButton
                  aria-label={t('avatarPreview.resetCamera')}
                  onPress={() => controller.resetPreviewCamera()}
                >
                  <RotateCCW />
                </ActionButton>
                <Tooltip>{t('avatarPreview.resetCamera')}</Tooltip>
              </TooltipTrigger>
            </header>
          )}
          <div className={ready ? 'avatar-preview-stage' : 'avatar-preview-stage collapsed'}>
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
            <footer className="preview-stage-footer">
              <fieldset className="preview-camera-toolbar">
                <legend className="visually-hidden">{t('avatarPreview.cameraPresets')}</legend>
                {(['full', 'bust', 'face'] as const).map((preset) => (
                  <Button
                    key={preset}
                    variant="secondary"
                    onPress={() => controller.previewCameraPreset(preset)}
                  >
                    {t(`avatarPreview.cameraPreset.${preset}` as TranslationKey)}
                  </Button>
                ))}
                <Button variant="secondary" onPress={() => controller.previewHandCamera('left')}>
                  {t('avatarPreview.cameraPreset.leftHand')}
                </Button>
                <Button variant="secondary" onPress={() => controller.previewHandCamera('right')}>
                  {t('avatarPreview.cameraPreset.rightHand')}
                </Button>
              </fieldset>
              <div
                className="preview-running-status"
                data-motion-phase={library?.phase ?? 'none'}
                aria-live="polite"
              >
                <StatusLight size="S" variant={running ? 'positive' : 'neutral'}>
                  {running
                    ? `${t('avatarPreview.inspector.running')}: ${running.labels[locale]} · ${phaseText(library?.phase)}`
                    : t('avatarPreview.inspector.noRunning')}
                </StatusLight>
              </div>
            </footer>
          )}
        </section>

        {ready && (
          <aside className="preview-inspector" aria-labelledby="avatar-preview-inspector-title">
            <div className="preview-inspector-intro">
              <Text>{t('avatarPreview.inspector.title')}</Text>
              <Heading level={2} id="avatar-preview-inspector-title">
                {selected?.labels[locale] ?? t('avatarPreview.inspector.emptyTitle')}
              </Heading>
              <Text>
                {selected?.descriptions[locale] ?? t('avatarPreview.inspector.emptyDescription')}
              </Text>
              {selected && (
                <div className="preview-profile-tags">
                  <Badge variant="neutral" size="S">
                    {t(`avatarPreview.group.${selected.libraryGroup}` as TranslationKey)}
                  </Badge>
                  <Badge variant="neutral" size="S">
                    {t(
                      `avatarPreview.qualification.${selected.qualification.state}` as TranslationKey,
                    )}
                  </Badge>
                </div>
              )}
            </div>
            {generatorUnavailable ? (
              <InlineAlert variant="notice" fillStyle="subtleFill">
                <Heading>{t('avatarPreview.runtime.unavailableTitle')}</Heading>
                <Content>{t('avatarPreview.runtime.unavailableDescription')}</Content>
              </InlineAlert>
            ) : profileProblem ? (
              <InlineAlert variant="notice" fillStyle="subtleFill">
                <Content>{profileProblem}</Content>
              </InlineAlert>
            ) : null}
            <div className="preview-primary-actions">
              {selected?.physicalAction && (
                <Picker
                  label={t('avatarPreview.turn.direction')}
                  value={turnDirection}
                  onChange={(value) => {
                    if (value === 'clockwise' || value === 'counterclockwise')
                      setTurnDirection(value)
                  }}
                >
                  <PickerItem id="clockwise">{t('avatarPreview.turn.clockwise')}</PickerItem>
                  <PickerItem id="counterclockwise">
                    {t('avatarPreview.turn.counterclockwise')}
                  </PickerItem>
                </Picker>
              )}
              <Button
                variant="accent"
                isDisabled={!canPlay}
                onPress={() => {
                  if (selected?.physicalAction)
                    controller.previewAvatarVariation(
                      selectedId,
                      Number.isNaN(variationSeed) ? undefined : variationSeed,
                      {
                        action: 'turn-in-place',
                        turns: 1,
                        direction: turnDirection,
                        tempo: 1,
                        finishFacing: 'viewer',
                      },
                    )
                  else if (generatorUnavailable) controller.previewAvatarVariation(selectedId)
                  else controller.previewAvatarAnimation(selectedId)
                }}
              >
                {generatorUnavailable
                  ? t('avatarPreview.action.retryGeneration')
                  : t('avatarPreview.play')}
              </Button>
              <Button
                variant="secondary"
                isDisabled={!canPlay || !validSeed || generatorUnavailable}
                onPress={() =>
                  controller.previewAvatarVariation(
                    selectedId,
                    Number.isNaN(variationSeed) ? undefined : variationSeed,
                    selected?.physicalAction
                      ? {
                          action: 'turn-in-place',
                          turns: 1,
                          direction: turnDirection,
                          tempo: 1,
                          finishFacing: 'viewer',
                        }
                      : undefined,
                  )
                }
              >
                {t('avatarPreview.replay')}
              </Button>
            </div>
            <div className="preview-actions preview-transport-actions">
              <Button
                variant="secondary"
                isDisabled={!running}
                onPress={() => controller.stopAnimation()}
              >
                {t('avatarPreview.stop')}
              </Button>
              <Button
                variant="secondary"
                isDisabled={!running}
                onPress={() => controller.recoverAvatarMotion()}
              >
                {t('avatarPreview.returnIdle')}
              </Button>
            </div>
            <div className="preview-inspector-advanced">
              <Disclosure isQuiet>
                <DisclosureTitle level={4}>{t('avatarPreview.sequence.title')}</DisclosureTitle>
                <DisclosurePanel>
                  <Text>{t('avatarPreview.sequence.description')}</Text>
                  <ol className="preview-motion-sequence">
                    {sequence.map((entry) => (
                      <li key={entry.id}>
                        <Text>{profileTitle(entry.profileId)}</Text>
                      </li>
                    ))}
                  </ol>
                  <div className="preview-actions">
                    <Button
                      variant="secondary"
                      isDisabled={!selected || sequence.length >= 5}
                      onPress={() => {
                        const entry = { id: nextSequenceId.current++, profileId: selectedId }
                        setSequence((current) => [...current, entry])
                      }}
                    >
                      {t('avatarPreview.sequence.add')}
                    </Button>
                    <Button
                      variant="secondary"
                      isDisabled={sequence.length === 0}
                      onPress={() => setSequence((current) => current.slice(0, -1))}
                    >
                      {t('avatarPreview.sequence.remove')}
                    </Button>
                    <Button
                      variant="secondary"
                      isDisabled={!canPlaySequence}
                      onPress={() =>
                        controller.previewAvatarSequence(sequence.map((entry) => entry.profileId))
                      }
                    >
                      {t('avatarPreview.sequence.play')}
                    </Button>
                  </div>
                </DisclosurePanel>
              </Disclosure>
              <Disclosure isQuiet UNSAFE_className="preview-animation-details">
                <DisclosureTitle level={4}>{t('avatarPreview.details')}</DisclosureTitle>
                <DisclosurePanel>
                  <div className="preview-actions">
                    <NumberField
                      label={t('avatarPreview.seed.input')}
                      description={t('avatarPreview.seed.help')}
                      value={variationSeed}
                      onChange={setVariationSeed}
                      minValue={0}
                      maxValue={2_147_483_647}
                      step={1}
                      isInvalid={!validSeed}
                    />
                    <Button
                      variant="secondary"
                      isDisabled={Number.isNaN(variationSeed)}
                      onPress={() => setVariationSeed(Number.NaN)}
                    >
                      {t('avatarPreview.seed.random')}
                    </Button>
                  </div>
                  {!validSeed && <Text>{t('avatarPreview.seed.invalid')}</Text>}
                  <dl className="preview-animation-meta">
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.bodyPhase')}</Text>
                      </dt>
                      <dd>
                        <Text>{running ? phaseText(library?.phase) : phaseText(null)}</Text>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.handPhase')}</Text>
                      </dt>
                      <dd>
                        <Text>{running ? phaseText(library?.handPhase) : phaseText(null)}</Text>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.posture')}</Text>
                      </dt>
                      <dd>
                        <Text>{t('avatarPreview.posture.standing')}</Text>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.transitionRoute')}</Text>
                      </dt>
                      <dd>
                        <Text>
                          {library?.transitionRoute.length
                            ? library.transitionRoute.map(routeText).join(' → ')
                            : phaseText(null)}
                        </Text>
                      </dd>
                    </div>
                    {library?.rejectedReason && (
                      <div>
                        <dt>
                          <Text>{t('avatarPreview.failure')}</Text>
                        </dt>
                        <dd>
                          <Text>{reasonText(library.rejectedReason)}</Text>
                        </dd>
                      </div>
                    )}
                    {library?.outcome && (
                      <div>
                        <dt>
                          <Text>{t('avatarPreview.playbackControls')}</Text>
                        </dt>
                        <dd>
                          <Text>{t(OUTCOME_LABELS[library.outcome])}</Text>
                        </dd>
                      </div>
                    )}

                    {selected && (
                      <>
                        <div>
                          <dt>
                            <Text>{t('avatarPreview.id')}</Text>
                          </dt>
                          <dd>
                            <Text>{selected.id}</Text>
                          </dd>
                        </div>
                        <div>
                          <dt>
                            <Text>{t('avatarPreview.qualification')}</Text>
                          </dt>
                          <dd>
                            <Text>
                              {t(
                                `avatarPreview.qualification.${selected.qualification.state}` as TranslationKey,
                              )}
                            </Text>
                          </dd>
                        </div>
                        <div>
                          <dt>
                            <Text>{t('avatarPreview.handScore')}</Text>
                          </dt>
                          <dd>
                            <Text>{selected.handScore.revision}</Text>
                          </dd>
                        </div>
                      </>
                    )}
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.generatedStatus')}</Text>
                      </dt>
                      <dd>
                        <Text>{t(STATE_LABELS[motion?.state ?? 'unavailable'])}</Text>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.seed')}</Text>
                      </dt>
                      <dd>
                        <Text>{motion?.seed ?? '—'}</Text>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.queue')}</Text>
                      </dt>
                      <dd>
                        <Text>{motion?.queueFrames ?? 0}/32</Text>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.inference')}</Text>
                      </dt>
                      <dd>
                        <Text>
                          {Math.round(motion?.inferenceMs ?? 0)} {t('avatarPreview.milliseconds')}
                        </Text>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.blend')}</Text>
                      </dt>
                      <dd>
                        <Text>
                          {Math.round((library?.blendRemaining ?? 0) * 1000)}{' '}
                          {t('avatarPreview.milliseconds')}
                        </Text>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.underruns')}</Text>
                      </dt>
                      <dd>
                        <Text>{library?.underruns ?? 0}</Text>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.corrections')}</Text>
                      </dt>
                      <dd>
                        <Text>
                          {motion?.safety?.jointCorrections ?? 0} /{' '}
                          {motion?.safety?.armCorrections ?? 0}
                        </Text>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.execution')}</Text>
                      </dt>
                      <dd>
                        <Text>{library?.executionId ?? '—'}</Text>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Text>{t('avatarPreview.lease')}</Text>
                      </dt>
                      <dd>
                        <Text>{motion?.epoch ?? '—'}</Text>
                      </dd>
                    </div>
                    {motion?.error && (
                      <div>
                        <dt>
                          <Text>{t('avatarPreview.failure')}</Text>
                        </dt>
                        <dd>
                          <Text>{motion.error}</Text>
                        </dd>
                      </div>
                    )}
                  </dl>
                </DisclosurePanel>
              </Disclosure>
            </div>
            <div className="preview-inspector-footer">
              <Button
                variant="secondary"
                onPress={() => observeRendererPromise(reload(), 'reload Avatar Preview')}
              >
                {t('avatarPreview.reloadModel')}
              </Button>
            </div>
          </aside>
        )}
      </div>
    </section>
  )
}
