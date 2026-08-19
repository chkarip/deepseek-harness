"""Offline tests for isolated subagent delegation.

Two layers: `SubagentRunner` in isolation, then the parent wiring in
`DeepSeekAgentHarness.run_turn`, which is where a child's output either stays
distilled or leaks into the parent's context.
"""

from __future__ import annotations

import copy
import json
import threading

import pytest

from skills_system import MODE_LIVE, DeepSeekAgentHarness, SkillManager
from subagents import (
    MAX_DEPTH,
    SUBAGENT_TYPES,
    SubagentRunner,
    build_spawn_tool,
    expected_output_keys,
    normalize_spawn_request,
    resolve_tools,
)


def tool_call(call_id, name, arguments):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}


def response(message, usage=None):
    result = {"choices": [{"message": message}]}
    if usage is not None:
        result["usage"] = usage
    return result


def text_response(content, usage=None):
    return response({"role": "assistant", "content": content}, usage)


def calls_response(*calls, usage=None):
    return response({"role": "assistant", "content": None, "tool_calls": list(calls)}, usage)


class RoutedAPI:
    """Thread-safe `_call_api` double that routes parent and child conversations.

    Children are recognised by their role system prompt and routed by task text,
    so a queue cannot be consumed out of order once children run concurrently.
    """

    def __init__(self, parent=(), children=None, on_child_call=None):
        self.parent_queue = list(parent)
        self.child_queues = {task: list(queue) for task, queue in (children or {}).items()}
        self.on_child_call = on_child_call
        self.parent_messages = []
        self.child_tasks = []
        self.child_tools = []
        self._lock = threading.Lock()

    def __call__(self, messages, tools=None):
        task = None
        is_child = messages[0]["content"].startswith("You are a focused")
        with self._lock:
            if is_child:
                task = messages[1]["content"]
                self.child_tasks.append(task)
                self.child_tools.append([tool["function"]["name"] for tool in tools or []])
                payload = self.child_queues[task].pop(0)
            else:
                # Deep-copy: the loop keeps mutating the same list after the call.
                self.parent_messages.append(copy.deepcopy(messages))
                payload = self.parent_queue.pop(0)
        if is_child and self.on_child_call is not None:
            self.on_child_call(task)
        return payload


def build_parent_harness(tmp_path, api):
    skills_root = tmp_path / "skills"
    (skills_root / "json-envelope").mkdir(parents=True)
    (skills_root / "json-envelope" / "SKILL.md").write_text(
        "---\nname: json-envelope\ndescription: Format JSON envelopes. Use when formatting JSON.\n---\n\nBody.\n",
        encoding="utf-8",
    )
    harness = DeepSeekAgentHarness(SkillManager(skills_root), api_key="test-key", mode=MODE_LIVE)
    harness._call_api = api
    return harness


# ---------------------------------------------------------------------------
# Runner in isolation
# ---------------------------------------------------------------------------


def test_spawn_schema_uses_live_enums_and_depth_cap():
    tool = build_spawn_tool(SUBAGENT_TYPES, 0)
    assert tool["function"]["parameters"]["properties"]["subagent_type"]["enum"] == sorted(SUBAGENT_TYPES)
    assert tool["function"]["parameters"]["properties"]["allowed_tools"]["items"]["enum"]
    assert build_spawn_tool(SUBAGENT_TYPES, MAX_DEPTH) is None


def test_scoping_reports_denied_tools_and_dispatch_rejects_them(tmp_path):
    api = RoutedAPI(children={"review": [
        calls_response(tool_call("x", "run_tests", {})),
        text_response("finished"),
    ]})
    result = SubagentRunner(api, tmp_path).run(task="review", subagent_type="code-review", allowed_tools=["run_tests"])
    assert result.denied_tools == ["run_tests"]
    assert result.text == "finished"
    assert api.child_tools[0] == []


