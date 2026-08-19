# Agent Note: Python prototype subagents

Status: implemented

English | [中文](2026-08-19-python-prototype-subagents.zh.md)

## Problem

The standalone DeepSeek Python prototype had a skills-specific loop but no isolated delegation path for self-contained research, review, or test tasks.

## Decision

The prototype exposes `spawn_subagent` from the parent loop and runs each child through the shared loop in `agent_core.py` with a fresh system and user message list. `SUBAGENT_TYPES` owns narrow prompts and per-role limits. Tool schemas and dispatch are both filtered by the live registry; children are restricted to the example root for file reads, use a fixed timed pytest command, and receive an explicitly offline search stub. Children cannot spawn further children. Sibling spawn calls run in a bounded thread pool and tool results return in request order. Child text is distilled into the parent tool result while complete child accounting remains in the parent trace.

Spawn arguments are model-controlled, so they are normalised into a fixed keyword set before reaching the runner: unrecognised keys are dropped and invalid ones become a tool result rather than an exception that would end the parent turn. Limits apply at three levels — per-role iterations and tokens, a turn-wide child token budget, and a cap on children started per turn — so concurrent runaways are contained rather than only a single one.

Structured output receives one repair attempt within the remaining child budget, and `output_schema` is read as either a JSON Schema or a flat key map. Parent and child usage are recorded separately, with a child rollup on the parent trace.

## Alternatives considered

**Convert the whole prototype to asyncio.** The transport is blocking `urllib`, so threads provide equivalent I/O overlap without changing the public synchronous CLI and existing tests.

**Reuse the parent system prompt and transcript.** That would leak unrelated context into a child and make delegation results dependent on parent history, so each child remains isolated.

**Enforce tool scope only in the prompt.** Prompt-only restrictions are not an enforcement mechanism; the schema omission and dispatcher refusal are both required.

## Consequences

The prototype has bounded concurrent delegation and explicit refusal/error text for denied, malformed, truncated, or invalid structured child output. The offline search tool is a fixture stub and must not be treated as a network capability. The implementation is intentionally local to `examples/deepseek-skills`; the production TypeScript subagent capability remains separate.
