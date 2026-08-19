// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownText } from '../src/index.ts'

afterEach(cleanup)

describe('Markdown rich semantic constructs', () => {
  describe('GFM Alert Callouts', () => {
    it('renders [!NOTE] alert with note title and icon', () => {
      const markdown = '> [!NOTE]\n> This is an important note.'
      const { container } = render(<MarkdownText text={markdown} />)
      const alert = container.querySelector('[data-alert-type="note"]')
      expect(alert).not.toBeNull()
      expect(alert!.textContent).toContain('Note')
      expect(alert!.textContent).toContain('This is an important note.')
    })

    it('renders [!TIP] alert with tip title and icon', () => {
      const markdown = '> [!TIP]\n> Helpful advice here.'
      const { container } = render(<MarkdownText text={markdown} />)
      const alert = container.querySelector('[data-alert-type="tip"]')
      expect(alert).not.toBeNull()
      expect(alert!.textContent).toContain('Tip')
      expect(alert!.textContent).toContain('Helpful advice here.')
    })

    it('renders [!IMPORTANT] alert', () => {
      const markdown = '> [!IMPORTANT]\n> Crucial detail.'
      const { container } = render(<MarkdownText text={markdown} />)
      const alert = container.querySelector('[data-alert-type="important"]')
      expect(alert).not.toBeNull()
      expect(alert!.textContent).toContain('Important')
      expect(alert!.textContent).toContain('Crucial detail.')
    })

    it('renders [!WARNING] alert', () => {
      const markdown = '> [!WARNING]\n> Proceed with caution.'
      const { container } = render(<MarkdownText text={markdown} />)
      const alert = container.querySelector('[data-alert-type="warning"]')
      expect(alert).not.toBeNull()
      expect(alert!.textContent).toContain('Warning')
      expect(alert!.textContent).toContain('Proceed with caution.')
    })

    it('renders [!CAUTION] alert', () => {
      const markdown = '> [!CAUTION]\n> Danger ahead.'
      const { container } = render(<MarkdownText text={markdown} />)
      const alert = container.querySelector('[data-alert-type="caution"]')
      expect(alert).not.toBeNull()
      expect(alert!.textContent).toContain('Caution')
      expect(alert!.textContent).toContain('Danger ahead.')
    })

    it('renders regular blockquote when not matching alert syntax', () => {
      const markdown = '> Just a standard blockquote.'
      const { container } = render(<MarkdownText text={markdown} />)
      expect(container.querySelector('[data-alert-type]')).toBeNull()
      const blockquote = container.querySelector('blockquote')
      expect(blockquote).not.toBeNull()
      expect(blockquote!.textContent).toContain('Just a standard blockquote.')
    })
  })

  describe('Collapsible <details> / <summary> sections', () => {
    it('renders native details and summary elements', () => {
      const markdown = '<details><summary>Click to view</summary>\nDetailed content inside.\n</details>'
      const { container } = render(<MarkdownText text={markdown} />)
      const details = container.querySelector('details')
      expect(details).not.toBeNull()
      const summary = details!.querySelector('summary')
      expect(summary).not.toBeNull()
      expect(summary!.textContent).toBe('Click to view')
      expect(details!.textContent).toContain('Detailed content inside.')
    })
  })

  describe('Interactive Footnotes with same-document fragment anchors', () => {
    it('renders sup link with targetId and section backlink with refId', () => {
      const markdown = 'Here is a reference[^1].\n\n[^1]: Footnote content here.'
      const { container } = render(<MarkdownText text={markdown} />)
      const sup = container.querySelector('sup#user-content-fnref-1-1')
      expect(sup).not.toBeNull()
      const refLink = sup!.querySelector('a')
      expect(refLink).not.toBeNull()
      expect(refLink!.getAttribute('href')).toBe('#user-content-fn-1')

      const footnoteSection = container.querySelector('section[data-footnotes]')
      expect(footnoteSection).not.toBeNull()
      const footnoteItem = footnoteSection!.querySelector('li#user-content-fn-1')
      expect(footnoteItem).not.toBeNull()
      const backLink = footnoteItem!.querySelector('a[href="#user-content-fnref-1-1"]')
      expect(backLink).not.toBeNull()
      expect(backLink!.textContent).toContain('↩')
    })
  })

  describe('HTML Artifact Sandbox Preview', () => {
    it('renders code block by default with a Run Preview button', () => {
      const htmlSnippet = '```html\n<h1>Hello Sandbox</h1>\n```'
      const { container } = render(<MarkdownText text={htmlSnippet} />)
      expect(container.querySelector('button')).not.toBeNull()
      expect(container.textContent).toContain('运行预览')
      // No iframe by default
      expect(container.querySelector('iframe')).toBeNull()

      // Click to preview
      const previewBtn = screen.getByText('运行预览')
      fireEvent.click(previewBtn)

      // Iframe should be present with strict sandbox attributes
      const iframe = container.querySelector('iframe')
      expect(iframe).not.toBeNull()
      expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts')
      expect(iframe!.getAttribute('referrerpolicy')).toBe('no-referrer')
      expect(iframe!.getAttribute('srcdoc')).toContain('Content-Security-Policy')
      expect(iframe!.getAttribute('srcdoc')).toContain('<h1>Hello Sandbox</h1>')
    })
  })

  describe('Mermaid Diagram Block', () => {
    it('renders mermaid fence with diagram container and source toggle', () => {
      const mermaidCode = '```mermaid\ngraph TD;\nA-->B;\n```'
      const { container } = render(<MarkdownText text={mermaidCode} />)
      expect(container.textContent).toContain('MERMAID')
      expect(container.textContent).toContain('查看源码')
    })
  })
})
