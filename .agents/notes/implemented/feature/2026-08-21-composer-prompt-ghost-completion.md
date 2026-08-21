# Agent Note: Composer prompt ghost completion

Status: implemented

English | [中文](2026-08-21-composer-prompt-ghost-completion.zh.md)

## Problem

Re-running a prompt meant retyping it. The composer already owns a decoration backdrop behind the textarea glyphs — the layer that paints claim tokens, chips, and the claim hint — so an inline completion had somewhere to render, but nothing recorded what the user had sent and nothing decided how a completion should share the caret with the overlays already living there.

## Decision

**Suggestions are the user's own prompts and nothing else.** `PromptHistory` holds a most-recent-first ring capped at 100, de-duplicated on record. It ships no authored starter prompts: authored suggestions would be untranslated product copy rendered into a Chinese user's composer, and a suggestion nobody wrote is a worse guess than no suggestion.

**The store is plugin-owned, and its storage is a constructor argument.** `apply()` constructs one `PromptHistory` over `browserPromptStorage()` and hands it to `InputHub` and to the composer bar's injected face. A module-level singleton reaching for `window.localStorage` would put a hidden storage write inside `InputHub.sink` — which is what made the hub untestable without a DOM — and would leave the ring outside any disposal story. `InputHub` records only what the sink accepts, so a rejected empty submission leaves no trace.

**The bar reads a function, not a module.** `ComposerBarInjected.promptGhost` is `(draft) => string | null`. The bar stays a pure function of its props, an assembly that wants no completions supplies one that returns null, and tests seed a ring without touching storage.

**The ghost is the bottom of the composer's overlay stack.** A claim hint and an open command menu each own the space behind the caret and each own Escape. The ghost is suppressed while either stands, and Escape reaches it only after `dismissPopup()` and `arbitrate('escape')` have both declined — so dismissing a ghost can never swallow an overlay's Escape. The dismissal lasts until the next keystroke.

**ArrowRight accepts; Tab does not.** A ghost stands for most of what anyone types, so binding Tab would take the focus key away from the whole composer for the sake of a suggestion. ArrowRight only accepts at the end of the draft, where it has no caret movement to perform.

## Alternatives considered

**Ship default prompt templates for an empty history.** Rejected: they are authored English copy on a bilingual surface, and the plugin has no way to translate a suggestion the user might accept and send.

**Keep the module-level functions and add a reset hook for tests.** Rejected: a test hook is not an injection seam. The exported `getPromptHistory` / `clearPromptHistory` existed only for tests, which knip would flag and AGENTS.md forbids.

**Scope the ring per workspace.** Deferred. A shell history that follows the user across sessions is the familiar behavior, and per-workspace scoping needs a key derivation the composer does not currently have. Anything typed into a composer is already the user's own text on their own machine.

## Consequences

`ComposerBarInjected` gained a required member, so every bench that builds bar props by hand supplies one. `InputHub`'s constructor takes an optional third argument; omitting it disables recording without disabling anything else. Prompt history lives in one browser's `localStorage` and is not part of the session log.
