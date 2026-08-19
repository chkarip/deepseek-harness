"""Subagent types, tool scoping, and isolated child-agent execution."""

from __future__ import annotations

import json
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from agent_core import LoopResult, run_agent_loop

MAX_DEPTH = 1
MAX_CONCURRENT = 4
MAX_SUBAGENTS_PER_TURN = 8
SUBAGENT_TURN_TOKEN_BUDGET = 16384


@dataclass(frozen=True)
class SubagentType:
    """A narrow child role and its resource limits."""

    name: str
    system_prompt: str
    default_allowed_tools: tuple[str, ...]
    max_iterations: int = 4
    token_budget: int = 4096


COMMON_PROMPT = (
    "Return one distilled final answer with no preamble and no clarifying questions. "
    "State assumptions inline. If the task could not be completed, say so explicitly."
)

SUBAGENT_TYPES: Dict[str, SubagentType] = {
    "research": SubagentType(
        "research",
        "You are a focused research subagent. Gather only the facts needed for the task. " + COMMON_PROMPT,
        ("read_file", "web_search"),
    ),
    "code-review": SubagentType(
        "code-review",
        "You are a focused code-review subagent. Identify concrete bugs and risks and cite affected files. " + COMMON_PROMPT,
        ("read_file",),
    ),
    "test-runner": SubagentType(
        "test-runner",
        "You are a focused test-running subagent. Run the available focused checks and report their outcome. " + COMMON_PROMPT,
        ("read_file", "run_tests"),
    ),
}


@dataclass(frozen=True)
class ToolSpec:
    """A model-visible tool schema paired with its local handler."""

    schema: Dict[str, Any]
    handler: Callable[[Dict[str, Any]], str]


@dataclass
class SubagentResult:
    """Distilled child output plus parent-visible accounting metadata."""

    text: str
    subagent_type: str
    stop_reason: str
    iterations: int
    usage: Dict[str, int] = field(default_factory=dict)
    tool_call_count: int = 0
    denied_tools: List[str] = field(default_factory=list)

    def as_trace(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "subagent_type": self.subagent_type,
            "stop_reason": self.stop_reason,
            "iterations": self.iterations,
            "usage": dict(self.usage),
            "tool_call_count": self.tool_call_count,
            "denied_tools": list(self.denied_tools),
        }


def _function_schema(name: str, description: str, properties: Dict[str, Any], required: List[str]) -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


def _tool_definitions() -> Dict[str, ToolSpec]:
    return {
        "read_file": ToolSpec(
            _function_schema(
                "read_file",
                "Read a UTF-8 file under the example root.",
                {"path": {"type": "string"}},
                ["path"],
            ),
            lambda _args: "",
        ),
        "run_tests": ToolSpec(
            _function_schema(
                "run_tests",
                "Run the fixed offline pytest fixture suite; arguments are intentionally ignored.",
                {},
                [],
            ),
            lambda _args: "",
        ),
        "web_search": ToolSpec(
            _function_schema(
                "web_search",
                "Offline fixture-backed search stub. This is not live web search.",
                {"query": {"type": "string"}},
                ["query"],
            ),
            lambda _args: "",
        ),
    }


TOOL_REGISTRY = _tool_definitions()

#: The only keys a parent may pass through to `SubagentRunner.run`.
SPAWN_ARGUMENT_KEYS = ("task", "subagent_type", "allowed_tools", "output_schema")


def normalize_spawn_request(args: Any) -> Tuple[Dict[str, Any], Optional[str]]:
    """Reduce model-supplied spawn arguments to safe keyword arguments.

    The model controls this dict, so it must never be splatted into `run`
    directly: an unrecognised key, a missing `task`, or a stray `depth` would
    raise `TypeError` on the calling thread and take the whole parent turn down
    with it. Returns `(kwargs, error_message)`; the error is a tool result the
    model can read and retry from.
    """
    if not isinstance(args, dict):
        return {}, "Error: `spawn_subagent` arguments must be a JSON object."

    kwargs = {key: args[key] for key in SPAWN_ARGUMENT_KEYS if key in args}

    task = kwargs.get("task")
    if not isinstance(task, str) or not task.strip():
        return {}, "Error: `spawn_subagent` requires a non-empty string `task`."

    subagent_type = kwargs.get("subagent_type")
    if subagent_type not in SUBAGENT_TYPES:
        available = ", ".join(sorted(SUBAGENT_TYPES))
        return {}, f"Error: unknown subagent type {subagent_type!r}. Available types: {available}."

    allowed_tools = kwargs.get("allowed_tools")
    if allowed_tools is not None and not isinstance(allowed_tools, (list, tuple)):
        return {}, "Error: `spawn_subagent` `allowed_tools` must be an array of tool names."

    output_schema = kwargs.get("output_schema")
    if output_schema is not None and not isinstance(output_schema, dict):
        return {}, "Error: `spawn_subagent` `output_schema` must be a JSON object."

    return kwargs, None


