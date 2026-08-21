// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'

afterEach(() => {
  cleanup()
  document.title = ''
  const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
  if (link) link.remove()
  vi.unstubAllEnvs()
})

describe('DocumentTitle', () => {
  it('projects a durable title and restores the product title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'DeepSeek Harness')
    document.title = 'stale title'
    const mounted = render(<DocumentTitle />)
    expect(document.title).toBe('DeepSeek Harness')
    mounted.rerender(<DocumentTitle title="First title" />)
    expect(document.title).toBe('First title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle title="Revised title" />)
    expect(document.title).toBe('Revised title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle />)
    expect(document.title).toBe('DeepSeek Harness')
    mounted.unmount()
    expect(document.title).toBe('DeepSeek Harness')
  })

  it('uses the generic title when the build provides no title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', '')
    delete process.env.DSH_CLIENT_TITLE
    const mounted = render(<DocumentTitle title="First title" />)
    expect(document.title).toBe('First title — DSH Local Build')
    mounted.unmount()
    expect(document.title).toBe('DSH Local Build')
  })

  it('projects running and completed status prefixes onto the title and favicon', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'DeepSeek Harness')
    const mounted = render(<DocumentTitle title="My Task" status="running" />)
    expect(document.title).toBe('● My Task — DeepSeek Harness')
    const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
    expect(link?.getAttribute('href')).toContain('data:image/svg+xml')

    mounted.rerender(<DocumentTitle title="My Task" status="completed" />)
    expect(document.title).toBe('✓ My Task — DeepSeek Harness')
    expect(link?.getAttribute('href')).toContain('data:image/svg+xml')

    mounted.rerender(<DocumentTitle title="My Task" status="idle" />)
    expect(document.title).toBe('My Task — DeepSeek Harness')
    // The document shipped no icon link, so idle leaves none behind.
    expect(link?.getAttribute('href')).toBeNull()
  })

  it("restores the document's own icon rather than a guessed path", () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'DeepSeek Harness')
    const shipped = document.createElement('link')
    shipped.rel = 'icon'
    // A deployment under a non-root base path: restoring '/favicon.svg'
    // would 404.
    shipped.setAttribute('href', '/console/assets/brand.svg')
    document.head.appendChild(shipped)

    const mounted = render(<DocumentTitle title="My Task" status="running" />)
    expect(shipped.getAttribute('href')).toContain('data:image/svg+xml')

    mounted.unmount()
    expect(shipped.getAttribute('href')).toBe('/console/assets/brand.svg')
  })

  it('invokes onAcknowledgeCompletion on window focus when status is completed', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'DeepSeek Harness')
    const onAcknowledge = vi.fn()
    render(<DocumentTitle title="My Task" status="completed" onAcknowledgeCompletion={onAcknowledge} />)
    expect(onAcknowledge).not.toHaveBeenCalled()

    fireEvent.focus(window)
    expect(onAcknowledge).toHaveBeenCalledTimes(1)
  })
})
