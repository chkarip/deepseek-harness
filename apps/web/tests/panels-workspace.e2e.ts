// Web e2e: the named multi-panel chat workspace. Keyless — zero model calls:
// panel chrome, session binding through the picker, tiled/tabbed switching,
// rename, close, and persistence across reload all ride pure client state
// plus host session-list RPCs. The zero-panel fallback is asserted first, so
// the panels surface is proven additive (the ordinary single conversation is
// untouched until a panel exists).
import type { Locator } from 'playwright'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FRAME_SELECTOR = 'section[data-panel-id]'

/** Count poll — the lane's wait-for-count idiom (vanilla vitest + locator reads). */
async function settleCount(locator: Locator, expected: number, timeout = 10_000): Promise<void> {
  await expect.poll(() => locator.count(), { timeout }).toBe(expected)
}

describe('web e2e: named multi-panel chat workspace', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows the panels toolbar with zero panels while the single conversation stays', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-panels-zero'))
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    // The toolbar is discoverable before any panel exists.
    await page.getByRole('button', { name: 'Add panel', exact: true }).waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Tiled', exact: true }).waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Tabbed', exact: true }).waitFor({ timeout: 10_000 })
    // Zero panels: the ordinary single conversation (one enabled composer).
    expect(await page.locator(FRAME_SELECTOR).count()).toBe(0)
    await settleCount(page.locator('textarea:enabled'), 1)
  })

  it('adds a panel, binds a conversation through the picker, and hosts a live composer', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-panels-add'))
    await page.getByRole('button', { name: 'Add panel', exact: true }).click()
    await settleCount(page.locator(FRAME_SELECTOR), 1)
    // The fresh panel opens its session picker automatically.
    const picker = page.getByRole('menu', { name: 'Choose session' })
    await picker.waitFor({ timeout: 10_000 })
    // No false affordance: the blank focused session has no history to
    // branch from, so the shared-context fork row stays hidden.
    expect(await picker.getByRole('menuitem', { name: /Branch from current/ }).count()).toBe(0)
    await picker.getByRole('menuitem', { name: 'New conversation' }).click()
    // The panel got a freshly created session in the workspace: its composer
    // is enabled and it is the only conversation (the fallback is gone).
    await page.locator(FRAME_SELECTOR).locator('textarea:enabled').waitFor({ timeout: 15_000 })
    await settleCount(page.locator('textarea:enabled'), 1)
  })

  it('tiles a second panel beside the first and switches between layouts', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-panels-layout'))
    await page.getByRole('button', { name: 'Add panel', exact: true }).click()
    await settleCount(page.locator(FRAME_SELECTOR), 2)
    // Mirror guard: an unbound panel shows its own empty state — never the
    // focused conversation (no enabled composer inside it).
    const second = page.locator(FRAME_SELECTOR).nth(1)
    await second.locator('[data-panel-empty]').waitFor({ timeout: 10_000 })
    expect(await second.locator('textarea:enabled').count()).toBe(0)
    // Dismiss the auto-opened picker (wait for it first: the auto-open rides
    // a mount effect, and a human cannot beat the effect flush), then bind
    // the second panel through its session chip. "New conversation" births a
    // FRESH session each time, so the two panels must host DISTINCT chats.
    const autoPicker = page.getByRole('menu', { name: 'Choose session' })
    await autoPicker.waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await autoPicker.waitFor({ state: 'hidden', timeout: 10_000 })
    await second.getByRole('button', { name: 'No session' }).click()
    const secondPicker = page.getByRole('menu', { name: 'Choose session' })
    await secondPicker.waitFor({ timeout: 10_000 })
    await secondPicker.getByRole('menuitem', { name: 'New conversation' }).click()
    await second.locator('textarea:enabled').waitFor({ timeout: 15_000 })
    // Both panels now host enabled composers side by side.
    await settleCount(page.locator(FRAME_SELECTOR).locator('textarea:enabled'), 2)
    // Parallel-work proof: the two panels are bound to different sessions.
    const boundIds = await page.locator(FRAME_SELECTOR).evaluateAll(frames =>
      frames.map(frame => frame.getAttribute('data-session-id')))
    expect(boundIds).toHaveLength(2)
    expect(boundIds[0]).toBeTruthy()
    expect(boundIds[1]).toBeTruthy()
    expect(boundIds[0]).not.toBe(boundIds[1])
    // Tabbed mode collapses to one visible frame plus a tab strip.
    await page.getByRole('button', { name: 'Tabbed', exact: true }).click()
    await settleCount(page.locator(FRAME_SELECTOR), 1)
    await settleCount(page.getByRole('tab'), 2)
    await page.getByRole('button', { name: 'Tiled', exact: true }).click()
    await settleCount(page.locator(FRAME_SELECTOR), 2)
  })

  it('renames a panel and closes its sibling', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-panels-rename'))
    const first = page.locator(FRAME_SELECTOR).first()
    await first.getByRole('button', { name: 'Panel 1', exact: true }).click()
    const input = first.getByRole('textbox', { name: 'Panel name' })
    await input.fill('review')
    await input.press('Enter')
    await first.getByRole('button', { name: 'review', exact: true }).waitFor({ timeout: 10_000 })
    await page.locator(FRAME_SELECTOR).nth(1).getByRole('button', { name: /Close panel/ }).click()
    await settleCount(page.locator(FRAME_SELECTOR), 1)
  })

  it('persists the panel workspace across a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-panels-reload'))
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await settleCount(page.locator(FRAME_SELECTOR), 1)
    await page.locator(FRAME_SELECTOR).first()
      .getByRole('button', { name: 'review', exact: true }).waitFor({ timeout: 10_000 })
  })

  it('automatically forks when picking a session that is already open in another panel', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-panels-autofork'))
    const panel1SessionId = await page.locator(FRAME_SELECTOR).first().getAttribute('data-session-id')
    expect(panel1SessionId).toBeTruthy()

    await page.getByRole('button', { name: 'Add panel', exact: true }).click()
    await settleCount(page.locator(FRAME_SELECTOR), 2)
    const second = page.locator(FRAME_SELECTOR).nth(1)

    const picker = page.getByRole('menu', { name: 'Choose session' })
    await picker.waitFor({ timeout: 10_000 })

    // Pick the session row that is currently bound to Panel 1
    const row = picker.getByRole('menuitem', { name: /review/ })
    await row.click()

    // Second panel should be bound to a distinct forked session ID, preventing mirroring
    await expect.poll(async () => second.getAttribute('data-session-id'), { timeout: 10_000 })
      .not.toBe(panel1SessionId)
    const secondSessionId = await second.getAttribute('data-session-id')
    expect(secondSessionId).toBeTruthy()

    await second.getByRole('button', { name: /Close panel/ }).click()
    await settleCount(page.locator(FRAME_SELECTOR), 1)
  })

  it('leaves a clean console', () => {
    expect(tripwire.pageErrors).toEqual([])
  })
})
