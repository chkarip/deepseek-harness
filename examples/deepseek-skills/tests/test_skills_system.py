"""Tests for the DeepSeek skills system prototype.

Coverage focuses on the failure modes that are invisible in a happy-path manual
run: tool-message ordering, transport retries, progressive (lazy) reference
loading, and the live-vs-mock distinction in the evaluation report.
"""

from __future__ import annotations

import copy
import io
import json
import threading
import urllib.error
import urllib.request

import pytest

from skills_system import (
    MODE_AUTO,
    MODE_LIVE,
    MODE_MOCK,
    DeepSeekAgentHarness,
    HarnessAPIError,
    SkillManager,
    SkillTestHarness,
    TestCase,
)

# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------


def write_skill(root, dir_name, *, name=None, description="Does a thing. Use when testing.", body="Body text."):
    """Create `<root>/<dir_name>/SKILL.md` with frontmatter and return its directory."""
    skill_dir = root / dir_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    front_name = dir_name if name is None else name
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {front_name}\ndescription: {description}\n---\n\n{body}\n",
        encoding="utf-8",
    )
    return skill_dir


@pytest.fixture
def skills_root(tmp_path):
    root = tmp_path / "skills"
    root.mkdir()
    return root


@pytest.fixture
def manager(skills_root):
    skill_dir = write_skill(
        skills_root,
        "json-envelope",
        description="Format JSON envelopes. Use when formatting JSON.",
        body="Wrap payloads in the standard envelope.",
    )
    (skill_dir / "references").mkdir()
    (skill_dir / "references" / "schema-spec.md").write_text(
        "UNIQUE_REFERENCE_MARKER\n", encoding="utf-8"
    )
    (skill_dir / "scripts").mkdir()
    (skill_dir / "scripts" / "format_json.py").write_text("print('hi')\n", encoding="utf-8")
    write_skill(skills_root, "git-commit-helper", description="Write commits. Use when committing.")
    return SkillManager(skills_root)


