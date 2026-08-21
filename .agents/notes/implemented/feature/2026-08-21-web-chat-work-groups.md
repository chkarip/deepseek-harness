# Agent Note: Web chat work groups

Status: implemented

English | [中文](2026-08-21-web-chat-work-groups.zh.md)

## Problem

The chat flow rendered every intermediate row at the same level as the answer: a turn's Think rows and its Bash/Read tool rows sat in one flat column above the prose, each already individually collapsible but none of them foldable together. A turn with a handful of tool calls pushed its answer off-screen and made the transcript read as a machine log rather than a reply, and a reader who wanted the reasoning had no single place to open it.

## Decision

**The Chat snapshot builder decides grouping; the view only renders it.** `ChatSnapshotBuilder` publishes `ChatSnapshot.rows` beside `order`: adjacent visible Nodes of one Turn whose material is only reasoning or tool-call heads become one `work-group` row carrying the member keys, and every other Node stays a `node` row. `order` is unchanged, so scroll anchoring, paging, the `data-chat-anchor-key` ledger, and per-key seat subscriptions keep working on the flat list. Rows are reference-stable: an unchanged layout returns the previous array, and an unmoved group keeps its object, so folding never remounts a member.

**Membership is a property of what a Node carries, not of its kind alone.** A Tool call is always work. An Assistant step is work only while every block it holds is reasoning or a tool-call head, and never while it is interrupted — so the step that finally speaks, or froze mid-sentence, leaves the group by itself. Because that predicate reads content, `apply()` carries a regrouping signal separate from its structural one: a step gaining its first text block rebuilds the layout without disturbing `order` or the Location index.

**The group's disclosure follows its Turn, until a reader overrides it.** `WorkGroup` derives open from the owning Turn's `status`, so work streams visibly while the turn runs and folds to one row the moment it closes. A toggle stores an explicit override that wins from then on. Members mount only while open, so a long history pays for summary rows alone.

**The collapsed activity line is a keyed seat, not a switch.** `conversation.chat.workSummary` dispatches on the last member's renderer kind. `ui-conversation` names a reasoning step by its latest thought; `ui-tool` registers `ToolWorkSummary`, which derives the tool title and one-line summary from the same pure `toolRowModel` the expanded row uses. A kind with no entry leaves the group showing its step count alone, so the seat degrades instead of failing.

## Alternatives considered

**Group inside the view from `chat.order`.** Rejected: `ChatNodeStore` is a stable live object and `order` does not change when a step starts speaking, so the view has no signal to regroup on. The builder already sees every upsert.

**Make the group its own Chat Node kind.** Rejected: one Node per Context is the engine's rule, and a synthetic parent Node would have to re-own its members' keys, anchors, and lifecycle — the exact machinery `order` already provides.

**Import the tool row model into the chat view for the summary line.** Rejected: `ui-tool` depends on `ui-conversation`, not the reverse. A keyed seat keeps tool presentation in the package that owns it and leaves the group renderable when that package is composed out.

**Split reasoning into its own Chat Node kind so every Think row groups.** Deferred, not rejected. Reasoning that arrives in the same step as the answer text still renders above the answer instead of inside the group. Splitting it means a separate `ConversationNodeDefinition` over the reasoning chunks and a visibility change in `assistant.ts`, which touches turn-tail closing detection, branch-action enablement, and StatsLine step counts; it is worth doing on its own, with its own coverage.

## Consequences

A turn now reads as an answer with its work attached rather than a log of steps. The Chat target owns one more published projection, and `ChatSnapshot` gained a required field, so every fixture that builds the slice by hand supplies `rows` — the ui-conversation fixture builds it through the exported `chatRowLayout`, which also fixed that fixture's lossy Location for a settling tool call. Collapsing unmounts member rows, so a tool card's local expand state does not survive a fold; the anchor key on the group row keeps paging able to land on a collapsed run.
