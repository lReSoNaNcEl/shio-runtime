import { Heading, Link, Text } from '@react-spectrum/s2'
import { Component, type ReactNode } from 'react'
import { harden } from 'rehype-harden'
import { type Components, defaultRehypePlugins, Streamdown, type StreamdownProps } from 'streamdown'

import { observeRendererPromise } from '../../reliability/observePromise'

export function normalizeExternalHttpUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

const SAFE_REHYPE_PLUGINS = [
  defaultRehypePlugins.sanitize,
  [
    harden,
    {
      allowedLinkPrefixes: ['*'],
      allowedImagePrefixes: [],
      allowedProtocols: ['https:', 'http:'],
      allowDataImages: false,
      linkBlockPolicy: 'text-only',
      imageBlockPolicy: 'text-only',
    },
  ],
] satisfies NonNullable<StreamdownProps['rehypePlugins']>

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const safeUrl = normalizeExternalHttpUrl(href)
  if (!safeUrl) return <Text>{children}</Text>
  return (
    <Link
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      onPress={() =>
        observeRendererPromise(
          window.api.system.openExternalLink(safeUrl),
          'open external Markdown link',
        )
      }
    >
      {children}
    </Link>
  )
}

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <Text UNSAFE_className="markdown-paragraph">{children}</Text>,
  h1: ({ children }) => <Heading level={2}>{children}</Heading>,
  h2: ({ children }) => <Heading level={3}>{children}</Heading>,
  h3: ({ children }) => <Heading level={4}>{children}</Heading>,
  h4: ({ children }) => <Heading level={4}>{children}</Heading>,
  h5: ({ children }) => <Heading level={4}>{children}</Heading>,
  h6: ({ children }) => <Heading level={4}>{children}</Heading>,
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  ul: ({ children }) => <ul className="markdown-list markdown-list-unordered">{children}</ul>,
  ol: ({ children }) => <ol className="markdown-list markdown-list-ordered">{children}</ol>,
  li: ({ children }) => <li className="markdown-list-item">{children}</li>,
  blockquote: ({ children }) => <blockquote className="markdown-blockquote">{children}</blockquote>,
  inlineCode: ({ children }) => <code className="markdown-inline-code">{children}</code>,
  pre: ({ children }) => <pre className="markdown-code-block">{children}</pre>,
  code: ({ children, className }) => <code className={className}>{children}</code>,
  table: ({ children }) => (
    <div className="markdown-table-scroll">
      <table className="markdown-table">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th>{children}</th>,
  td: ({ children }) => <td>{children}</td>,
  img: ({ alt }) => (alt ? <Text UNSAFE_className="markdown-image-alt">{alt}</Text> : null),
}

export function PlaintextMessage({ text }: { text: string }) {
  return <Text UNSAFE_className="markdown-plaintext">{text}</Text>
}

interface MarkdownRenderErrorBoundaryProps {
  text: string
  children: ReactNode
}

interface MarkdownRenderErrorBoundaryState {
  failed: boolean
}

export class MarkdownRenderErrorBoundary extends Component<
  MarkdownRenderErrorBoundaryProps,
  MarkdownRenderErrorBoundaryState
> {
  state: MarkdownRenderErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): MarkdownRenderErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    console.error('[MarkdownMessage] Streamdown render failed; using plaintext fallback', error)
  }

  componentDidUpdate(previous: MarkdownRenderErrorBoundaryProps): void {
    if (this.state.failed && previous.text !== this.props.text) this.setState({ failed: false })
  }

  render(): ReactNode {
    if (this.state.failed) return <PlaintextMessage text={this.props.text} />
    return this.props.children
  }
}

export function MarkdownMessage({
  text,
  streaming = false,
}: {
  text: string
  streaming?: boolean
}) {
  return (
    <MarkdownRenderErrorBoundary text={text}>
      <Streamdown
        mode={streaming ? 'streaming' : 'static'}
        controls={false}
        linkSafety={{ enabled: false }}
        skipHtml
        rehypePlugins={SAFE_REHYPE_PLUGINS}
        urlTransform={(url, key) => (key === 'href' ? normalizeExternalHttpUrl(url) : null)}
        components={MARKDOWN_COMPONENTS}
        className="markdown-message"
      >
        {text}
      </Streamdown>
    </MarkdownRenderErrorBoundary>
  )
}