def test_child_does_not_see_parent_history(tmp_path):
    seen = []

    def call_api(messages, tools=None):
        seen.append(messages)
        return text_response("distilled")

    result = SubagentRunner(call_api, tmp_path).run(task="find facts", subagent_type="research")
    assert result.text == "distilled"
    assert [message["role"] for message in seen[0]] == ["system", "user"]
    assert "parent secret" not in json.dumps(seen[0])


def test_batch_runs_children_concurrently_and_preserves_order(tmp_path):
    barrier = threading.Barrier(2)

    def call_api(messages, tools=None):
        task = messages[-1]["content"]
        barrier.wait(timeout=2)
        return text_response(task + " answer", {"total_tokens": 3})

    results = SubagentRunner(call_api, tmp_path).run_batch(
        [{"task": "X", "subagent_type": "research"}, {"task": "Y", "subagent_type": "research"}]
    )
    assert [result.text for result in results] == ["X answer", "Y answer"]


def test_budget_stops_before_next_call(tmp_path):
    calls = 0

    def call_api(_messages, tools=None):
        nonlocal calls
        calls += 1
        return calls_response(tool_call("x", "read_file", {"path": "x"}), usage={"total_tokens": 5000})

    result = SubagentRunner(call_api, tmp_path).run(task="inspect", subagent_type="research")
    assert calls == 1
    assert result.stop_reason == "token_budget"
    assert result.usage["total_tokens"] == 5000


def test_turn_token_budget_refuses_later_spawns(tmp_path):
    def call_api(_messages, tools=None):
        return text_response("done", {"total_tokens": 900})

    # The first child is admitted against an empty meter, then overruns it; the
    # budget's job is to stop the *next* one, not to predict the first's cost.
    runner = SubagentRunner(call_api, tmp_path, turn_token_budget=800)
    first = runner.run(task="a", subagent_type="research")
    second = runner.run(task="b", subagent_type="research")
    assert first.text == "done"
    assert second.stop_reason == "refused"
    assert "subagent budget" in second.text


def test_spawn_ceiling_is_shared_across_the_whole_turn(tmp_path):
    def call_api(_messages, tools=None):
        return text_response("done")

    runner = SubagentRunner(call_api, tmp_path, max_spawns=1)
    runner.run_batch([{"task": "a", "subagent_type": "research"}])
    later = runner.run_batch([{"task": "b", "subagent_type": "research"}])
    assert later[0].stop_reason == "refused"
    assert "maximum of 1 subagents" in later[0].text


def test_child_refuses_nested_delegation(tmp_path):
    api = RoutedAPI(children={"delegate further": [
        calls_response(tool_call("x", "spawn_subagent", {"task": "deeper", "subagent_type": "research"})),
        text_response("handled it myself"),
    ]})
    result = SubagentRunner(api, tmp_path).run(task="delegate further", subagent_type="research", depth=MAX_DEPTH)
    assert "spawn_subagent" not in api.child_tools[0]
    assert result.text == "handled it myself"


# ---------------------------------------------------------------------------
# Argument normalisation and output schemas
# ---------------------------------------------------------------------------


def test_resolve_tools_intersects_role_and_registry():
    allowed, denied = resolve_tools(["read_file", "run_tests", "missing"], "code-review")
    assert allowed == ["read_file"]
    assert denied == ["run_tests", "missing"]


@pytest.mark.parametrize(
    "args, expected",
    [
        ({"task": "t", "subagent_type": "research", "reason": "chatty extra"}, None),
        ({"task": "t", "subagent_type": "research", "depth": 9}, None),
        ({"subagent_type": "research"}, "non-empty string `task`"),
        ({"task": "   ", "subagent_type": "research"}, "non-empty string `task`"),
        ({"task": "t", "subagent_type": "nope"}, "unknown subagent type"),
        ({"task": "t", "subagent_type": "research", "allowed_tools": "read_file"}, "must be an array"),
        ({"task": "t", "subagent_type": "research", "output_schema": "answer"}, "must be a JSON object"),
        ("not a dict", "must be a JSON object"),
    ],
)
def test_normalize_spawn_request_drops_unknown_keys_and_reports_bad_ones(args, expected):
    kwargs, error = normalize_spawn_request(args)
    if expected is None:
        assert error is None
        # Unknown keys are dropped, never forwarded as keyword arguments.
        assert set(kwargs) <= {"task", "subagent_type", "allowed_tools", "output_schema"}
    else:
        assert error is not None and expected in error
        assert kwargs == {}


