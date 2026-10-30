import {
  Cell,
  Column,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Meter,
  Row,
  Switch,
  TableBody,
  TableHeader,
  TableView,
  Text,
} from '@react-spectrum/s2'
import { useEffect, useState } from 'react'

import { type TranslationKey } from '../../../shared/localization'
import {
  MOTION_ATTENUATION_CHANNELS,
  type MotionAttenuationChannel,
  type MotionAttenuationDebug,
  type MotionAttenuationStage,
} from '../../avatar/MotionAttenuation'
import { controller } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'

const CHANNEL_LABELS: Record<MotionAttenuationChannel, TranslationKey> = {
  leftHand: 'avatarPreview.attenuation.channel.leftHand',
  rightHand: 'avatarPreview.attenuation.channel.rightHand',
  head: 'avatarPreview.attenuation.channel.head',
  torso: 'avatarPreview.attenuation.channel.torso',
  mouth: 'avatarPreview.attenuation.channel.mouth',
  brows: 'avatarPreview.attenuation.channel.brows',
}

const STAGE_LABELS: Record<MotionAttenuationStage, TranslationKey> = {
  'standing-arm-range': 'avatarPreview.attenuation.stage.standingArmRange',
  'recover-rest': 'avatarPreview.attenuation.stage.recoverRest',
  'body-safety.workspace': 'avatarPreview.attenuation.stage.workspace',
  'body-safety.contact': 'avatarPreview.attenuation.stage.contact',
  'body-safety.hinge': 'avatarPreview.attenuation.stage.hinge',
  'adaptive-filter': 'avatarPreview.attenuation.stage.adaptiveFilter',
  'head-authority': 'avatarPreview.attenuation.stage.headAuthority',
  'expression-mixer': 'avatarPreview.attenuation.stage.expressionMixer',
  'lipsync-clamp': 'avatarPreview.attenuation.stage.lipSyncClamp',
}

const FILTER_LIMITS = [
  ['presenceCeiling', 'avatarPreview.attenuation.filter.presenceCeiling'],
  ['generatedSpeedCap', 'avatarPreview.attenuation.filter.generatedSpeedCap'],
  ['generatedPresenceBandwidth', 'avatarPreview.attenuation.filter.generatedPresenceBandwidth'],
  ['accelerationLimited', 'avatarPreview.attenuation.filter.acceleration'],
] as const

const percent = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 100)

/** Debug-only limiter attribution; collection runs only while the switch is on. */
export function MotionAttenuationPanel() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)
  const [debug, setDebug] = useState<MotionAttenuationDebug | null>(null)

  useEffect(() => {
    controller.setMotionAttenuationEnabled(enabled)
    if (!enabled) {
      setDebug(null)
      return
    }
    const refresh = () => setDebug(controller.getMotionAttenuation())
    refresh()
    const timer = window.setInterval(refresh, 500)
    return () => {
      window.clearInterval(timer)
      controller.setMotionAttenuationEnabled(false)
    }
  }, [enabled])

  const rows = MOTION_ATTENUATION_CHANNELS.flatMap((channel) =>
    (debug?.channels[channel] ?? []).map((entry) => ({
      id: `${channel}:${entry.stage}`,
      channel,
      ...entry,
    })),
  )
  const frames = debug?.filterLimits?.frames ?? 0

  return (
    <Disclosure isQuiet>
      <DisclosureTitle level={4}>{t('avatarPreview.attenuation.title')}</DisclosureTitle>
      <DisclosurePanel>
        <Text>{t('avatarPreview.attenuation.description')}</Text>
        <Switch isSelected={enabled} onChange={setEnabled}>
          {t('avatarPreview.attenuation.enable')}
        </Switch>
        {enabled && (
          <>
            <TableView aria-label={t('avatarPreview.attenuation.title')} density="compact">
              <TableHeader>
                <Column isRowHeader>{t('avatarPreview.attenuation.column.channel')}</Column>
                <Column>{t('avatarPreview.attenuation.column.stage')}</Column>
                <Column>{t('avatarPreview.attenuation.column.retained')}</Column>
                <Column>{t('avatarPreview.attenuation.column.limited')}</Column>
                <Column>{t('avatarPreview.attenuation.column.samples')}</Column>
              </TableHeader>
              <TableBody items={rows} renderEmptyState={() => t('avatarPreview.attenuation.empty')}>
                {(row) => (
                  <Row id={row.id}>
                    <Cell>{t(CHANNEL_LABELS[row.channel])}</Cell>
                    <Cell>{t(STAGE_LABELS[row.stage])}</Cell>
                    <Cell>{`${percent(row.ratio)}%`}</Cell>
                    <Cell>{`${percent(row.limitedShare)}%`}</Cell>
                    <Cell>{String(row.samples)}</Cell>
                  </Row>
                )}
              </TableBody>
            </TableView>
            {debug && debug.dropped > 0 && (
              <Text>{t('avatarPreview.attenuation.dropped', { count: debug.dropped })}</Text>
            )}
            <Text>{t('avatarPreview.attenuation.filter.title')}</Text>
            {FILTER_LIMITS.map(([key, label]) => {
              const value = frames > 0 ? percent((debug?.filterLimits?.[key] ?? 0) / frames) : 0
              return (
                <Meter
                  key={key}
                  label={t(label)}
                  value={value}
                  minValue={0}
                  maxValue={100}
                  valueLabel={`${value}%`}
                  size="S"
                />
              )
            })}
          </>
        )}
      </DisclosurePanel>
    </Disclosure>
  )
}
