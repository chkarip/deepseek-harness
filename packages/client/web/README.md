# @deepseek-ai/dsh-client-web

English | [中文](README.zh.md)

Web shell kernel: `new AppWebEntry(el, seams?).run()` mounts the whole client through the two-stage boot (web2). Stage one (module face): build the client module system (`@deepseek-ai/dsh-client-modules`) over the host-pushed entry graph (`window.__DSH_BOOT__`) and prefetch the `immediately` tier in parallel — bundle execution registers factories only. Stage two (plugin face): mount the vendored cordis Loader with the module system injected through its `internal` contract, create one loader entry per graph row plus the shell-own app-shell assembly entry (tree.import materializes each module), and gate AppRoot on the settle (loader quiesced + every entry fiber ACTIVE → full UI in one switch). Composition is entirely the host graph's: the roster and the immediately tier live in the composing app; the shell makes zero composition decisions.

Shell self-sufficiency (web2 hard rule): the kernel value-imports no plugin package — the boot status store and signals are hand-rolled here (`loader-status.ts`), so the loading page works while (and especially when) plugins fail. The app-shell assembly (`@deepseek-ai/dsh-client-app-shell`, a shell-owned pseudo entry with no npm package behind it) is the only module registered through `registerStatic`; it inject-waits on slots/sessions/layout like any plugin.

`PLATFORM_MODULES` (src/platform.ts) is the single source of truth for shared modules: seed-table keys, tsdown client externals, and the Vite alias set are its projections.

The optional override parameter `seams` forwards the module system's `loadBundle` transport override (`BootSeams`) for environments where external `<script>` execution cannot reach the page context; ordinary browser callers omit it.

The shell owns browser-title projection. With a selected session carrying a durable title, it renders `<session title> — <existing HTML title>` and reacts to later title revisions; no selection or a selected untitled session preserves the existing title, and shell unmount restores it. The existing HTML title remains the configurable product suffix.

The same projection carries the selected session's execution status onto the tab, so a backgrounded tab shows whether its agent is still working. `running` (the session's own running bit, or any of its jobs running or stopping) prefixes the title with `●` and paints a blue dot on the favicon; the running-to-idle edge latches `completed`, which shows `✓` and a green dot until the window regains focus. Switching sessions clears the latch rather than carrying it across. The idle icon is the href the document shipped with, recorded on the link element at the first paint — restoring a guessed `/favicon.svg` would 404 under any non-root base path. The shell plays no sound; the optional [`ui-activity-monitor`](../ui-activity-monitor/README.md) owns the completion cue and the preference gating it.

## Model Experience

None, as the entry shell boots the browser plugin tree; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One-shot rendering by design** — the UI waits for the boot settle; a single entry failure keeps the loading page with a loud per-entry report, no partial availability (progressive rendering returns with its own project).
- **Narrow-window shell behavior lacks an assembled walkthrough** — ui-layout implements the concession chain, but this package has no shell-level narrow-viewport acceptance case.
