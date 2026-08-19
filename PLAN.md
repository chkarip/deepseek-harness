# Plan — Subagent support for the DeepSeek agent harness

## Stack and target (assumption stated up front)

The request left the stack as `[Python / Node — specify your stack]`. **This plan targets
Python**, extending the standalone prototype at `examples/deepseek-skills/skills_system.py`
(`DeepSeekAgentHarness`, 1082 lines, 43 pytest cases).

Why that target and not the TypeScript tree:

- The prototype is the only DeepSeek-based harness here with a hand-rolled main loop
  (`run_turn`, `skills_system.py:659`) that matches the request's wording — "reuse the
  existing main-loop code, parameterize it".
- `packages/subagent/*` **already implements a production subagent capability** in
  TypeScript (`child-agent.ts`, `depth.ts`, `continuation.ts`, `run-settlement.ts`,
  out-of-process children, projections). Building requirements 1-8 there would duplicate
  shipped code, not add a missing layer.
- The last two commits are exactly this shape: a self-contained Python prototype in
  `examples/` with its own test suite. This is the sibling exercise for subagents.

If the intent was actually the TypeScript capability, stop here — the plan changes
completely, and the work is mostly "read what `packages/subagent` already does".

## Placement

Everything lands inside `examples/deepseek-skills/`. New files:

| File | Contents |
| ---- | -------- |
| `agent_core.py` | the extracted, tool-agnostic loop + usage accounting |
| `subagents.py` | type registry, tool registry, `spawn_subagent`, runner, limits |
| `tests/test_subagents.py` | the new suite |

Edited: `skills_system.py` (loop extraction + parent wiring), `README.md`,
`tests/test_skills_system.py` (test-double thread safety, see step 8).
`pytest.ini` already collects `examples/deepseek-skills/tests`; no change.

The directory name now undersells its contents. Renaming it to something neutral
(`examples/deepseek-agent/`) is sanctioned by the repo's pre-release stance in
`AGENTS.md`, but it touches `pytest.ini`, both READMEs, and `conftest.py` for zero
functional gain — **deferred, not done here**, per "don't restructure beyond adding
this layer".

---

## Step 1 — `spawn_subagent` tool schema

DeepSeek/OpenAI function-calling format, emitted by `subagents.build_spawn_tool(registry, depth)`:

```jsonc
{
  "type": "function",
  "function": {
    "name": "spawn_subagent",
    "description": "Delegate one self-contained subtask to an isolated agent ...",
    "parameters": {
      "type": "object",
      "properties": {
        "task":          { "type": "string" },
        "subagent_type": { "type": "string", "enum": ["research", "code-review", "test-runner"] },
        "allowed_tools": { "type": "array", "items": { "type": "string", "enum": ["<registry keys>"] } },
        "output_schema": { "type": "object" }
      },
      "required": ["task", "subagent_type"]
    }
  }
}
```

`subagent_type` and `allowed_tools` items are **enum-constrained from the live registries**,
so an invalid name cannot be produced in the first place. This mirrors the trick already
used for skill names (`get_tool_definitions`, covered by
`test_tool_definitions_constrain_skill_name_with_enum`).

`task` must be self-contained: the child never sees the parent's history, so the tool
description says so explicitly and tells the parent to inline any context the child needs.

## Step 2 — Isolated loop instantiation (extract, don't duplicate)

`run_turn` today hardcodes three things: the skills system prompt, the skills tool list,
and `_dispatch_tool`. Everything else in it is generic and hard-won (assistant message
appended exactly once per iteration; a reply for *every* `tool_call` id; synthesized ids;
unparsable-JSON handling; `max_iterations` stop reason). That is the code to reuse.

Extract into `agent_core.py`:

```python
def run_agent_loop(*, call_api, system_prompt, user_prompt, tools, dispatch,
                   max_iterations, token_budget=None, on_tool_call=None,
                   dispatch_batch=None) -> LoopResult
```

- `call_api` is injected (`harness._call_api`), so `agent_core` stays transport-free and
  the existing `FakeAPI` seam keeps working unchanged.
- `dispatch(name, args) -> str`. The current `_dispatch_tool` returns
  `(result, loaded_skill_name)`; that second channel becomes the `on_tool_call` hook, and
  the skills wrapper records `skills_loaded` in its own closure.
- `LoopResult`: `final_text`, `iterations`, `stop_reason`
  (`completed` | `max_iterations` | `token_budget`), `tool_calls`, `warnings`, `usage`.

