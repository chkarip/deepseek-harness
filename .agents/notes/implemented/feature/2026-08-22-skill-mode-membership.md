# Agent Note: Mode membership — a mode skill carries other skills

Status: implemented

English | [中文](2026-08-22-skill-mode-membership.zh.md)

## Problem

[Sticky skill modes](2026-08-22-skill-mode.md) make exactly one skill stand: `/mode <name>` logs `skill/mode`, and the `skill-mode` system prompt section renders that skill's body in every request. A posture is rarely one skill. `unslop` says it must always apply, but as a mode it can only stand alone; a router mode that wants a standing writing style plus its own playbook text has no way to express the pair. Entering two modes is not available either — the logged state is a single name.

## Decision

A mode skill declares the skills it carries in `skills:` frontmatter, and every declared member's body renders alongside the mode's own for as long as the mode is active.

```markdown
---
name: poteto
description: Router for rigorous engineering work.
mode: true
skills: [unslop]
---
```

`dsh-skill-filesystem` parses `skills:` into `SkillSummary.modeSkills`, alongside the `mode` flag it already parsed. Both mode fields are now parsed together and rejected together: a non-array `skills`, a non-string or non-kebab-case member, `skills` without `mode: true`, or a non-boolean `mode` ignores that one file with a named warning, exactly as invalid invocation frontmatter does.

`SkillModeController.renderModeBodies()` resolves the members when it warms the body cache — at `/mode` entry, on `session/created` (resume), and on `skills/change`. The cache holds an ordered body list rather than one body, and the section renders the mode body followed by each member body, each as its own `renderSkillContent` block. The resolution rules:

- **One level.** A member's own `modeSkills` is ignored, so expansion terminates by construction and needs no cycle guard.
- **Duplicates and self-references are dropped**, so a mode listing itself renders its body once.
- **A member that no longer loads is dropped with a warning while the mode stays active.** A member need only exist and be user-invocable; it does not need `mode: true`.

Membership is resolved only where a mode renders. `dsh-tool-skill`'s user-invocation boundary reads invocation policy alone, so a member stays a one-shot `/name` injection whether or not the mode carrying it is active, and the model still reaches it through the `skill` tool. The wire `SkillEntry` gains a required `modeSkills` array, which the `/mode` popupSelect renders as row detail so a search for a member finds the mode carrying it; the row for the session's current mode is marked active from the `skill-mode` projection.

## Alternatives considered

**A set-valued `skill/mode` event.** Rejected: stacking two modes needs a defined body order and a session-format change, and a named container expresses the same posture with the single logged name the format already promises.

**A preset per mode.** Rejected: presets swap tool schemas and prompt sections and lock once an agent has produced anything, while a posture must be switchable mid-session.

**Killing the mode when a member is missing.** Rejected: one deleted member file would take down a whole posture whose remaining members are intact. The mode itself disappearing still drops the mode, as before.

**Expanding members recursively.** Rejected: it buys nesting nobody asked for and costs a cycle guard plus a defined ordering for the transitive set.

## Consequences

Membership resolves from the skill file at render time rather than from the log, so `SESSION_FORMAT_VERSION` does not move — `skill/mode` still logs one name. Editing a mode's `skills:` list therefore changes what an already-logged session replays: the log names the mode, and the file decides what that mode currently carries.

An active mode's request cost grows by the full body of every member, once per request. A mode carrying several large skills is a standing prefix cost, which is the trade against invoking each one per turn.

`SkillEntry.modeSkills` is required wire data, so every producer of a skill listing sets it — the `skills.list` RPC schema, the client connection fixture, and the apiproxy carrier tests all name it rather than defaulting.

A mode's member bodies and the session-prefix catalog still both reach the request, unchanged from the single-skill case: the mode does not diff its members against what `tool-skill` already listed.
