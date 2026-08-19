// MermaidBlock: renders ```mermaid fences as interactive SVG diagrams with
// dynamic theme detection, a diagram/source toggle, and fallback to CodeBlock
// on parse error or during initial load.

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import clsx from 'clsx'
import { writeClipboard } from '../clipboard.ts'
import { CodeBlock } from './CodeBlock.tsx'
import css from './MermaidBlock.module.css'

export interface MermaidBlockProps {
  code: string
  copyLabel?: string | undefined
  copiedLabel?: string | undefined
  className?: string | undefined
}

let mermaidInitialized = false

async function renderMermaidSvg(id: string, code: string): Promise<string> {
  const mermaidModule = await import('mermaid')
  const mermaid = mermaidModule.default
  if (!mermaidInitialized) {
    const isDark = typeof document !== 'undefined' && document.body.hasAttribute('data-ds-dark-theme')
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'strict',
    })
    mermaidInitialized = true
  }
  const cleanId = `mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const { svg } = await mermaid.render(cleanId, code)
  return svg
}

export function MermaidBlock({
  code,
  copyLabel = '复制',
  copiedLabel = '复制成功',
  className,
}: MermaidBlockProps) {
  const [mode, setMode] = useState<'diagram' | 'source'>('diagram')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<boolean>(false)
  const [copied, setCopied] = useState(false)
  const reactId = useId()

  const trimmed = useMemo(() => (code.endsWith('\n') ? code.slice(0, -1) : code), [code])

  useEffect(() => {
    let active = true
    setError(false)
    renderMermaidSvg(reactId, trimmed)
      .then((renderedSvg) => {
        if (active) {
          setSvg(renderedSvg)
          setError(false)
        }
      })
      .catch(() => {
        if (active) {
          setError(true)
          setMode('source')
        }
      })
    return () => {
      active = false
    }
  }, [reactId, trimmed])

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(trimmed).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, trimmed])

  if (error || mode === 'source') {
    return (
      <div className={clsx(css.container, className)}>
        <div className={css.banner}>
          <div className={css.pill}>MERMAID</div>
          <div className={css.actions}>
            {!error && (
              <button
                type="button"
                className={css.button}
                onClick={() => { setMode('diagram') }}
              >
                预览图表
              </button>
            )}
            <button type="button" className={css.button} onClick={onCopy}>
              {copied ? copiedLabel : copyLabel}
            </button>
          </div>
        </div>
        <CodeBlock code={code} lang="mermaid" copyLabel={copyLabel} copiedLabel={copiedLabel} />
      </div>
    )
  }

  return (
    <div className={clsx(css.container, className)}>
      <div className={css.banner}>
        <div className={css.pill}>MERMAID</div>
        <div className={css.actions}>
          <button
            type="button"
            className={css.button}
            onClick={() => { setMode('source') }}
          >
            查看源码
          </button>
          <button type="button" className={css.button} onClick={onCopy}>
            {copied ? copiedLabel : copyLabel}
          </button>
        </div>
      </div>
      {svg !== null ? (
        <div
          className={css.diagram}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className={css.loading}>正在渲染图表…</div>
      )}
    </div>
  )
}