`run_turn` becomes a thin adapter: build skills prompt + skills tools + skills dispatcher,
call `run_agent_loop`, map `LoopResult` back onto the **existing trace dict keys**
(`skill_loaded`, `skills_loaded`, `tool_calls`, `final_response`, `iterations`,
`stop_reason`, `warnings`). Mock mode (`_run_turn_mock`) is untouched.

**Gate: all 43 existing tests pass with no edits to their assertions.** If a test needs
changing, the extraction changed behaviour and is wrong.

Subagent instantiation is then just a second caller of the same function, with a fresh
message list seeded only with `[system: type prompt, user: task]`.

## Step 3 — Per-type system prompts

`SUBAGENT_TYPES: dict[str, SubagentType]` in `subagents.py`:

```python
@dataclass(frozen=True)
class SubagentType:
    name: str
    system_prompt: str
    default_allowed_tools: tuple[str, ...]
    max_iterations: int
    token_budget: int
```

Three to start: `research`, `code-review`, `test-runner`. Each prompt is narrow and states
the contract the parent depends on: **return one distilled final answer, no preamble, no
clarifying questions** (a child has no one to ask), state assumptions inline, and say so
explicitly when the task could not be completed. The parent's general-purpose system prompt
is never reused for a child.

## Step 4 — Result extraction

`SubagentResult`: `text`, `subagent_type`, `stop_reason`, `iterations`, `usage`,
`tool_call_count`, `denied_tools`.

Two channels, and they must not be confused:

- **Into the parent's context** — the `tool_result` content is `result.text` only, plus a
  one-line status prefix when `stop_reason != "completed"` (so a truncated child cannot be
  read as a confident answer). Never the transcript, never the child's tool calls.
- **Into the parent's trace** — the full record under `trace["subagents"]`. This is
  observability for the harness and the tests, not model context.

Edge cases with explicit handling, because empty strings silently corrupt a parent turn:

- Child hits `max_iterations`/`token_budget` with no final text → return an explicit
  "subagent produced no final answer (stopped: ...)" result, not `""`.
- `output_schema` supplied → append the schema to the child's system prompt, `json.loads`
  and validate the final text, allow **one** repair round-trip inside the child's remaining
  iteration budget, then return a structured error. Never hand malformed JSON up as if valid.

**Steps 1-4 deliver a working sequential version.**

## Step 5 — Tool scoping (enforced structurally)

A `TOOL_REGISTRY: dict[str, ToolSpec]` where `ToolSpec` = `(schema, handler)`. Contents:

| Tool | Notes |
| ---- | ----- |
| `load_skill`, `read_skill_reference` | existing, unchanged |
| `read_file` | real, sandboxed to the example root, rejects traversal (reuse the pattern already proven by `test_read_reference_rejects_traversal`) |
| `run_tests` | fixed argv (`python -m pytest <fixture dir>`), no model-supplied arguments, hard timeout |
| `web_search` | **offline stub backed by a fixture file.** Documented as a stub in the README and in its own tool description; it exists to make scoping demonstrable, and must never be mistaken for real search |

`resolve_tools(requested, subagent_type, depth)` = `requested ∩ type.default_allowed_tools ∩
registry`, minus `spawn_subagent` when the depth cap is reached. Names that get dropped are
returned as `denied_tools` and surfaced to the parent in the result metadata — silently
dropping a requested capability produces confusing child behaviour.

Enforced twice: the child's `tools` list literally omits them, **and** the child's dispatcher
rejects any name outside its resolved set (a model can emit a tool name it was never given).
So a `code-review` child cannot reach `run_tests` even if it asks by name.

## Step 6 — Concurrent spawns

The loop already collects the full `tool_calls` list from one assistant message. Add a batch
phase: partition an iteration's calls into spawns and non-spawns, run the spawns concurrently,
then append every `tool_result` **in the original tool_call order** (ordering is part of the
wire contract; completion order is not).

Mechanism: `concurrent.futures.ThreadPoolExecutor`, `max_workers = min(n, MAX_CONCURRENT)`.

> **Deviation from the brief, called out deliberately.** The request says `asyncio.gather`.
> The prototype's transport is blocking `urllib` and stdlib-only. `asyncio.to_thread` +
> `gather` would satisfy the wording, but only by making `run_agent_loop` async, which
> infects `run_turn`, the CLI, the eval harness, and all 43 existing tests. Threads give
> identical concurrency for I/O-bound HTTP at a fraction of the blast radius. Say the word
> and I'll do the async conversion instead.

Thread-safety review, since the harness object is shared across workers: `_call_api` reads
only immutable config; each child owns its own message list, trace, and usage meter; meters
merge on the parent thread after `as_completed`. Nothing mutable is shared.

