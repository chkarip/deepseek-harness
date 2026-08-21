# Agent Note: Activity monitor and mascot plugin

Status: implemented

English | [中文](2026-08-21-web-activity-monitor-mascot.zh.md)

## Problem

A running turn showed as a spinner and a stats line. Nothing told a watching user what phase the agent was in, how fast it was decoding, or how much of the context window the conversation had eaten — and nothing made waiting for a long turn pleasant. Both wants are real, and both are optional: neither belongs in `ui-conversation`, which every assembly composes.

## Decision

**One optional plugin, three slot entries, no owner changes.** `ui-activity-monitor` registers into `conversation.session.header.utilities`, `conversation.input.dock`, and `conversation.view`. Each registration is a `ctx.effect` disposed with the fiber; `ui-conversation` is unaware of it.

**Components read the session through the standard kit.** All three slots are session-scope, so each entry receives `useSession`, `sessionId`, and `useProjection`. Reading the list store and reaching for a session object instead would bypass the framework's per-session binding — and, as written, would read a field the list rows do not carry, leaving the whole feature inert while typechecking as if it worked.

**Estimated and provider-reported figures never mix.** The sparkline, the header badge, and "tokens fed" are derived in the browser by approximating tokens from streamed character counts, and their copy says so. The pipeline view's timing row and gauges come from `sessionStats`, `tokenUsage`, and `contextPressure`. A gauge whose projection has served no value is omitted: an occupancy percentage computed against an assumed 128k window would render as a measurement while being a guess, and a `null` TTFT rendered as a field is a promise the data never keeps.

**The mascot store is a module-level singleton on purpose, and the invariant companion says so.** Everything in it is per-browser user preference backed by `localStorage`, so it must outlive plugin disposal exactly as the storage record does. There is no owned relationship for an invariant to assert; claiming disposal safety it does not have would be worse than an explained empty companion. Storage writes are coalesced to at most one every two seconds plus a `pagehide` flush, because streaming credits token deltas at frame rate.

**Only the dock sounds the completion cue.** All three surfaces render the same mascot from the same hook, so a cue inside the shared hook would fire once per mounted surface. `useCompletionCue` is a separate export the dock alone calls, and it is gated on the sound preference, which defaults to off.

## Alternatives considered

**Put the telemetry in `ui-conversation`'s stats line.** Rejected: the stats line is a settled-node summary that deliberately does not re-render on stream deltas. A live sparkline wants the opposite, and forcing both into one row would cost every assembly the re-render.

**Give the mascot store the plugin's lifecycle and thread it through slot `inject`.** Rejected for now: the store holds only preferences, and tying preferences to a fiber would reset a user's skin on every HMR reload. The invariant companion documents the exemption rather than pretending it does not exist.

**Make the mascot celebrate by leaving the `success` sprite up after a turn.** Deferred: the settled stage persists for as long as the session sits idle, so a permanent "Task accomplished!" is wrong. A timed transient state needs a timer the hook does not currently own.

## Consequences

`ui-activity-monitor` depends on `dsh-session-stats` and `dsh-token-meter` for their projection-key merges only (type-only imports). The web-app bundle mounts it by default, so its copy is fully bilingual; assemblies that do not want it drop one patch row. Mascot stats live in one browser and are never part of the session log.