def resolve_tools(requested: Optional[Sequence[str]], subagent_type: str) -> Tuple[List[str], List[str]]:
    """Resolve requested tools against the role registry.

    `allowed_tools` can only narrow a role's defaults, never widen them. Depth is
    enforced elsewhere — `build_spawn_tool` omits the tool from the child schema
    and the child dispatcher refuses it — so `spawn_subagent` never reaches this
    intersection in the first place.
    """
    role = SUBAGENT_TYPES[subagent_type]
    candidates = list(requested) if requested is not None else list(role.default_allowed_tools)
    allowed = set(role.default_allowed_tools) & set(TOOL_REGISTRY)
    resolved = [name for name in candidates if name in allowed]
    denied = [name for name in candidates if name not in allowed]
    return resolved, denied


def build_spawn_tool(registry: Dict[str, SubagentType], depth: int) -> Optional[Dict[str, Any]]:
    """Build the live enum-constrained spawn tool for a parent depth."""
    if depth >= MAX_DEPTH:
        return None
    properties: Dict[str, Any] = {
        "task": {"type": "string", "description": "A self-contained task; inline all context the child needs."},
        "subagent_type": {"type": "string", "enum": sorted(registry)},
        "allowed_tools": {
            "type": "array",
            "items": {"type": "string", "enum": sorted(TOOL_REGISTRY)},
            "description": "Narrows the role's default tools; it cannot grant a tool the role does not have.",
        },
        "output_schema": {
            "type": "object",
            "description": "Optional JSON Schema, or a flat {key: description} map, that the answer must satisfy.",
        },
    }
    description = (
        "Delegate one self-contained subtask to an isolated agent. The child cannot see parent history; "
        "include all needed context in task."
    )
    return _function_schema("spawn_subagent", description, properties, ["task", "subagent_type"])


def expected_output_keys(schema: Dict[str, Any]) -> List[str]:
    """Keys a child's JSON answer must carry to satisfy `output_schema`.

    Accepts both a JSON Schema (`required`, else `properties`) and the flat
    `{key: description}` map, because the tool contract permits either. Reading a
    JSON Schema's own top-level keys as the expected answer keys would demand
    literal `type`/`properties` fields in the answer, and never validate.
    """
    if not isinstance(schema, dict):
        return []
    required = schema.get("required")
    if isinstance(required, list):
        return [key for key in required if isinstance(key, str)]
    properties = schema.get("properties")
    if isinstance(properties, dict):
        return [key for key in properties if isinstance(key, str)]
    if schema.get("type") == "object":
        return []
    return [key for key in schema if isinstance(key, str)]


