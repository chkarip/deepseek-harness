# @deepseek-ai/dsh-skill-mode

English | [中文](README.zh.md)

Logged, per-session sticky skill modes: a user-invoked `mode: true` skill whose body stays present in every model request until turned off. `/mode <name>` enters a mode, `/mode off` leaves it, and bare `/mode` lists the available mode skills and the current state.

## Durable state

`skill/mode` (`{ name: string | null }`) is a log-only, whole-value-replace `SessionEventMap` member. `foldSkillMode(events)` returns the last logged mode skill name or `null`, so resume, fork, and compaction recover mode state directly from the session log. UIs observe committed flips through `session/event`.

`ctx.skillMode.set(agent, name)` appends the standalone `skill/mode` event immediately when the agent is idle, because no in-turn pre-step runs before the next prompt. While the agent is running, it holds a pending selection for the next accepted in-turn pre-step. It returns which happened (`committed`/`queued`), a `cancelled` reversal, or a `noop`. `get(agent)` returns `{ name, pending? }`, separating the logged state used to assemble the current step from a user's mid-turn selection. Initial and continuation pre-steps both apply pending selections; a same-step request-recovery retry reuses its frozen assembly and leaves the selection pending for the next pre-step. A changed user selection contributes one plugin-sourced `user/message` notice when the last logged request header described the other state (both commit paths).

## Model interaction

While a mode is active, the `skill-mode` system prompt section renders the skill's `<skill_content>` body, warmed from the registry at selection time and re-resolved on `session/created` (resume) and `skills/change` (skill edits). A mode whose skill disappears, loses `mode: true`, or becomes model-only is dropped automatically with the logged state reset to `null`. Mode activation is a user gesture: only `mode: true`, user-invocable skills can be entered, and the model never activates a mode — it only follows the injected body.

## The `/mode` command

When `ctx.commands` is composed, the package registers `/mode`:

- `/mode <name>` enters the named mode skill after validating it exists, declares `mode: true`, and is user-invocable.
- `/mode off` leaves the mode and cancels a pending entry.
- Bare `/mode` lists the available mode skills and the current state.

## Authoring a mode skill

A skill becomes a mode with one frontmatter flag:

```markdown
---
name: unslop
description: Cut AI tells from any writing. Must always apply.
mode: true
---
```

The `mode` flag is parsed by `dsh-skill-filesystem` into the skill summary and definition; skills without it are ordinary skills. Place the skill in any discovery root (project `.agents/skills`, user `~/.agents/skills`, bundled), then enter it with `/mode unslop`.

## Session projection

When the composition mounts `ctx.sessionProjections` ([`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.md)), this package registers the `skill-mode` projection unit under an injected child. A `command/run` record named `mode` with recorded `args` starts a candidate target (`off` → `null`, a name → that name); its paired `command/done` retains a successful selection and drops an error; `skill/mode` commits the logged state and clears the retained selection. Every other event returns the same state reference. `view` derives `{ name, pending }`, where `pending` is true only while an unsettled or successful selection differs from the logged state. This remains a pure replay quantity, so host restarts, other tabs, and cold reads recover it from the log alone. The key merges into `SessionProjectionMap` from `src/types.ts` (served to host consumers via `./types` and client aggregates via `./client`); the framework drives the unit and carriers serve the value on the history tail page and the `session/projection` push frame. Compositions without the registry are unaffected.

## Configuration

The plugin takes no configuration.

```yaml
- id: skill-mode
  name: '@deepseek-ai/dsh-skill-mode'
```

Mount it beside `tool-skill` so its pre-step listener runs after the catalog's and the mode body lands after the catalog in the request.

## Model Experience

### Mode skill system prompt

#### What the model sees

While a mode is active, the model sees the `skill-mode` section at prompt order 60, after the plan policy: a `<system-reminder>` naming the active mode, then the selected skill rendered by `renderSkillContent` exactly as `tool-skill` renders a loaded body. No mode contributes no text. The model cannot enter or leave a mode — activation is a user gesture through `/mode`; the section only tells it which mode is on and to follow it.

##### Rendered section

```markdown
<system-reminder>
Skill mode "unslop" is active in this session. Follow its instructions.

<skill_content name="unslop">
<skill_resources>
...
</skill_resources>

<skill_instructions>
...the skill body...
</skill_instructions>
</skill_content>
</system-reminder>
```

#### Token effect

No mode adds no tokens; an active mode adds its skill body to every request for as long as it stays on. A mode body costs its own length once per request rather than once per turn, which is the trade against re-invoking the skill as a user message each turn.

#### KV Cache effect

The section is stable while one mode stays selected, so the prefix through order 60 is reused across turns. Entering, leaving, or switching modes changes the system prompt from order 60 onward, as does an edit to the active skill's file, which `skills/change` re-resolves.

### Human command

#### What the model sees

`/mode`, `/mode <name>`, `/mode off`, and their terminal results stay outside model history. A changed selection contributes one plugin-sourced `user/message` notice when the last logged request header described the other state, so a model reading back the transcript can see that the posture changed between requests. Cancelling a pending selection contributes none, because no request observed it.

#### Token effect

The notice is one short user message on a changed selection; listing modes or re-selecting the current mode adds nothing.

#### KV Cache effect

The notice appends to history rather than editing the prefix, so it invalidates nothing already cached.

## Known Limitations and Deferred Work

- **One mode at a time** — the logged state is a single name, so entering a mode replaces the active one. Stacking two mode skills would need a set-valued event and a defined body order, neither of which the format promises.
- **The body is not diffed against the catalog** — an active mode renders its body in full even when `tool-skill` already listed that skill in the session-prefix catalog, so a mode skill's summary and its body can both reach the request.
- **No model-side exit** — the model cannot leave a mode it finds inapplicable; it can only decline to apply the body and say so. Deployments wanting model-driven posture changes need a separate tool.
- **Per-session, not per-agent-tree** — a subagent does not inherit its parent's mode; each session's mode state is its own logged quantity.
