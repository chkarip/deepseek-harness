# Agent Note: Sticky skill modes — a `mode: true` skill that stays active across turns

Status: implemented

English | [中文](2026-08-22-skill-mode.zh.md)

## Problem

A skill invoked once is a one-shot injection: its body rides that step's request, and the model decides per task whether to load it again. Some skills are meant to be standing posture rather than a single instruction — writing style, review discipline, a persistent workflow. Cursor plugins express this with a `mode: true` frontmatter flag and a sticky invocation: once the user invokes `/poteto-mode`, the skill stays active across turns, applying itself when a playbook matches or the task needs rigor, until the user opts out. DeepSeek Harness had no such mechanism: every skill was either catalog-listed (model-invoked on judgment) or user-invoked once, and nothing persisted "this skill is on" across turns.

## Decision

`@deepseek-ai/dsh-skill-mode` adds sticky session skill modes. The mode's active skill name is logged per-session as a `skill/mode` (`{ name: string | null }`) `SessionEventMap` member — log-only, non-surface, whole-value replace, last one wins — so resume, fork, and compaction recover it directly from the session log. `foldSkillMode(events)` returns the last logged name or `null`, mirroring `foldPlanMode`.

The `/mode` command enters and leaves the mode: `/mode <name>` validates the skill exists, declares `mode: true`, and is user-invocable, then selects it; `/mode off` leaves; bare `/mode` lists available mode skills and the current state. Selection semantics mirror `ctx.planMode`: between turns the change appends `skill/mode` immediately; during an open turn it queues a pending selection for the next accepted in-turn pre-step; repeated selection of the current or already-pending state is a no-op; a reversal cancels. `ctx.skillMode.get(agent)` returns `{ name, pending? }`, separating the logged state used to assemble the current step from a user's mid-turn selection.

While a mode is active, the `skill-mode` system prompt section (order 60, after plan policy) renders the skill's `<skill_content>` body, warmed from the registry at selection time and re-resolved on `session/created` (resume) and `skills/change` (skill edits). A mode whose skill disappears, loses `mode: true`, or becomes model-only is dropped automatically with the logged state reset to `null`. Mode activation is a user gesture: only `mode: true`, user-invocable skills can be entered, and the model never activates a mode — it only follows the injected body. This is the sticky equivalent of the one-shot `/name` invocation, without transcript growth: the body rides the system prompt rather than duplicating a durable user message every turn.

`mode` is a new optional boolean in the skill frontmatter, parsed by `dsh-skill-filesystem` into the skill summary and definition and validated by the registry (`skill.mode` must be boolean when present). Skills without it are ordinary skills.

The `skill-mode` projection unit folds `{ name, pending }` from the `/mode` command lifecycle and `skill/mode` events as a pure replay quantity, so host restarts, other tabs, and cold reads recover it from the log alone. The `command/run` record named `mode` with recorded args starts a candidate target (`off` → `null`, a name → that name); its paired `command/done` retains a successful selection and drops an error; `skill/mode` commits the logged state and clears the retained selection.

Composition mirrors plan mode: the base bundle mounts `dsh-skill-mode` on the host plane, the web-app bundle disables that row (per-agent state belongs behind presets), and the standard, code, and cordis presets mount it inside a `skillMode: true` isolate realm.

## Alternatives considered

**Reuse the user-invocation path for sticky skills.** Rejected: `/name` is a one-shot injection by design, and making it sticky would conflate two different postures — "apply this once" vs. "keep this on."

**Inject the mode body as a durable user message every turn.** Rejected: it grows the transcript with duplicate bodies. The system prompt section renders the same body fresh each request without transcript growth, and resume needs no message replay.

**Require the model to re-invoke the mode skill per task.** Rejected: that is exactly the posture a mode exists to remove; the model should follow the injected standing instructions, not re-discover them.

## Consequences

`SkillEntry` and the skill summary carry a required `mode` boolean, so every producer of a skill listing sets it — the `skills.list` RPC schema, the client connection fixture, and the apiproxy carrier test all name it explicitly rather than defaulting.

`SessionEventMap` gains `skill/mode`, so a build that does not know the member refuses the log unless the envelope marks it ignorable; this one is required-on-read like the other logged state.

A composition that mounts `dsh-skill-mode` without `ctx.commands` gets the service and the prompt section but no `/mode`, and one without `ctx.sessionProjections` gets no projection unit — both are silent by design, since the package registers each contribution behind the service it needs. The base bundle mounts the plugin on the host plane, the web-app bundle disables that row, and the standard, code, and cordis presets mount it inside a `skillMode: true` isolate realm, so per-agent mode state stays behind presets exactly as plan mode does.

`ctx.skillMode` maps to the skills subsystems page and is classified as a core service in the doc graphs, alongside `planMode`.
