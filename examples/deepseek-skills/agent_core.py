"""Reusable, transport-agnostic agent loop for the prototype harness."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple


@dataclass
class LoopResult:
    """The final answer and observability data produced by one agent loop."""

    final_text: str
    iterations: int
    stop_reason: str
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    usage: Dict[str, int] = field(default_factory=dict)
    messages: List[Dict[str, Any]] = field(default_factory=list)


Dispatch = Callable[[str, Dict[str, Any]], str]
ToolCallHook = Callable[[str, Dict[str, Any], str], None]
BatchDispatch = Callable[[Sequence[Tuple[str, Dict[str, Any]]]], Sequence[str]]


def _parse_arguments(raw_arguments: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if raw_arguments in (None, ""):
        return {}, None
    if isinstance(raw_arguments, dict):
        return raw_arguments, None
    try:
        parsed = json.loads(raw_arguments)
    except (TypeError, json.JSONDecodeError) as exc:
        return None, f"Error: could not parse tool arguments as JSON ({exc}). Retry with valid JSON."
    if not isinstance(parsed, dict):
        return None, "Error: tool arguments must be a JSON object."
    return parsed, None


def _merge_usage(total: Dict[str, int], response: Dict[str, Any], warnings: List[str]) -> None:
    usage = response.get("usage")
    if usage is None:
        warnings.append("API response omitted usage; counted as zero")
        return
    if not isinstance(usage, dict):
        warnings.append("API response contained invalid usage; counted as zero")
        return
    for key, value in usage.items():
        if isinstance(value, int) and value >= 0:
            total[key] = total.get(key, 0) + value


def run_agent_loop(
    *,
    call_api: Callable[[List[Dict[str, Any]], Optional[List[Dict[str, Any]]]], Dict[str, Any]],
    system_prompt: str,
    user_prompt: str,
    tools: List[Dict[str, Any]],
    dispatch: Dispatch,
    max_iterations: int,
    token_budget: Optional[int] = None,
    on_tool_call: Optional[ToolCallHook] = None,
    dispatch_batch: Optional[BatchDispatch] = None,
) -> LoopResult:
    """Run an isolated chat-completions conversation until it returns text."""
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    result = LoopResult("", 0, "completed", messages=messages)

    for iteration in range(max_iterations):
        if token_budget is not None and result.usage.get("total_tokens", 0) >= token_budget:
            result.stop_reason = "token_budget"
            result.warnings.append(f"stopped before iteration {iteration + 1}: token budget exhausted")
            break

        result.iterations = iteration + 1
        response = call_api(messages, tools=tools)
        _merge_usage(result.usage, response, result.warnings)
        message = response["choices"][0]["message"]
        tool_calls = message.get("tool_calls") or []

        if not tool_calls:
            result.final_text = message.get("content") or ""
            break

        messages.append(message)
        parsed_calls: List[Tuple[str, Dict[str, Any], str]] = []
        for position, tool_call in enumerate(tool_calls):
            func = tool_call.get("function") or {}
            name = func.get("name") or "<missing>"
            args, arg_error = _parse_arguments(func.get("arguments"))
            call_id = tool_call.get("id") or f"call_{iteration}_{position}"
            if not tool_call.get("id"):
                result.warnings.append(f"tool call {name!r} had no id; synthesized {call_id!r}")
            result.tool_calls.append({"tool": name, "args": args, "id": call_id})
            parsed_calls.append((name, args or {}, arg_error or ""))

        dispatchable = [(name, args) for name, args, error in parsed_calls if not error]
        batch_results: Sequence[str] = []
        if dispatch_batch is not None and dispatchable:
            batch_results = dispatch_batch(dispatchable)
        batch_index = 0
        for call_index, (name, args, arg_error) in enumerate(parsed_calls):
            if arg_error:
                tool_result = arg_error
            elif dispatch_batch is not None:
                tool_result = batch_results[batch_index]
                batch_index += 1
            else:
                tool_result = dispatch(name, args)
            if on_tool_call is not None:
                on_tool_call(name, args, tool_result)
            call_record = result.tool_calls[-len(parsed_calls) + call_index]
            messages.append({"role": "tool", "tool_call_id": call_record["id"], "content": tool_result})

    else:
        result.stop_reason = "max_iterations"
        result.warnings.append(f"stopped after {max_iterations} iterations without a final answer")

    # Parent and children share this loop, so an empty answer must never read as
    # a confident one — and the wording must not claim a child ran.
    if result.stop_reason != "completed" and not result.final_text:
        result.final_text = f"agent produced no final answer (stopped: {result.stop_reason})"
    return result
