# DeepSeek Skills System

English | [中文](README.zh.md)

A standalone Python prototype of progressive skill loading against the DeepSeek
chat-completions API. It explores the three-level disclosure contract before
that behaviour is committed to a supported package.

This is **not** the production skill capability. That lives in
[`packages/skill/*`](../../packages/skill) (TypeScript) and owns discovery
precedence, invocation policy, and the `ctx.skills` seam. This example does not
plug into `cordis.yml`; it is a self-contained script with its own tests.

## Progressive loading

| Level | What enters context | Trigger |
| ----- | ------------------- | ------- |
| 1 | `name` + `description` for every skill (~100 words each) | startup scan |
| 2 | The SKILL.md body | model calls `load_skill` |
| 3 | One reference document | model calls `read_skill_reference` |

Level 3 matters: `load_skill` advertises reference file names but does **not**
inline their contents, so a skill with large references costs the same at
trigger time as one without.

## Usage

```bash
cd examples/deepseek-skills

python skills_system.py --scan               # list skills + scan warnings
python skills_system.py --load json-envelope # print one skill as the model sees it
python skills_system.py --reference json-envelope schema-spec.md
python skills_system.py --prompt "format this payload as JSON"
python skills_system.py --test               # trigger accuracy evaluation
```

### Execution modes

| Mode | Selected by | Behaviour |
| ---- | ----------- | --------- |
| `auto` | default | live when `DEEPSEEK_API_KEY` is set, otherwise mock |
| `live` | `--api` | real API calls; exits non-zero if the key is missing |
| `mock` | `--mock` | offline keyword heuristic, never touches the network |

**Read the mode line before trusting an accuracy number.** In mock mode the
score describes a local keyword matcher that scores prompts against the same
skill descriptions those prompts were written from — close to circular, and not
a measurement of model behaviour. The report prints a warning banner saying so.
Only `--api` runs measure whether DeepSeek actually triggers `load_skill`.

## Subagents

The live loop exposes `spawn_subagent` for self-contained delegation. A child receives only its role prompt and task, never the parent transcript, and returns one distilled result. The available roles are `research`, `code-review`, and `test-runner`; each role has its own iteration and token limits.

Tool access is allow-listed twice: unavailable tools are omitted from the child schema and rejected by the dispatcher, and `allowed_tools` can only narrow a role's defaults, never widen them. `read_file` and `run_tests` are pinned to this example's own directory rather than to `--skills-dir`, `run_tests` uses a fixed pytest command with a timeout, and `web_search` is an offline fixture stub rather than real search. Children cannot spawn further children. Multiple spawn calls in one assistant message run concurrently, while their results are returned to the parent in request order.

Spawn arguments come from the model, so they are normalised before use: unrecognised keys are dropped, and a missing task or unknown role becomes a tool result the model can retry from rather than an exception that ends the turn. Three ceilings apply per turn — each role's own iteration and token limits, a shared child token budget, and a cap on how many children one turn may start.

The parent trace records each child under `subagents`, with separate child usage and a `subagent_usage` rollup. An optional `output_schema` requires JSON output and accepts either a JSON Schema or a flat `{key: description}` map; the child receives one repair attempt within its remaining budget before malformed output becomes an explicit error.

## Authoring a skill

```
skills/<kebab-case-name>/
  SKILL.md            # required: `name` + `description` frontmatter, then the body
  references/*.md     # optional: loaded individually, on demand
  scripts/*           # optional: listed to the model as reference implementations
```

The directory name and frontmatter `name` should match, and both should be
kebab-case — `--scan` warns when they drift, when two skills claim one name, or
when a `description` is missing. The description is the only text the model sees
when deciding whether to trigger, so it should name concrete capabilities and
end with an explicit "Use when …" clause.

Scripts are advertised but never executed; this harness has no execution tool.

## Tests

```bash
python -m pytest examples/deepseek-skills/tests
```

Covered from the repo root via `pytest.ini` `testpaths`.
