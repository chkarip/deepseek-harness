# DeepSeek Skills System

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
