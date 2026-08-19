# Agent Note: Cross-Panel Session Handoff

Status: proposed

English | [中文](2026-08-17-cross-panel-session-handoff.zh.md)

## Problem

When users work across multiple conversation panels in the multi-panel workspace (`ui-panels`), they frequently want to take a finalized assistant response, code snippet, or conclusion produced in one panel and use it as reference context or a prompt for an agent running in a sibling panel.

Before this feature, moving information between panels required manual copy-pasting into the composer, losing provenance (which session, panel label, and message produced the answer) and bypassing length budgeting and untrusted content framing.

## Proposal

Implement a host-side `session-handoff` service (`@deepseek-ai/dsh-session-handoff`) and an assistant action UI entry (`PanelHandoffAction`) registered in slot `conversation.chat.assistant-actions`:

1. **Host-Side Service (`packages/context/session-handoff`)**:
   - Registered as `@Remote('relay')` under Typert namespace `sessionHandoff`.
   - Resolves both live/cold agents via `createApiRemoteAgentResolver`.
   - Extracts finalized assistant answer and preceding direct user question directly from durable source events log.
   - Truncates payload to fit within configured UTF-8 byte limit (`maxRelayBytes`, default 32 KB) with exact omission notices.
   - Enforces workspace boundaries unless `allowCrossWorkspace` is explicitly enabled.
   - Tags output in tag-safe JSON (`<` -> `\u003c`) within untrusted prompt framing (`<relayed-handoff>`).
   - Injects a sourced UserMessage (`source: { kind: 'session-handoff', form: 'relay', senderSessionId, senderLabel, messageId, includes }`).
   - In `'attach-and-ask'` mode with a human note, triggers a follow-up turn in the target session with the note.

2. **Client-Side Provenance (`packages/client/runtime`)**:
   - Recognizes `case 'session-handoff'` in `context-provenance.ts` mapping to `{ role: 'recall', label: senderLabel ?? 'session-handoff' }`.

3. **Client-Side Send Action (`packages/client/ui-panels`)**:
   - `PanelHandoffAction` mounted in `conversation.chat.assistant-actions` (order 20).
   - Only renders when 2+ active panels exist in the workspace.
   - Provides popover interface to select target panel, configure inclusions (answer, question, summary), trigger on-demand AI summarization, and choose delivery mode (`attach` vs `attach-and-ask`).

## Alternatives considered

- **Client-Only Composer Pasting**: Injects text into draft textarea. Rejected because it mutates unsent drafts, cannot automate immediate follow-up turns, and drops durable provenance.
- **Copying Entire Session History**: Forks or replicates logs. Rejected because it pollutes target session context window with irrelevant turns when only one specific answer was needed.

## Risks

- **Prompt Injection via Relayed Context**: Untrusted content from sibling sessions could carry hostile prompts; mitigated by wrapping payloads in `<relayed-handoff>` tags with explicit untrusted boundary notices.
- **Context Window Bloat**: Relaying large payloads could exceed context limits; mitigated by enforcing a configurable byte-budget limit (`maxRelayBytes`) with truncation notices.

## Acceptance criteria

- Unit tests in `session-handoff` cover all validation, extraction, byte-budget retention, and relay delivery paths.
- Client unit tests verify `contextProvenance` and `PanelHandoffAction` rendering and interactions.
- End-to-end multi-panel workspace integrity is verified.
