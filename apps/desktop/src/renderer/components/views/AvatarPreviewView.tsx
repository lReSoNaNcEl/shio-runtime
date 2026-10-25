import {
  Button,
  Heading,
  Picker,
  PickerItem,
  ProgressCircle,
  Slider,
  Text,
} from '@react-spectrum/s2'
import { useEffect, useRef, useState } from 'react'

import { emotionRegistry } from '../../../shared/emotion'
import { ANIMATION_MANIFEST } from '../../avatar/animationManifest'
import { controller } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

const EXPRESSIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'shy',
  'amused',
  'sleepy',
  'excited',
  'worried',
  'confused',
  'proud',
  'pouting',
  'crying',
  'laugh',
  'loving',
  'dazed',
] as const

export function AvatarPreviewView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t, locale } = useTranslation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [emotion, setEmotion] = useState('neutral')
  const [intensity, setIntensity] = useState(0.8)
  const [view, setView] = useState('full')
  const [tail, setTail] = useState('side')

  useEffect(() => {
    let mounted = true
    if (canvas.current) {
      observeRendererPromise(
        controller
          .attachCanvas(canvas.current)
          .then(() => {
            if (mounted) setPhase(controller.getState().avatarLoaded ? 'ready' : 'error')
          })
          .catch(() => {
            if (mounted) setPhase('error')
          }),
        'attach S22 preview',
      )
    }
    return () => {
      mounted = false
      controller.detachCanvas()
    }
  }, [])

  const applyEmotion = (id: string, value = intensity): void => {
    if (!emotionRegistry.supported().includes(id)) return
    setEmotion(id)
    controller.previewEmotion(id, value)
  }

  return (
    <section className="avatar-preview-view">
      <div className="avatar-preview-workspace">
        <aside className="avatar-2d-controls">
          <Heading level={2}>{t('avatar2d.bundled')}</Heading>
          <Picker
            label={t('avatar2d.emotion')}
            selectedKey={emotion}
            onSelectionChange={(key) => applyEmotion(String(key))}
          >
            {EXPRESSIONS.map((id) => (
              <PickerItem key={id} id={id}>
                {t(`avatar2d.emotion.${id}`)}
              </PickerItem>
            ))}
          </Picker>
          <Slider
            label={t('avatar2d.intensity')}
            minValue={0}
            maxValue={1}
            step={0.01}
            value={intensity}
            onChange={(value) => {
              setIntensity(value)
              applyEmotion(emotion, value)
            }}
          />
          <Picker
            label={t('avatar2d.framing')}
            selectedKey={view}
            onSelectionChange={(key) => {
              const next = String(key)
              setView(next)
              controller.previewCameraPreset(next === 'full' ? 'full' : 'portrait')
            }}
          >
            <PickerItem id="full">{t('avatarPreview.cameraPreset.full')}</PickerItem>
            <PickerItem id="portrait">{t('avatarPreview.cameraPreset.portrait')}</PickerItem>
          </Picker>
          <Picker
            label={t('avatar2d.tail')}
            selectedKey={tail}
            onSelectionChange={(key) => {
              const next = key === 'back' ? 'back' : 'side'
              setTail(next)
              controller.previewTailStyle(next)
            }}
          >
            <PickerItem id="side">{t('avatar2d.tail.side')}</PickerItem>
            <PickerItem id="back">{t('avatar2d.tail.back')}</PickerItem>
          </Picker>
          <Heading level={3}>{t('avatarPreview.library')}</Heading>
          <div className="animation-library-list">
            {ANIMATION_MANIFEST.filter((entry) => !entry.loop).map((entry) => (
              <Button
                key={entry.id}
                variant="secondary"
                isDisabled={phase !== 'ready'}
                onPress={() => controller.previewAvatarAnimation(entry.id)}
              >
                {locale === 'ru' && 'displayNameRu' in entry
                  ? entry.displayNameRu
                  : entry.displayName}
              </Button>
            ))}
          </div>
          <Button variant="secondary" onPress={() => controller.previewAvatarMode('idle')}>
            {t('avatarPreview.returnIdle')}
          </Button>
          <Button variant="secondary" onPress={onOpenSettings}>
            {t('avatarPreview.openSettings')}
          </Button>
        </aside>
        <section className="avatar-preview-stage">
          {phase === 'loading' && (
            <ProgressCircle aria-label={t('avatarPreview.loading')} isIndeterminate />
          )}
          {phase === 'error' && <Text>{t('avatarPreview.loadFailed')}</Text>}
          <canvas
            ref={canvas}
            className="avatar-preview-canvas visible"
            aria-label={t('avatar2d.bundled')}
          />
        </section>
      </div>
    </section>
  )
}
