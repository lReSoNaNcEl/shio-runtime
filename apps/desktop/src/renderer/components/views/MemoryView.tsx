import {
  ActionButton,
  Badge,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  InlineAlert,
  Picker,
  PickerItem,
  ProgressCircle,
  SearchField,
  Switch,
  Text,
  TextArea,
} from '@react-spectrum/s2'
import Add from '@react-spectrum/s2/icons/Add'
import Delete from '@react-spectrum/s2/icons/Delete'
import Edit from '@react-spectrum/s2/icons/Edit'
import { useEffect, useState } from 'react'

import { type TranslationKey } from '../../../shared/localization'
import {
  MEMORY_KINDS,
  type MemoryErrorCode,
  type MemoryKind,
  type MemoryRecord,
  type MemoryRuntimeStatus,
} from '../../../shared/memory'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

const KIND_KEYS: Record<MemoryKind, TranslationKey> = {
  fact: 'memory.kind.fact',
  preference: 'memory.kind.preference',
  decision: 'memory.kind.decision',
  commitment: 'memory.kind.commitment',
  relationship: 'memory.kind.relationship',
}

const ERROR_KEYS: Record<MemoryErrorCode, TranslationKey> = {
  MEMORY_DISABLED: 'memory.error.disabled',
  MEMORY_UNAVAILABLE: 'memory.error.unavailable',
  INVALID_REQUEST: 'memory.error.invalid',
  LIMIT_EXCEEDED: 'memory.error.limit',
  SOURCE_TURN_MISMATCH: 'memory.error.invalid',
  SENSITIVE_CONTENT: 'memory.error.sensitive',
  NOT_FOUND: 'memory.error.notFound',
  NO_CHANGES: 'memory.error.invalid',
}

type EditorState =
  | { mode: 'create'; kind: MemoryKind; text: string }
  | { mode: 'edit'; id: string; kind: MemoryKind; text: string }

function errorMessage(code: MemoryErrorCode, t: (key: TranslationKey) => string): string {
  return t(ERROR_KEYS[code])
}

