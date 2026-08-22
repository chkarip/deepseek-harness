# @deepseek-ai/dsh-client-ui-skill-mode

English | [中文](README.zh.md)

Skill-mode plugin, browser half: decorates the HOST `/mode` command (from `@deepseek-ai/dsh-skill-mode`) with a popupSelect shell over the session's mode skills. Bare `/mode` — typed in the composer or picked from the '/' menu — opens the shell; its search input filters the loaded mode-skill rows locally (name and description), ↑↓ move the highlight, **Tab autocompletes the highlighted row into the search**, and Enter settles the selection by executing `/mode <name>` through the ordinary command channel. The host executor logs the lifecycle and the result renders as a flow node, exactly like any other command submission.

Options come from the `skills.list` RPC (the same catalog the '/' skill source and the model catalog read), filtered to `mode === true` — the frontmatter flag `dsh-skill-filesystem` parses into the skill summary. Rows carry the skill description as detail so filtering matches both name and text. A session with no mode skills opens a shell that reports the empty state instead of a bare claim line.

The decoration never manufactures a row: if the host composition does not mount the `/mode` command (`dsh-skill-mode` absent), the command directory has no row and the decoration is simply unreachable. Mode activation stays a user gesture — the popup only submits `/mode <name>`, and the host validates the skill is a `mode: true`, user-invocable entry before entering it.

The `/client` exports are the plugin body (`apply`/`inject`).

## Interaction

- Type `/mode ` or pick `/mode` from the '/' menu: the popup opens with the mode-skill list.
- Type to filter (case-insensitive substring over name and description).
- ↑↓ move the highlight; Tab fills the search with the highlighted row's name; Enter selects and submits `/mode <name>`.
- `/mode off` still works as a plain argument line; bare `/mode` with no decoration available falls through to the host claim (`[name|off]` hint).

## Model Experience

Indirectly, through the `/mode <name>` command line the popup submits: `@deepseek-ai/dsh-skill-mode` owns the model-visible mode body and the logged state that line drives, while this package only lists the session's mode skills and sends what a user could equally type.

#### KV Cache effect

Entering or leaving a mode changes the active `skill-mode` system-prompt section and therefore the request prefix; the popup itself adds no prompt content.

## Known Limitations and Deferred Work

- **The active-mode indicator is not rendered** — plan mode has a composer chip (`ui-plan`); skill-mode currently surfaces state only through `/mode`'s own response text. A chip over the `skill-mode` projection is a natural follow-up.
- **Tab completes, it does not select** — Tab fills the search text (refinable), Enter submits; a Tab-selects-immediately mode is intentionally not offered so a partial prefix never commits the wrong skill.