@pytest.mark.parametrize(
    "schema, expected",
    [
        ({"answer": {"type": "string"}}, ["answer"]),
        ({"type": "object", "properties": {"answer": {}}, "required": ["answer"]}, ["answer"]),
        ({"type": "object", "properties": {"answer": {}, "notes": {}}}, ["answer", "notes"]),
        ({"type": "object"}, []),
    ],
)
def test_expected_output_keys_reads_both_schema_forms(schema, expected):
    assert expected_output_keys(schema) == expected


@pytest.mark.parametrize(
    "schema",
    [
        {"answer": {"type": "string"}},
        {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]},
    ],
    ids=["flat-map", "json-schema"],
)
def test_output_schema_accepts_a_conforming_answer_in_either_form(tmp_path, schema):
    def call_api(_messages, tools=None):
        return text_response('{"answer": "ok"}')

    result = SubagentRunner(call_api, tmp_path).run(task="summarize", subagent_type="research", output_schema=schema)
    assert result.text == '{"answer": "ok"}'
    assert result.iterations == 1


def test_output_schema_gets_one_repair_round_trip(tmp_path):
    responses = [text_response("not json"), text_response('{"answer": "ok"}')]

    def call_api(_messages, tools=None):
        return responses.pop(0)

    result = SubagentRunner(call_api, tmp_path).run(
        task="summarize",
        subagent_type="research",
        output_schema={"answer": {"type": "string"}},
    )
    assert result.text == '{"answer": "ok"}'
    assert responses == []


def test_output_schema_failure_is_explicit_not_malformed_json(tmp_path):
    def call_api(_messages, tools=None):
        return text_response("still not json")

    result = SubagentRunner(call_api, tmp_path).run(
        task="summarize",
        subagent_type="research",
        output_schema={"answer": {"type": "string"}},
    )
    assert result.text == "Error: subagent final answer did not match output_schema."


# ---------------------------------------------------------------------------
# Parent wiring
# ---------------------------------------------------------------------------


def test_parent_gets_distilled_text_while_the_trace_keeps_the_full_record(tmp_path):
    spawn = tool_call("s1", "spawn_subagent", {"task": "find X", "subagent_type": "research"})
    api = RoutedAPI(
        parent=[calls_response(spawn, usage={"total_tokens": 10}), text_response("X is 42", {"total_tokens": 10})],
        children={"find X": [
            calls_response(tool_call("c1", "read_file", {"path": "agent_core.py"}), usage={"total_tokens": 7}),
            text_response("distilled: X is 42", {"total_tokens": 7}),
        ]},
    )
    trace = build_parent_harness(tmp_path, api).run_turn("find X for me")

    assert trace["final_response"] == "X is 42"
    assert [child["subagent_type"] for child in trace["subagents"]] == ["research"]
    assert trace["subagents"][0]["tool_call_count"] == 1
    assert trace["subagents"][0]["stop_reason"] == "completed"

    # Usage stays attributed: parent's own tokens never absorb the child's.
    assert trace["usage"]["total_tokens"] == 20
    assert trace["subagent_usage"]["total_tokens"] == 14

    # The parent sees the distilled answer and nothing else from the child.
    parent_context = json.dumps(api.parent_messages[-1])
    assert "distilled: X is 42" in parent_context
    assert "read_file" not in parent_context
    assert "run_agent_loop" not in parent_context  # the file the child actually read


def test_parent_does_not_spawn_for_a_trivial_prompt(tmp_path):
    api = RoutedAPI(parent=[text_response("4")])
    trace = build_parent_harness(tmp_path, api).run_turn("what is 2+2")

    assert trace["final_response"] == "4"
    assert trace["subagents"] == []
    assert trace["tool_calls"] == []
    assert api.child_tasks == []


