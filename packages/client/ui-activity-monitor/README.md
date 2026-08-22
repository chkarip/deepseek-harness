# @deepseek-ai/dsh-client-ui-activity-monitor

English | [中文](README.zh.md)

A pixel-art agent mascot and a live activity monitor for the current session.

The plugin registers two surfaces:

1. `conversation.session.header.utilities` — `ActivityHeaderPill`, a compact avatar beside one readout: the mascot's happiness while nothing runs, and the current request's estimated token total while one does. Clicking it opens the mascot playground and the telemetry panel. This is the mascot's only always-mounted surface; there is deliberately no second mascot near the composer.
2. `conversation.view` — `ActivityMonitorView`, a full tab with the throughput sparkline, the turn-execution pipeline, the context and cache gauges, and the skin picker.

The `/client` entry exports the plugin (`apply` / `inject`), the components, the canvas renderer, the telemetry hooks, and the mascot store.

## Two accounting planes

Nothing in this package invents a number, and the two sources of figures are never mixed:

- **Estimates** — the sparkline, the header pill's token total, and the mascot's "tokens fed" come from `useLiveTelemetry`, which approximates tokens from streamed character counts (the browser never sees provider token accounting). Their copy says so.
- **Provider-reported** — the pipeline view's timing row and gauges read the durable `sessionStats`, `tokenUsage`, and `contextPressure` projections. A gauge whose projection has served no value is omitted, never defaulted: an occupancy percentage against an assumed context window would read as a measurement while being a guess.

## Mascot store

`tamagotchiStore` holds the mascot's stats and the user's skin and sound preferences, mirrored to `localStorage` under `dsh:activity-monitor:tamagotchi`. It is deliberately a module-level singleton outside the plugin's disposal lifecycle: every value in it is per-browser user preference that must survive plugin disposal and remounting, exactly like the record backing it. Writes are coalesced to at most one storage write every two seconds, plus a flush on `pagehide`, so streaming token deltas do not put a synchronous serialize on every frame.

Sound is off by default. When it is on, the header pill — and only the pill, since both surfaces would otherwise sound their own — plays one 8-bit cue as a turn settles.

## Model Experience

None, as every surface here renders browser-side state; nothing it registers reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Per-browser persistence** — mascot stats and preferences live in one browser's `localStorage`. They do not follow the user to another browser or device, and they are not part of the session log.
- **Estimated throughput only** — the live sparkline cannot be provider-anchored, because tokenization is not observable from streamed text. The provider-reported decode rate in the pipeline view is whole-session, not live.
