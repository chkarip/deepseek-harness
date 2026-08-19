# `@deepseek-ai/dsh-session-handoff`

English | [中文](README.zh.md)

`ctx.sessionHandoff` relays finalized assistant answers, preceding user questions, and source conversation summaries across sessions as sourced model-facing context (`ContextForm = 'relay'`). It is published via Typert Remote as `sessionHandoff.relay`.

## Public API

- `relay(request)` validates the request, resolves source and target agents via `createApiRemoteAgentResolver`, extracts the assistant answer and preceding question directly from the durable source log, formats and byte-bounds the relayed payload, and injects a sourced context message into the target conversation.
- Delivery modes:
  - `'attach'`: silently injects the relayed context into the target conversation without waking the agent.
  - `'attach-and-ask'`: injects the relayed context and immediately follows up with the user's note prompt in the same turn.

## Security and Framing

The relayed payload is wrapped in a tag-safe JSON structure inside `<relayed-handoff>` tags with untrusted background warnings, ensuring that instructions inside the relayed content are not executed unless explicitly requested by the current user.

## Configuration

| Key | Default | Contract |
|---|---:|---|
| `maxRelayBytes` | `65536` | Maximum serialized UTF-8 bytes for the handoff JSON payload. |
| `allowCrossWorkspace` | `false` | Whether to allow handoffs across different workspace working directories. |

## Model Experience

### Relayed session handoff

#### What the model sees

The target agent sees a sourced context message containing tag-safe JSON wrapped in `<relayed-handoff>` tags. This payload contains the extracted assistant answer, preceding question, and optional summary from the source session.

#### Token effect

Adds the warning header plus the serialized JSON object bounded by `maxRelayBytes`.

#### KV Cache effect

Relayed handoff messages append to the target session log as regular conversation turns and cache prefix identically to user prompt inputs.

## Known Limitations and Deferred Work

- **Static JSON Truncation**: Payload truncation drops older question lines or ends of long assistant answers with omission notices; structured semantic summarization before relay requires explicit client summary requests.
- **Cross-Host Relay**: Relay operates within the same host instance across local agent sessions.