class FakeAPI:
    """Stand-in for `_call_api` that records the exact message list per call."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []
        # Concurrent subagents share one `_call_api`; an unguarded pop would race.
        self._lock = threading.Lock()

    def __call__(self, messages, tools=None):
        with self._lock:
            # Deep-copy: run_turn mutates the same list after the call returns.
            self.calls.append(copy.deepcopy(messages))
            return self.responses.pop(0)


def assistant_tool_calls(*calls):
    return {"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": list(calls)}}]}


def assistant_text(text):
    return {"choices": [{"message": {"role": "assistant", "content": text}}]}


def tool_call(call_id, name, arguments):
    raw = arguments if isinstance(arguments, str) else json.dumps(arguments)
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": raw}}


def build_harness(manager, *responses, **kwargs):
    kwargs.setdefault("api_key", "test-key")
    kwargs.setdefault("mode", MODE_LIVE)
    harness = DeepSeekAgentHarness(manager, **kwargs)
    fake = FakeAPI(*responses)
    harness._call_api = fake
    return harness, fake


# ---------------------------------------------------------------------------
# Frontmatter parsing
# ---------------------------------------------------------------------------


def test_scan_indexes_frontmatter_without_reading_body(manager):
    assert manager.skill_names() == ["git-commit-helper", "json-envelope"]
    summary = manager.get_summary("json-envelope")
    assert summary.description.startswith("Format JSON envelopes")
    assert not hasattr(summary, "body")


def test_fallback_parser_handles_block_scalars_and_lists(skills_root):
    (skills_root / "blocky").mkdir()
    (skills_root / "blocky" / "SKILL.md").write_text(
        "---\n"
        "name: blocky\n"
        "description: >-\n"
        "  first line\n"
        "  second line\n"
        "tags:\n"
        "  - alpha\n"
        "  - beta\n"
        "---\n\nBody\n",
        encoding="utf-8",
    )
    mgr = SkillManager(skills_root)
    metadata, body = mgr._parse_frontmatter_fallback(
        "name: blocky\ndescription: >-\n  first line\n  second line\ntags:\n  - alpha\n  - beta\n",
        skills_root / "blocky" / "SKILL.md",
    ), None
    assert metadata["description"] == "first line second line"
    assert metadata["tags"] == ["alpha", "beta"]


def test_fallback_parser_warns_instead_of_silently_dropping(manager, tmp_path):
    manager.warnings.clear()
    metadata = manager._parse_frontmatter_fallback("name: ok\nthis line has no colon\n", tmp_path / "x.md")
    assert metadata == {"name": "ok"}
    assert any("dropped unparsable" in w for w in manager.warnings)


def test_non_mapping_frontmatter_falls_back(skills_root):
    (skills_root / "scalar").mkdir()
    (skills_root / "scalar" / "SKILL.md").write_text(
        "---\njust a bare string\n---\n\nBody\n", encoding="utf-8"
    )
    mgr = SkillManager(skills_root)
    # Falls back to the directory name rather than crashing.
    assert "scalar" in mgr.skill_names()


# ---------------------------------------------------------------------------
# Discovery warnings
# ---------------------------------------------------------------------------


def test_duplicate_skill_name_warns(skills_root):
    write_skill(skills_root, "alpha", name="shared")
    write_skill(skills_root, "beta", name="shared")
    mgr = SkillManager(skills_root)
    assert mgr.skill_names() == ["shared"]
    assert any("duplicate skill name" in w for w in mgr.warnings)


def test_non_kebab_name_and_dir_mismatch_warn(skills_root):
    write_skill(skills_root, "my-skill", name="My_Skill")
    mgr = SkillManager(skills_root)
    assert any("not kebab-case" in w for w in mgr.warnings)
    assert any("does not match directory" in w for w in mgr.warnings)


def test_missing_description_warns(skills_root):
    (skills_root / "bare").mkdir()
    (skills_root / "bare" / "SKILL.md").write_text("---\nname: bare\n---\n\nBody\n", encoding="utf-8")
    mgr = SkillManager(skills_root)
    assert any("missing `description`" in w for w in mgr.warnings)


def test_missing_skills_dir_warns(tmp_path):
    mgr = SkillManager(tmp_path / "nope")
    assert len(mgr) == 0
    assert any("does not exist" in w for w in mgr.warnings)


# ---------------------------------------------------------------------------
# Progressive loading (level 2 vs level 3)
# ---------------------------------------------------------------------------


def test_load_skill_lists_references_without_inlining_them(manager):
    rendered = manager.load_skill("json-envelope")
    assert "Wrap payloads in the standard envelope." in rendered
    assert "schema-spec.md" in rendered
    # The whole point: reference *content* stays out of context until asked for.
    assert "UNIQUE_REFERENCE_MARKER" not in rendered


def test_load_skill_marks_scripts_as_non_executable(manager):
    rendered = manager.load_skill("json-envelope")
    assert "scripts/format_json.py" in rendered
    assert "cannot execute" in rendered


def test_read_reference_returns_content(manager):
    out = manager.read_reference("json-envelope", "schema-spec.md")
    assert "UNIQUE_REFERENCE_MARKER" in out
    assert 'skill="json-envelope"' in out


@pytest.mark.parametrize("bad", ["../../SKILL.md", "../SKILL.md", "/etc/passwd"])
def test_read_reference_rejects_traversal(manager, bad):
    out = manager.read_reference("json-envelope", bad)
    assert out.startswith("Error:")
    assert "UNIQUE_REFERENCE_MARKER" not in out


def test_read_reference_unknown_names_are_errors_not_exceptions(manager):
    assert manager.read_reference("nope", "x.md").startswith("Error: Skill 'nope' not found")
    assert manager.read_reference("json-envelope", "missing.md").startswith("Error: reference")


def test_load_unknown_skill_lists_alternatives(manager):
    out = manager.load_skill("ghost")
    assert "not found" in out
    assert "git-commit-helper" in out


# ---------------------------------------------------------------------------
# Tool schema
# ---------------------------------------------------------------------------


def test_tool_definitions_constrain_skill_name_with_enum(manager):
    tools = manager.get_tool_definitions()
    names = [t["function"]["name"] for t in tools]
    assert names == ["load_skill", "read_skill_reference"]
    load_params = tools[0]["function"]["parameters"]["properties"]["name"]
    assert load_params["enum"] == ["git-commit-helper", "json-envelope"]


def test_tool_definitions_omit_enum_when_no_skills(tmp_path):
    mgr = SkillManager(tmp_path)
    load_params = mgr.get_tool_definitions()[0]["function"]["parameters"]["properties"]["name"]
    assert "enum" not in load_params


# ---------------------------------------------------------------------------
# Agent loop / message ordering
# ---------------------------------------------------------------------------


def test_batched_tool_calls_append_assistant_message_exactly_once(manager):
    """Regression: the assistant turn used to be appended once per tool call."""
    harness, fake = build_harness(
        manager,
        assistant_tool_calls(
            tool_call("call_a", "load_skill", {"name": "json-envelope"}),
            tool_call("call_b", "load_skill", {"name": "git-commit-helper"}),
        ),
        assistant_text("done"),
    )

    trace = harness.run_turn("format some json and write a commit")

    second_call = fake.calls[1]
    assistant_msgs = [m for m in second_call if m.get("role") == "assistant"]
    assert len(assistant_msgs) == 1

    tool_msgs = [m for m in second_call if m.get("role") == "tool"]
    assert [m["tool_call_id"] for m in tool_msgs] == ["call_a", "call_b"]
    assert second_call.index(assistant_msgs[0]) < second_call.index(tool_msgs[0])
    assert trace["skills_loaded"] == ["json-envelope", "git-commit-helper"]
    assert trace["skill_loaded"] == "json-envelope"


def test_unknown_tool_still_gets_a_tool_reply(manager):
    harness, fake = build_harness(
        manager,
        assistant_tool_calls(tool_call("call_x", "definitely_not_a_tool", {})),
        assistant_text("recovered"),
    )
    trace = harness.run_turn("do something")
    tool_msgs = [m for m in fake.calls[1] if m.get("role") == "tool"]
    assert [m["tool_call_id"] for m in tool_msgs] == ["call_x"]
    assert "unknown tool" in tool_msgs[0]["content"]
    assert trace["final_response"] == "recovered"


def test_malformed_tool_arguments_do_not_raise(manager):
    harness, fake = build_harness(
        manager,
        assistant_tool_calls(tool_call("call_x", "load_skill", "{not json")),
        assistant_text("recovered"),
    )
    trace = harness.run_turn("format json")
    tool_msgs = [m for m in fake.calls[1] if m.get("role") == "tool"]
    assert "could not parse tool arguments" in tool_msgs[0]["content"]
    assert trace["skill_loaded"] is None


def test_missing_tool_call_id_is_synthesized_and_recorded(manager):
    harness, fake = build_harness(
        manager,
        assistant_tool_calls({"function": {"name": "load_skill", "arguments": '{"name": "json-envelope"}'}}),
        assistant_text("ok"),
    )
    trace = harness.run_turn("format json")
    tool_msgs = [m for m in fake.calls[1] if m.get("role") == "tool"]
    assert tool_msgs[0]["tool_call_id"] == "call_0_0"
    assert any("synthesized" in w for w in trace["warnings"])


def test_loop_continues_so_references_load_in_the_same_turn(manager):
    harness, fake = build_harness(
        manager,
        assistant_tool_calls(tool_call("c1", "load_skill", {"name": "json-envelope"})),
        assistant_tool_calls(
            tool_call("c2", "read_skill_reference", {"skill_name": "json-envelope", "file_name": "schema-spec.md"})
        ),
        assistant_text("final answer"),
    )
    trace = harness.run_turn("format json using the spec")
    assert trace["iterations"] == 3
    assert trace["final_response"] == "final answer"
    ref_msg = [m for m in fake.calls[2] if m.get("role") == "tool"][-1]
    assert "UNIQUE_REFERENCE_MARKER" in ref_msg["content"]


def test_tools_are_passed_on_every_iteration(manager):
    """The follow-up call used to drop `tools`, making a second load impossible."""
    seen = []

    def recording(messages, tools=None):
        seen.append(tools)
        return assistant_text("done") if len(seen) > 1 else assistant_tool_calls(
            tool_call("c1", "load_skill", {"name": "json-envelope"})
        )

    harness = DeepSeekAgentHarness(manager, api_key="k", mode=MODE_LIVE)
    harness._call_api = recording
    harness.run_turn("format json")
    assert all(t is not None for t in seen)


def test_max_iterations_stops_the_loop(manager):
    responses = [assistant_tool_calls(tool_call(f"c{i}", "load_skill", {"name": "json-envelope"})) for i in range(5)]
    harness, _ = build_harness(manager, *responses, max_iterations=3)
    trace = harness.run_turn("loop forever")
    assert trace["iterations"] == 3
    assert trace["stop_reason"] == "max_iterations"


# ---------------------------------------------------------------------------
# Transport: retries and error handling
# ---------------------------------------------------------------------------


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


def http_error(code):
    return urllib.error.HTTPError("http://x", code, "boom", {}, io.BytesIO(b'{"error":"boom"}'))


def test_retries_on_429_then_succeeds(manager, monkeypatch):
    harness = DeepSeekAgentHarness(manager, api_key="k", mode=MODE_LIVE, retry_backoff_s=0)
    slept = []
    harness._sleep = slept.append
    attempts = []

    def fake_urlopen(request, timeout=None):
        attempts.append(1)
        if len(attempts) < 3:
            raise http_error(429)
        return FakeResponse(json.dumps(assistant_text("ok")).encode())

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    result = harness._call_api([{"role": "user", "content": "hi"}])
    assert result["choices"][0]["message"]["content"] == "ok"
    assert len(attempts) == 3
    assert len(slept) == 2


def test_non_retryable_status_raises_harness_error(manager, monkeypatch):
    harness = DeepSeekAgentHarness(manager, api_key="k", mode=MODE_LIVE, retry_backoff_s=0)
    harness._sleep = lambda _s: None

    def fake_urlopen(request, timeout=None):
        raise http_error(401)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(HarnessAPIError, match="HTTP 401"):
        harness._call_api([{"role": "user", "content": "hi"}])


def test_retries_are_bounded(manager, monkeypatch):
    harness = DeepSeekAgentHarness(manager, api_key="k", mode=MODE_LIVE, max_retries=2, retry_backoff_s=0)
    harness._sleep = lambda _s: None
    attempts = []

    def fake_urlopen(request, timeout=None):
        attempts.append(1)
        raise http_error(503)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(HarnessAPIError):
        harness._call_api([{"role": "user", "content": "hi"}])
    assert len(attempts) == 3  # initial attempt + 2 retries


def test_non_json_body_raises_harness_error(manager, monkeypatch):
    harness = DeepSeekAgentHarness(manager, api_key="k", mode=MODE_LIVE)
    monkeypatch.setattr(urllib.request, "urlopen", lambda r, timeout=None: FakeResponse(b"<html>502</html>"))
    with pytest.raises(HarnessAPIError, match="non-JSON"):
        harness._call_api([{"role": "user", "content": "hi"}])


def test_missing_choices_raises_harness_error(manager, monkeypatch):
    harness = DeepSeekAgentHarness(manager, api_key="k", mode=MODE_LIVE)
    monkeypatch.setattr(urllib.request, "urlopen", lambda r, timeout=None: FakeResponse(b'{"id":"x"}'))
    with pytest.raises(HarnessAPIError, match="no choices"):
        harness._call_api([{"role": "user", "content": "hi"}])


def test_missing_api_key_raises_before_any_request(manager):
    harness = DeepSeekAgentHarness(manager, api_key="", mode=MODE_LIVE)
    with pytest.raises(HarnessAPIError, match="DEEPSEEK_API_KEY"):
        harness._call_api([{"role": "user", "content": "hi"}])


# ---------------------------------------------------------------------------
# Mode resolution
# ---------------------------------------------------------------------------


def test_auto_mode_degrades_to_mock_without_key(manager):
    assert DeepSeekAgentHarness(manager, api_key="", mode=MODE_AUTO).resolve_mode() == MODE_MOCK


def test_auto_mode_uses_live_with_key(manager):
    assert DeepSeekAgentHarness(manager, api_key="k", mode=MODE_AUTO).resolve_mode() == MODE_LIVE


def test_mock_mode_wins_over_present_key(manager):
    assert DeepSeekAgentHarness(manager, api_key="k", mode=MODE_MOCK).resolve_mode() == MODE_MOCK


def test_unknown_mode_rejected(manager):
    with pytest.raises(ValueError, match="unknown mode"):
        DeepSeekAgentHarness(manager, mode="sideways").resolve_mode()


def test_mock_turn_never_calls_the_api(manager):
    harness = DeepSeekAgentHarness(manager, api_key="k", mode=MODE_MOCK)

    def explode(*_a, **_k):
        raise AssertionError("mock mode must not hit the network")

    harness._call_api = explode
    trace = harness.run_turn("Please format JSON for this payload")
    assert trace["mode"] == MODE_MOCK
    assert trace["skill_loaded"] == "json-envelope"


def test_custom_mock_resolver_is_used(manager):
    harness = DeepSeekAgentHarness(manager, api_key="k", mode=MODE_LIVE)
    trace = harness.run_turn("anything", mock_skill_resolver=lambda _p, _i: "git-commit-helper")
    assert trace["mode"] == MODE_MOCK
    assert trace["skill_loaded"] == "git-commit-helper"


# ---------------------------------------------------------------------------
# Evaluation reporting
# ---------------------------------------------------------------------------


def test_evaluation_records_mode_and_survives_api_errors(manager):
    harness = DeepSeekAgentHarness(manager, api_key="k", mode=MODE_LIVE)

    def boom(*_a, **_k):
        raise HarnessAPIError("upstream down")

    harness._call_api = boom
    cases = [
        TestCase(prompt="format json", expected_skill="json-envelope", description="a"),
        TestCase(prompt="write a commit", expected_skill="git-commit-helper", description="b"),
    ]
    results = SkillTestHarness(harness).run_evaluation(cases)

    assert results["mode"] == MODE_LIVE
    assert results["errors"] == 2  # both cases errored, neither aborted the run
    assert results["correct"] == 0
    assert all(r["error"] == "upstream down" for r in results["results"])


def test_report_flags_mock_mode(manager, capsys):
    harness = DeepSeekAgentHarness(manager, api_key="", mode=MODE_AUTO)
    evaluator = SkillTestHarness(harness)
    evaluator.print_report(evaluator.run_evaluation([
        TestCase(prompt="format json please", expected_skill="json-envelope", description="a"),
    ]))
    out = capsys.readouterr().out
    assert "OFFLINE keyword heuristic" in out
    assert "NOT DeepSeek" in out


def test_report_labels_live_mode(manager, capsys):
    harness = DeepSeekAgentHarness(manager, api_key="k", mode=MODE_LIVE)
    harness._call_api = FakeAPI(assistant_text("hi"))
    evaluator = SkillTestHarness(harness)
    evaluator.print_report(evaluator.run_evaluation([
        TestCase(prompt="hello", expected_skill=None, description="control"),
    ]))
    out = capsys.readouterr().out
    assert "LIVE DeepSeek API" in out
    assert "NOT DeepSeek" not in out


def test_negative_control_failure_gives_a_sensible_tip(manager, capsys):
    """Regression: the diagnostic used to print `skills/(None)/SKILL.md`."""
    harness = DeepSeekAgentHarness(manager, api_key="k", mode=MODE_MOCK)
    evaluator = SkillTestHarness(harness)
    evaluator.print_report(evaluator.run_evaluation([
        TestCase(prompt="Please format JSON now", expected_skill=None, description="control"),
    ]))
    out = capsys.readouterr().out
    assert "skills/(None)/SKILL.md" not in out
    assert "Narrow its description" in out


def test_precision_and_recall_are_reported(manager):
    harness = DeepSeekAgentHarness(manager, api_key="", mode=MODE_MOCK)
    results = SkillTestHarness(harness).run_evaluation([
        TestCase(prompt="Please format JSON now", expected_skill="json-envelope", description="hit"),
        TestCase(prompt="What is the capital of Australia?", expected_skill=None, description="control"),
    ])
    assert results["precision_pct"] == 100.0
    assert results["recall_pct"] == 100.0


def test_standard_cases_reference_only_existing_skills():
    """The shipped suite must not expect skills that were renamed away."""
    example_skills = SkillManager(
        __import__("pathlib").Path(__file__).resolve().parents[1] / "skills"
    )
    expected = {c.expected_skill for c in SkillTestHarness.get_standard_test_cases()} - {None}
    assert expected <= set(example_skills.skill_names())
