// HtmlPreviewBlock: renders ```html fences with a secure, sandboxed preview
// iframe (sandbox="allow-scripts" without allow-same-origin) and source toggle.
// Preview is off by default behind explicit user click.

import { useCallback, useMemo, useState } from 'react'
import clsx from 'clsx'
import { writeClipboard } from '../clipboard.ts'
import { CodeBlock } from './CodeBlock.tsx'
import css from './HtmlPreviewBlock.module.css'

export interface HtmlPreviewBlockProps {
  code: string
  copyLabel?: string | undefined
  copiedLabel?: string | undefined
  className?: string | undefined
}

const CSP_META = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; style-src \'unsafe-inline\'; img-src data: blob: https:; font-src data: https:; connect-src \'none\';">'

function prepareSandboxedDoc(html: string): string {
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head>${CSP_META}`)
  }
  return `<!DOCTYPE html><html><head>${CSP_META}</head><body>${html}</body></html>`
}

export function HtmlPreviewBlock({
  code,
  copyLabel = '复制',
  copiedLabel = '复制成功',
  className,
}: HtmlPreviewBlockProps) {
  const [mode, setMode] = useState<'source' | 'preview'>('source')
  const [copied, setCopied] = useState(false)

  const trimmed = useMemo(() => (code.endsWith('\n') ? code.slice(0, -1) : code), [code])
  const srcDoc = useMemo(() => prepareSandboxedDoc(trimmed), [trimmed])

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(trimmed).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, trimmed])

  return (
    <div className={clsx(css.container, className)}>
      <div className={css.banner}>
        <div className={css.pill}>HTML</div>
        <div className={css.actions}>
          {mode === 'source' ? (
            <button
              type="button"
              className={css.button}
              onClick={() => { setMode('preview') }}
            >
              运行预览
            </button>
          ) : (
            <button
              type="button"
              className={css.button}
              onClick={() => { setMode('source') }}
            >
              查看源码
            </button>
          )}
          <button type="button" className={css.button} onClick={onCopy}>
            {copied ? copiedLabel : copyLabel}
          </button>
        </div>
      </div>
      {mode === 'preview' ? (
        <div className={css.previewWrap}>
          <iframe
            className={css.frame}
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            referrerPolicy="no-referrer"
            title="HTML Preview"
          />
        </div>
      ) : (
        <CodeBlock code={code} lang="html" copyLabel={copyLabel} copiedLabel={copiedLabel} />
      )}
    </div>
  )
}