export function MemoryView() {
  const { intlLocale, t } = useTranslation()
  const [status, setStatus] = useState<MemoryRuntimeStatus | null>(null)
  const [items, setItems] = useState<readonly MemoryRecord[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<MemoryKind | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [forgetTarget, setForgetTarget] = useState<MemoryRecord | null>(null)
  const [clearConfirmation, setClearConfirmation] = useState(false)

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      observeRendererPromise(
        Promise.all([
          window.api.memory.getStatus(),
          query.trim()
            ? window.api.memory.search({ query: query.trim(), limit: 20 })
            : window.api.memory.list({ kind: kind === 'all' ? undefined : kind, limit: 50 }),
        ]).then(([statusResult, recordsResult]) => {
          if (!active) return
          if (!statusResult.ok) throw new Error(errorMessage(statusResult.error.code, t))
          if (!recordsResult.ok) throw new Error(errorMessage(recordsResult.error.code, t))
          setStatus(statusResult.data)
          setItems(
            kind === 'all'
              ? recordsResult.data.items
              : recordsResult.data.items.filter((item) => item.kind === kind),
          )
          setError(null)
          setLoading(false)
        }),
        'load semantic long-term memory',
        (reason) => {
          if (!active) return
          setError(reason instanceof Error ? reason.message : t('memory.error.unavailable'))
          setLoading(false)
        },
      )
    }, 150)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [kind, query, t])

  const refresh = async (): Promise<void> => {
    const [statusResult, recordsResult] = await Promise.all([
      window.api.memory.getStatus(),
      query.trim()
        ? window.api.memory.search({ query: query.trim(), limit: 20 })
        : window.api.memory.list({ kind: kind === 'all' ? undefined : kind, limit: 50 }),
    ])
    if (!statusResult.ok) throw new Error(errorMessage(statusResult.error.code, t))
    if (!recordsResult.ok) throw new Error(errorMessage(recordsResult.error.code, t))
    setStatus(statusResult.data)
    setItems(
      kind === 'all'
        ? recordsResult.data.items
        : recordsResult.data.items.filter((item) => item.kind === kind),
    )
    setError(null)
  }

  const run = (operation: () => Promise<void>): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    observeRendererPromise(
      operation().finally(() => setBusy(false)),
      'manage semantic long-term memory',
      (reason) =>
        setError(reason instanceof Error ? reason.message : t('memory.error.unavailable')),
    )
  }

  const toggleEnabled = (enabled: boolean): void => {
    run(async () => {
      const result = await window.api.memory.setEnabled(enabled)
      if (!result.ok) throw new Error(errorMessage(result.error.code, t))
      setStatus(result.data)
    })
  }

  const saveEditor = (): void => {
    if (!editor?.text.trim()) return
    run(async () => {
      const result =
        editor.mode === 'create'
          ? await window.api.memory.create({ kind: editor.kind, text: editor.text.trim() })
          : await window.api.memory.update({
              id: editor.id,
              kind: editor.kind,
              text: editor.text.trim(),
            })
      if (!result.ok) throw new Error(errorMessage(result.error.code, t))
      setEditor(null)
      await refresh()
    })
  }

  const forget = (): void => {
    if (!forgetTarget) return
    run(async () => {
      const result = await window.api.memory.forget({ ids: [forgetTarget.id] })
      if (!result.ok) throw new Error(errorMessage(result.error.code, t))
      setForgetTarget(null)
      await refresh()
    })
  }

  const clearAll = (): void => {
    run(async () => {
      const result = await window.api.memory.clearAll()
      if (!result.ok) throw new Error(errorMessage(result.error.code, t))
      setClearConfirmation(false)
      await refresh()
    })
  }

  if (loading) {
    return (
      <div className="memory-loading page-container">
        <ProgressCircle isIndeterminate aria-label={t('common.loading')} />
      </div>
    )
  }

  return (
    <section className="memory-view page-container" aria-label={t('app.nav.memory')}>
      <div className="memory-toolbar">
        <Switch
          isSelected={status?.enabled ?? false}
          isDisabled={busy || !status?.operational}
          onChange={toggleEnabled}
        >
          {status?.enabled ? t('common.enabled') : t('common.disabled')}
        </Switch>
        <Button
          variant="accent"
          isDisabled={busy || !status?.operational}
          onPress={() => setEditor({ mode: 'create', kind: 'fact', text: '' })}
        >
          <Add />
          {t('memory.add')}
        </Button>
        <Button
          variant="negative"
          isDisabled={busy || items.length === 0 || !status?.operational}
          onPress={() => setClearConfirmation(true)}
        >
          {t('memory.clearAll')}
        </Button>
      </div>

      {!status?.operational && (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('memory.unavailable.title')}</Heading>
          <Content>{t('memory.unavailable.description')}</Content>
        </InlineAlert>
      )}
      {status?.operational && !status.enabled && (
        <InlineAlert variant="notice" fillStyle="subtleFill">
          <Heading>{t('memory.disabled.title')}</Heading>
          <Content>{t('memory.disabled.description')}</Content>
        </InlineAlert>
      )}
      {error && (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('common.error')}</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      )}

      <div className="memory-filters">
        <SearchField
          aria-label={t('memory.search')}
          placeholder={t('memory.searchPlaceholder')}
          value={query}
          onChange={setQuery}
        />
        <Picker
          aria-label={t('memory.category')}
          selectedKey={kind}
          onSelectionChange={(key) => setKind(String(key) as MemoryKind | 'all')}
        >
          <PickerItem id="all">{t('memory.kind.all')}</PickerItem>
          {MEMORY_KINDS.map((item) => (
            <PickerItem id={item} key={item}>
              {t(KIND_KEYS[item])}
            </PickerItem>
          ))}
        </Picker>
      </div>

      <Text UNSAFE_className="memory-count">
        {t('memory.count', { count: status?.recordCount ?? items.length })}
      </Text>
      {items.length === 0 ? (
        <div className="memory-empty">
          <Heading level={2}>{t('memory.empty.title')}</Heading>
          <Text>{t(query.trim() ? 'memory.empty.search' : 'memory.empty.description')}</Text>
        </div>
      ) : (
        <div className="memory-grid">
          {items.map((item) => (
            <article className="memory-card" key={item.id}>
              <div className="memory-card-heading">
                <Badge size="S" variant="informative">
                  {t(KIND_KEYS[item.kind])}
                </Badge>
                <div className="memory-card-actions">
                  <ActionButton
                    isQuiet
                    aria-label={t('memory.edit')}
                    isDisabled={busy}
                    onPress={() =>
                      setEditor({
                        mode: 'edit',
                        id: item.id,
                        kind: item.kind,
                        text: item.text,
                      })
                    }
                  >
                    <Edit />
                  </ActionButton>
                  <ActionButton
                    isQuiet
                    aria-label={t('memory.forget')}
                    isDisabled={busy}
                    onPress={() => setForgetTarget(item)}
                  >
                    <Delete />
                  </ActionButton>
                </div>
              </div>
              <Text UNSAFE_className="memory-card-text">{item.text}</Text>
              <Text UNSAFE_className="memory-card-source">
                {t(
                  item.source.type === 'conversation'
                    ? 'memory.source.conversation'
                    : 'memory.source.manual',
                )}{' '}
                ·{' '}
                {new Intl.DateTimeFormat(intlLocale, { dateStyle: 'medium' }).format(
                  new Date(item.updatedAt),
                )}
              </Text>
            </article>
          ))}
        </div>
      )}

      <DialogContainer onDismiss={() => !busy && setEditor(null)}>
        {editor && (
          <Dialog size="M" aria-label={t(editor.mode === 'create' ? 'memory.add' : 'memory.edit')}>
            <Heading>
              {t(editor.mode === 'create' ? 'memory.addTitle' : 'memory.editTitle')}
            </Heading>
            <Content>
              <div className="memory-editor">
                <Picker
                  label={t('memory.category')}
                  selectedKey={editor.kind}
                  onSelectionChange={(key) =>
                    setEditor((current) =>
                      current ? { ...current, kind: String(key) as MemoryKind } : current,
                    )
                  }
                >
                  {MEMORY_KINDS.map((item) => (
                    <PickerItem id={item} key={item}>
                      {t(KIND_KEYS[item])}
                    </PickerItem>
                  ))}
                </Picker>
                <TextArea
                  label={t('memory.text')}
                  value={editor.text}
                  maxLength={500}
                  onChange={(text) =>
                    setEditor((current) => (current ? { ...current, text } : current))
                  }
                />
              </div>
            </Content>
            <ButtonGroup slot="buttonGroup">
              <Button variant="secondary" isDisabled={busy} onPress={() => setEditor(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="accent"
                isDisabled={busy || !editor.text.trim()}
                onPress={saveEditor}
              >
                {t('common.save')}
              </Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>

      <DialogContainer onDismiss={() => !busy && setForgetTarget(null)}>
        {forgetTarget && (
          <Dialog size="M" aria-label={t('memory.forgetTitle')}>
            <Heading>{t('memory.forgetTitle')}</Heading>
            <Content>
              <Text>{t('memory.forgetDescription')}</Text>
            </Content>
            <ButtonGroup slot="buttonGroup">
              <Button variant="secondary" isDisabled={busy} onPress={() => setForgetTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="negative" isDisabled={busy} onPress={forget}>
                {t('memory.forget')}
              </Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>

      <DialogContainer onDismiss={() => !busy && setClearConfirmation(false)}>
        {clearConfirmation && (
          <Dialog size="M" aria-label={t('memory.clearTitle')}>
            <Heading>{t('memory.clearTitle')}</Heading>
            <Content>
              <Text>{t('memory.clearDescription')}</Text>
            </Content>
            <ButtonGroup slot="buttonGroup">
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => setClearConfirmation(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button variant="negative" isDisabled={busy} onPress={clearAll}>
                {t('memory.clearAll')}
              </Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
    </section>
  )
}