def test_parallel_spawns_run_concurrently_and_reply_in_request_order(tmp_path):
    barrier = threading.Barrier(2)
    y_finished = threading.Event()

    def on_child_call(task):
        # Trips unless both children are genuinely in flight at once, then forces
        # Y to finish first so the ordering assertion has teeth.
        barrier.wait(timeout=2)
        if task == "X":
            assert y_finished.wait(timeout=2)
        else:
            y_finished.set()

    api = RoutedAPI(
        parent=[
            calls_response(
                tool_call("s1", "spawn_subagent", {"task": "X", "subagent_type": "research"}),
                tool_call("s2", "spawn_subagent", {"task": "Y", "subagent_type": "research"}),
            ),
            text_response("X answer and Y answer"),
        ],
        children={"X": [text_response("X answer")], "Y": [text_response("Y answer")]},
        on_child_call=on_child_call,
    )
    trace = build_parent_harness(tmp_path, api).run_turn("research X and Y independently, then compare")

    assert sorted(api.child_tasks) == ["X", "Y"]
    replies = [message for message in api.parent_messages[-1] if message["role"] == "tool"]
    assert [(reply["tool_call_id"], reply["content"]) for reply in replies] == [
        ("s1", "X answer"),
        ("s2", "Y answer"),
    ]
    assert [child["text"] for child in trace["subagents"]] == ["X answer", "Y answer"]


def test_malformed_spawn_arguments_do_not_crash_the_turn(tmp_path):
    api = RoutedAPI(
        parent=[
            calls_response(
                tool_call("s1", "spawn_subagent", {"task": "X", "subagent_type": "research", "reason": "extra key"}),
                tool_call("s2", "spawn_subagent", {"subagent_type": "research"}),
                tool_call("s3", "spawn_subagent", {"task": "Z", "subagent_type": "not-a-role"}),
            ),
            text_response("carried on"),
        ],
        children={"X": [text_response("X answer")]},
    )
    trace = build_parent_harness(tmp_path, api).run_turn("delegate three ways")

    replies = [message["content"] for message in api.parent_messages[-1] if message["role"] == "tool"]
    assert replies[0] == "X answer"
    assert "non-empty string `task`" in replies[1]
    assert "unknown subagent type" in replies[2]
    assert trace["final_response"] == "carried on"
    assert [child["stop_reason"] for child in trace["subagents"]] == ["completed", "refused", "refused"]


def test_parent_records_a_child_that_ran_out_of_budget(tmp_path):
    spawn = tool_call("s1", "spawn_subagent", {"task": "loop", "subagent_type": "research"})
    api = RoutedAPI(
        parent=[calls_response(spawn), text_response("child could not finish")],
        children={"loop": [calls_response(tool_call("c1", "read_file", {"path": "x"}), usage={"total_tokens": 9000})]},
    )
    trace = build_parent_harness(tmp_path, api).run_turn("delegate a runaway")

    reply = [message["content"] for message in api.parent_messages[-1] if message["role"] == "tool"][0]
    # A truncated child must never read as a confident answer.
    assert "no final answer" in reply and "token_budget" in reply
    assert trace["subagents"][0]["stop_reason"] == "token_budget"


def test_child_toolset_never_includes_spawn_subagent(tmp_path):
    spawn = tool_call("s1", "spawn_subagent", {"task": "dig", "subagent_type": "research"})
    api = RoutedAPI(
        parent=[calls_response(spawn), text_response("done")],
        children={"dig": [text_response("dug")]},
    )
    harness = build_parent_harness(tmp_path, api)
    harness.run_turn("delegate")

    assert api.child_tools[0] == ["read_file", "web_search"]
    skill_tools = [tool["function"]["name"] for tool in harness.skill_manager.get_tool_definitions()]
    assert "spawn_subagent" not in skill_tools  # only run_turn adds it, and only at depth 0
