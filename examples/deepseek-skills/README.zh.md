# DeepSeek 技能系统

[English](README.md) | 中文

这是一个基于 Python 的 DeepSeek 聊天补全 API 渐进式技能加载原型。它用于探索三层披露约定，不属于受支持的生产包。

该示例不是生产技能能力。生产实现位于 [`packages/skill/*`](../../packages/skill)，负责发现优先级、调用策略和 `ctx.skills` seam。本示例不接入 `cordis.yml`，是一个自包含脚本并带有自己的测试。

## 渐进式加载

| 层级 | 进入上下文的内容 | 触发方式 |
| ----- | ----- | ----- |
| 1 | 每个技能的 `name` 和 `description`（每个约 100 个单词） | 启动扫描 |
| 2 | `SKILL.md` 正文 | 模型调用 `load_skill` |
| 3 | 一个参考文档 | 模型调用 `read_skill_reference` |

第 3 层很重要：`load_skill` 只公布参考文件名，不会内联其内容，因此包含大型参考文档的技能在触发时不会增加额外上下文成本。

## 使用

```bash
cd examples/deepseek-skills

python skills_system.py --scan               # list skills + scan warnings
python skills_system.py --load json-envelope # print one skill as the model sees it
python skills_system.py --reference json-envelope schema-spec.md
python skills_system.py --prompt "format this payload as JSON"
python skills_system.py --test               # trigger accuracy evaluation
```

### 执行模式

| 模式 | 选择方式 | 行为 |
| ---- | -------- | ---- |
| `auto` | 默认 | 设置 `DEEPSEEK_API_KEY` 时使用实时模式，否则使用 mock |
| `live` | `--api` | 使用真实 API；缺少密钥时以非零状态退出 |
| `mock` | `--mock` | 离线关键词启发式，永不访问网络 |

使用准确率前先查看模式行。mock 模式的分数描述本地关键词匹配器，不代表模型行为。只有 `--api` 才测量 DeepSeek 是否实际触发 `load_skill`。

## 子 agent

实时循环提供 `spawn_subagent`，用于委派自包含任务。子 agent 只接收自己的角色提示词和任务，不会看到父级 transcript，并返回一条提炼后的结果。可用角色包括 `research`、`code-review` 和 `test-runner`，每种角色都有独立的迭代和 token 限制。

工具访问同时通过 schema 和分发器进行 allow-list 过滤，且 `allowed_tools` 只能收窄角色的默认工具，不能扩大。`read_file` 和 `run_tests` 固定在本示例自身目录内，而不是 `--skills-dir` 指向的位置；`run_tests` 使用固定且有超时的 pytest 命令，`web_search` 是离线 fixture stub，不是实时搜索。子 agent 不能继续创建子 agent。同一条 assistant 消息中的多个委派会并行运行，但结果按请求顺序返回父级。

委派参数来自模型，因此使用前会先规范化：未知键被丢弃，缺失的 task 或未知角色会变成模型可据以重试的工具结果，而不是终止本轮的异常。每轮有三层上限——各角色自身的迭代与 token 限制、共享的子 agent token 预算，以及单轮可启动的子 agent 数量上限。

父级 trace 在 `subagents` 下记录每个子 agent，并单独记录用量和 `subagent_usage` 汇总。提供 `output_schema` 时要求 JSON 输出，可以是 JSON Schema，也可以是扁平的 `{键: 描述}` 映射；子 agent 会在剩余预算内获得一次修复机会，之后将格式错误作为明确错误返回。

## 编写技能

```
skills/<kebab-case-name>/
  SKILL.md            # required: `name` + `description` frontmatter, then the body
  references/*.md     # optional: loaded individually, on demand
  scripts/*           # optional: listed to the model as reference implementations
```

目录名和 frontmatter 中的 `name` 应保持一致，并使用 kebab-case。`--scan` 会在二者不一致、名称重复或缺少 `description` 时发出警告。模型决定是否触发时只会看到 description，因此它应描述具体能力，并以明确的“Use when …”条款结尾。

脚本只会被公布，不会执行；此 harness 没有执行脚本的工具。

## 测试

```bash
python -m pytest examples/deepseek-skills/tests
```

从仓库根目录运行时，测试路径由 `pytest.ini` 的 `testpaths` 覆盖。