**Risk with a checkpoint:** this assumes DeepSeek emits multiple `tool_calls` in one
assistant message. Verify early with one live probe. If it reliably emits one call per
iteration, add a `spawn_subagents` batch tool taking a list of specs — same runner
underneath, ~20 lines, and the concurrency machinery is unchanged.

## Step 7 — Depth and budget limits

- **Depth** — `MAX_DEPTH = 1` (parent spawns children; children cannot spawn). Structural:
  `build_spawn_tool` is only included when `depth < MAX_DEPTH`, plus a defensive dispatcher
  check returning a refusal `tool_result` rather than raising.
- **Iterations** — per-type `max_iterations` (default 4, below the parent's 6).
- **Tokens** — usage accumulated per loop from `response["usage"]`, checked *before* each
  API call; exceeding stops with `stop_reason="token_budget"`. Three levels: per-child
  budget, a whole-turn budget across all children, and `MAX_SUBAGENTS_PER_TURN`, so N
  concurrent runaways are contained, not just one.
- **Attribution** — parent usage and each child's usage stay separate in the trace
  (`trace["usage"]`, `trace["subagents"][i]["usage"]`, plus a rollup). A missing `usage`
  block counts as zero and records a warning rather than silently under-reporting.

## Step 8 — Test suite

**Test-double fix first.** `FakeAPI` (`tests/test_skills_system.py:71`) pops from a shared
list — under concurrent children that is both order-nondeterministic and not thread-safe.
Make it routable: dispatch responses on a marker in the incoming messages (system prompt or
task text) and guard the queue with a lock. Existing sequential tests keep working.

Five prompts (all runnable offline against scripted responses; `--api` optional for a live run):

1. **Single research delegation** — expect one spawn, `subagent_type="research"`.
2. **Parallel** — "research X and Y independently, then compare" → two spawns in one
   assistant message, run concurrently.
3. **Code review** — expect `code-review`, and assert `run_tests` is absent from the child's
   toolset.
4. **Test runner** — expect `test-runner` with `run_tests` available.
5. **Negative control** — "what is 2+2" → **no spawn**. Over-delegation is as much a failure
   as under-delegation, and nothing else in the suite catches it.

Assertions, mapped to the brief's verification list:

- *Spawns instead of working inline* — cases 1-4 record a `spawn_subagent` call; case 5 records none.
- *Results return clean and distilled* — scan the parent's full message list for the child's
  tool names and intermediate results; **none may appear**. This is the test that protects
  the whole point of the feature.
- *Parent continues correctly* — after the tool results, the parent produces a final text
  turn referencing both children's answers (case 2).
- *Concurrency, without flaky timing* — each scripted child call waits on a
  `threading.Barrier(2)` with a short timeout. It trips only if both children are genuinely
  in flight at once; sequential execution raises `BrokenBarrierError`. Deterministic, no sleeps.
- *Depth* — a child's tool list contains no `spawn_subagent`; a forced call returns a refusal
  `tool_result` and the loop keeps going.
- *Budgets* — a scripted child that calls tools forever stops at `max_iterations`; a scripted
  child reporting large `usage` stops with `stop_reason="token_budget"`; per-child usage is
  attributed separately from the parent's.
- *Tool scoping* — a child that requests a denied tool gets the denial in `denied_tools` and
  cannot invoke it.

## Sequencing

| Phase | Steps | Exit criteria |
| ----- | ----- | ------------- |
| A | 2 | Loop extracted; **43 existing tests green, unmodified** |
| B | 1, 3, 4 | Sequential spawn works end to end; distilled result reaches the parent |
| C | 5, 7 | Scoping and limits enforced structurally, not by prompting |
| D | 6 | Concurrent spawns, ordered results, thread-safety review done |
| E | 8 | Full suite green offline; one optional live `--api` run |

## Open questions / risks

1. **Stack** — Python prototype assumed (see top). One line from you settles it.
2. **DeepSeek parallel tool calls** — unverified; step 6 carries a concrete fallback.
3. **Threads vs asyncio** — deviation from the brief, argued above; reversible.
4. **`run_tests` executes a subprocess** — kept to a fixed argv with a timeout. If any
   shell reachability is unacceptable in this prototype, drop the tool and let `test-runner`
   scope over `read_file` only; the scoping tests still have teeth.
5. **`web_search` is a fixture stub**, labelled as such everywhere. Not a real capability.
6. **Live-mode cost** — five prompts × (parent + up to two children) per run; offline is the
   default and the live path stays opt-in behind `--api`.
