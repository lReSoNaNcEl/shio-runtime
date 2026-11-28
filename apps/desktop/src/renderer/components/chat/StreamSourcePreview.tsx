import {
  ActionButton,
  Button,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  Image,
  StatusLight,
  Text,
} from '@react-spectrum/s2'
import Close from '@react-spectrum/s2/icons/Close'
import { useEffect, useRef, useState } from 'react'

import {
  type ScreenContextErrorCode,
  type ScreenContextSource,
} from '../../../shared/screen-context'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import { ScreenSourceGrid } from './ScreenSourceGrid'
import { screenContextErrorMessage } from './screenContextErrorMessage'

type Preview =
  | { kind: 'closed' }
  | { kind: 'loading' }
  | { kind: 'choosing'; sources: ScreenContextSource[] }
  | { kind: 'frame'; source: ScreenContextSource; sampledAt: number }
  | { kind: 'error'; code: ScreenContextErrorCode }

export function StreamSourcePreview() {
  const { t, intlLocale } = useTranslation()
  const [preview, setPreview] = useState<Preview>({ kind: 'closed' })
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current += 1
    },
    [],
  )

  const load = async (sourceId?: string): Promise<void> => {
    const current = ++request.current
    setPreview({ kind: 'loading' })
    try {
      const result = await window.api.screenContext.listSources()
      if (current !== request.current) return
      if (!result.ok) {
        setPreview({ kind: 'error', code: result.error.code })
        return
      }
      const sampledAt = Date.now()
      if (sourceId === undefined) {
        setPreview({ kind: 'choosing', sources: result.value })
      } else {
        const source = result.value.find((candidate) => candidate.id === sourceId)
        setPreview(
          source
            ? { kind: 'frame', source, sampledAt }
            : { kind: 'error', code: 'SOURCE_NOT_FOUND' },
        )
      }
    } catch {
      if (current === request.current) setPreview({ kind: 'error', code: 'UNKNOWN' })
    }
  }
  const open = (sourceId?: string) =>
    observeRendererPromise(load(sourceId), 'preview streaming source')
  const close = () => {
    request.current += 1
    setPreview({ kind: 'closed' })
  }
  if (preview.kind === 'closed') {
    return (
      <Button size="S" variant="secondary" onPress={() => open()}>
        {t('streaming.preview.open')}
      </Button>
    )
  }

  return (
    <section className="stream-source-preview" aria-label={t('streaming.preview.open')}>
      {preview.kind === 'loading' && (
        <StatusLight variant="neutral">{t('screenContext.picker.loading')}</StatusLight>
      )}
      {preview.kind === 'error' && (
        <StatusLight variant="notice">{screenContextErrorMessage(preview.code, t)}</StatusLight>
      )}
      <DialogContainer onDismiss={close}>
        {preview.kind === 'choosing' && (
          <Dialog size="L" isDismissible>
            <Heading slot="title">{t('streaming.preview.choose')}</Heading>
            <Content>
              <ScreenSourceGrid
                sources={preview.sources}
                selectedId={null}
                onSelect={(source) => {
                  if (source) open(source.id)
                }}
              />
            </Content>
          </Dialog>
        )}
      </DialogContainer>
      {preview.kind === 'frame' && (
        <>
          {preview.source.previewDataUrl ? (
            <Image
              UNSAFE_className="stream-source-frame"
              src={preview.source.previewDataUrl}
              alt={t('streaming.preview.frame', { name: preview.source.name })}
            />
          ) : (
            <StatusLight variant="notice">
              {t('screenContext.source.previewUnavailable')}
            </StatusLight>
          )}
          <div className="stream-source-caption">
            <Text>
              <strong>{preview.source.name}</strong>
            </Text>
            <Text>
              {t('streaming.preview.sampled', {
                time: new Date(preview.sampledAt).toLocaleTimeString(intlLocale),
              })}
            </Text>
          </div>
          <Button size="S" variant="secondary" onPress={() => open(preview.source.id)}>
            {t('streaming.preview.refresh')}
          </Button>
        </>
      )}
      {(preview.kind === 'error' || preview.kind === 'frame') && (
        <Button size="S" variant="secondary" onPress={() => open()}>
          {t('streaming.preview.choose')}
        </Button>
      )}
      <ActionButton aria-label={t('common.close')} size="S" isQuiet onPress={close}>
        <Close />
      </ActionButton>
    </section>
  )
}
