# Agent Note: Browser tab status projection

Status: implemented

English | [中文](2026-08-21-web-tab-status-projection.zh.md)

## Problem

The shell already projected the selected session's durable title into the browser title. A user who starts a long turn and switches tabs had no way to tell from the tab strip whether the agent was still working or had finished minutes ago, which is exactly when the tab strip is the only surface they can see.

## Decision

**Status rides the existing title projection, not a second owner.** `DocumentTitle` takes a `status` alongside `title` and paints both the title prefix (`●` running, `✓` completed) and the favicon indicator dot in one effect, so the two can never disagree.

**Running is the session's own bit or any live job.** The shell selector reads `summary.running` or any job of that session in `running` / `stopping`. Its result is a fresh object each read, so it passes `shallowEqual`; without that, every unrelated session-list change re-renders the projection.

**Completed is a latch on the running-to-idle edge, cleared by attention or by switching away.** Window focus is the acknowledgement — the user has now seen it — and a session change resets rather than carries the latch, since a `✓` about a session you left is noise.

**Idle restores the icon the document shipped with.** The original href is recorded on the link element at the first paint and restored from there. The obvious `link.href = '/favicon.svg'` is a guess about the deployment's base path: under any non-root base it replaces a working icon with a 404, and it also silently overwrites a host page's own branding.

**The shell makes no sound.** A completion chime is a user preference, and the shell has no configuration seam to gate one: it is a pseudo entry mounted by the boot kernel, not a composed cordis.yml row, so a `Config` field on it could not be changed from a bundle. The optional `ui-activity-monitor` already owns a persisted sound preference (off by default), an 8-bit synthesizer, and exactly one mount per session that can sound a cue — so the cue lives there and the shell keeps only the silent, always-safe signals.

## Alternatives considered

**Give the app-shell a `Config` field for the chime.** Rejected: the app-shell entry is created by the boot kernel with no config, so the field would be a constant wearing a schema — precisely the hardcoded tunable the rule forbids.

**Keep an `ambient-sound` module in the shell, gated on a `localStorage` flag.** Rejected: it duplicates the activity monitor's synthesizer and preference, and a flag no surface can toggle is not an off switch. Its `getAudioContext` also resumed the context asynchronously and then checked `state !== 'running'` synchronously, so the first cue of every page was dropped by construction.

## Consequences

`packages/client/web` no longer ships `ambient-sound.ts` or exports `playAmbientSound`. A deployment without `ui-activity-monitor` gets the visual status and no sound. `updateFavicon` now stamps `data-dsh-original-href` on the icon link the first time it paints.