class SubagentRunner:
    """Runs children with isolated messages and an enforced tool allow-list.

    One instance covers one parent turn: `max_spawns` and `turn_token_budget` are
    turn-wide ceilings shared by every child it starts, so N concurrent runaways
    are contained rather than only one.
    """

    def __init__(
        self,
        call_api: Callable[..., Dict[str, Any]],
        root: str | Path,
        *,
        max_spawns: int = MAX_SUBAGENTS_PER_TURN,
        turn_token_budget: int = SUBAGENT_TURN_TOKEN_BUDGET,
    ):
        self.call_api = call_api
        self.root = Path(root).resolve()
        self.max_spawns = max_spawns
        self.turn_token_budget = turn_token_budget
        self._lock = threading.Lock()
        self._spawns_started = 0
        self._tokens_spent = 0

    @property
    def tokens_spent(self) -> int:
        with self._lock:
            return self._tokens_spent

    @property
    def spawns_started(self) -> int:
        with self._lock:
            return self._spawns_started

    def _reserve_spawn(self) -> Optional[str]:
        """Claim one spawn slot, or explain why this turn has no room left."""
        with self._lock:
            if self._spawns_started >= self.max_spawns:
                return f"Error: this turn already started its maximum of {self.max_spawns} subagents."
            if self._tokens_spent >= self.turn_token_budget:
                return f"Error: this turn exhausted its {self.turn_token_budget}-token subagent budget."
            self._spawns_started += 1
            return None

    def _spend(self, usage: Dict[str, int]) -> None:
        spent = usage.get("total_tokens", 0)
        if not isinstance(spent, int) or spent < 0:
            return
        with self._lock:
            self._tokens_spent += spent

    def _read_file(self, args: Dict[str, Any]) -> str:
        raw_path = args.get("path")
        if not isinstance(raw_path, str):
            return "Error: read_file requires a string path."
        path = (self.root / raw_path).resolve()
        try:
            path.relative_to(self.root)
        except ValueError:
            return "Error: read_file path escapes the example root."
        try:
            return path.read_text(encoding="utf-8")
        except OSError as exc:
            return f"Error: cannot read file: {exc}"

    def _run_tests(self, _args: Dict[str, Any]) -> str:
        try:
            completed = subprocess.run(
                ["python", "-m", "pytest", str(self.root / "tests")],
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return f"Error: test runner failed: {exc}"
        output = (completed.stdout + completed.stderr).strip()
        return output[-4000:] or f"pytest exited with status {completed.returncode}"

    @staticmethod
    def _web_search(_args: Dict[str, Any]) -> str:
        return "Offline search fixture: no live web results are available."

    def _handler(self, name: str) -> Callable[[Dict[str, Any]], str]:
        return {"read_file": self._read_file, "run_tests": self._run_tests, "web_search": self._web_search}[name]

    def run(
        self,
        *,
        task: str,
        subagent_type: str,
        allowed_tools: Optional[Sequence[str]] = None,
        output_schema: Optional[Dict[str, Any]] = None,
        depth: int = 0,
    ) -> SubagentResult:
        if subagent_type not in SUBAGENT_TYPES:
            return SubagentResult(f"Error: unknown subagent type: {subagent_type}", str(subagent_type), "refused", 0)

        refusal = self._reserve_spawn()
        if refusal is not None:
            return SubagentResult(refusal, subagent_type, "refused", 0)

        resolved, denied = resolve_tools(allowed_tools, subagent_type)
        role = SUBAGENT_TYPES[subagent_type]
        system_prompt = role.system_prompt
        if output_schema is not None:
            system_prompt += " Return JSON matching this schema: " + json.dumps(output_schema, sort_keys=True)

        tools = [TOOL_REGISTRY[name].schema for name in resolved]

        def dispatch(name: str, args: Dict[str, Any]) -> str:
            if name not in resolved:
                if name == "spawn_subagent" and depth >= MAX_DEPTH:
                    return "Error: subagent depth limit reached; nested delegation is refused."
                return f"Error: tool '{name}' is not available to this subagent."
            return self._handler(name)(args)

        loop: LoopResult = run_agent_loop(
            call_api=self.call_api,
            system_prompt=system_prompt,
            user_prompt=task,
            tools=tools,
            dispatch=dispatch,
            max_iterations=role.max_iterations,
            token_budget=role.token_budget,
        )
        text = loop.final_text
        if output_schema is not None and loop.stop_reason == "completed":
            required_keys = expected_output_keys(output_schema)

            def validate(candidate: str) -> Optional[str]:
                try:
                    parsed = json.loads(candidate)
                except (TypeError, ValueError, json.JSONDecodeError):
                    return None
                if not isinstance(parsed, dict) or any(key not in parsed for key in required_keys):
                    return None
                return json.dumps(parsed, sort_keys=True)

            validated = validate(text)
            remaining_tokens = role.token_budget - loop.usage.get("total_tokens", 0)
            if validated is None and loop.iterations < role.max_iterations and remaining_tokens > 0:
                repair = run_agent_loop(
                    call_api=self.call_api,
                    system_prompt=system_prompt,
                    user_prompt="Repair your previous answer into valid JSON matching the requested schema. Return JSON only.",
                    tools=tools,
                    dispatch=dispatch,
                    max_iterations=role.max_iterations - loop.iterations,
                    token_budget=remaining_tokens,
                )
                loop.iterations += repair.iterations
                loop.stop_reason = repair.stop_reason
                for key, value in repair.usage.items():
                    loop.usage[key] = loop.usage.get(key, 0) + value
                validated = validate(repair.final_text)
            text = validated or "Error: subagent final answer did not match output_schema."

        self._spend(loop.usage)
        return SubagentResult(text, subagent_type, loop.stop_reason, loop.iterations, loop.usage, len(loop.tool_calls), denied)

    def run_batch(self, requests: Sequence[Dict[str, Any]], depth: int = 0) -> List[SubagentResult]:
        """Run independent child requests concurrently, results in request order.

        Ordering is part of the wire contract — every `tool_call` id must get its
        own reply — so completion order is never allowed to reorder the output.
        """
        requests = list(requests)
        results: List[Optional[SubagentResult]] = [None] * len(requests)
        pending: List[Tuple[int, str, Any]] = []

        with ThreadPoolExecutor(max_workers=min(len(requests), MAX_CONCURRENT) or 1) as executor:
            for index, request in enumerate(requests):
                kwargs, arg_error = normalize_spawn_request(request)
                if arg_error is not None:
                    raw_type = request.get("subagent_type") if isinstance(request, dict) else None
                    results[index] = SubagentResult(arg_error, str(raw_type or "unknown"), "refused", 0)
                    continue
                pending.append((index, kwargs["subagent_type"], executor.submit(self.run, depth=depth + 1, **kwargs)))

            for index, subagent_type, future in pending:
                try:
                    results[index] = future.result()
                except Exception as exc:  # noqa: BLE001 - a child must never take the parent turn down
                    results[index] = SubagentResult(f"Error: subagent failed: {exc}", subagent_type, "error", 0)

        return [result for result in results if result is not None]
