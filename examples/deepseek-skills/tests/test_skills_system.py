"""
Tests for the DeepSeek Agent Skills system using standard unittest.
"""

from __future__ import annotations

import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(MODULE_DIR))

from skills_system import (
    SkillManager,
    SkillSummary,
    SkillDefinition,
    SkillError,
    DeepSeekAgentHarness,
    SkillTestHarness,
    TestCase,
    MODE_MOCK,
    MODE_LIVE,
    build_parser,
    main,
)


class TestSkillsSystem(unittest.TestCase):
    def setUp(self):
        self.skills_dir = MODULE_DIR / "skills"
        self.manager = SkillManager(self.skills_dir)
        self.harness = DeepSeekAgentHarness(self.manager, mode=MODE_MOCK)

    def test_scan_skills(self):
        names = self.manager.skill_names()
        self.assertIn("json-envelope", names)
        self.assertIn("git-commit-helper", names)
        self.assertIn("sql-query-optimizer", names)
        self.assertIn("unit-test-writer", names)
        self.assertEqual(len(self.manager), 4)

    def test_skill_summary_metadata(self):
        summary = self.manager.get_summary("json-envelope")
        self.assertIsNotNone(summary)
        self.assertEqual(summary.name, "json-envelope")
        self.assertIn("JSON", summary.description)
        self.assertEqual(summary.path.name, "SKILL.md")

    def test_load_skill(self):
        content = self.manager.load_skill("json-envelope")
        self.assertIn('<skill name="json-envelope">', content)
        self.assertIn("Enterprise JSON Formatting Skill", content)
        self.assertIn("schema-spec.md", content)
        self.assertIn("format_json.py", content)

    def test_read_reference(self):
        ref_content = self.manager.read_reference("json-envelope", "schema-spec.md")
        self.assertIn("Enterprise JSON Schema Specification", ref_content)

    def test_read_reference_missing(self):
        res = self.manager.read_reference("json-envelope", "nonexistent.md")
        self.assertIn("Error:", res)
        self.assertIn("not found", res)

    def test_load_nonexistent_skill(self):
        res = self.manager.load_skill("fake-skill")
        self.assertIn("Error:", res)
        self.assertIn("not found", res)

    def test_openai_tool_definitions(self):
        tools = self.manager.get_tool_definitions()
        self.assertEqual(len(tools), 2)
        tool_names = [t["function"]["name"] for t in tools]
        self.assertIn("load_skill", tool_names)
        self.assertIn("read_skill_reference", tool_names)

        load_skill_tool = next(t for t in tools if t["function"]["name"] == "load_skill")
        enum_vals = load_skill_tool["function"]["parameters"]["properties"]["name"]["enum"]
        self.assertIn("json-envelope", enum_vals)
        self.assertIn("git-commit-helper", enum_vals)

    def test_forcing_instructions_prompt(self):
        prompt = self.manager.get_forcing_instructions()
        self.assertIn("## Available Skills", prompt)
        self.assertIn("CRITICAL SKILL TRIGGERING RULES", prompt)
        self.assertIn("- **json-envelope**:", prompt)

    def test_agent_harness_mock_turn(self):
        trace = self.harness.run_turn("Format this response as standardized JSON envelope")
        self.assertEqual(trace["mode"], MODE_MOCK)
        self.assertEqual(trace["skill_loaded"], "json-envelope")
        self.assertEqual(len(trace["tool_calls"]), 1)
        self.assertEqual(trace["tool_calls"][0]["tool"], "load_skill")

    def test_agent_harness_negative_control(self):
        trace = self.harness.run_turn("What is the distance from Earth to Mars?")
        self.assertIsNone(trace["skill_loaded"])
        self.assertEqual(trace["tool_calls"], [])

    def test_evaluation_test_harness(self):
        evaluator = SkillTestHarness(self.harness)
        results = evaluator.run_evaluation()
        self.assertEqual(results["total"], 8)
        self.assertEqual(results["correct"], 8)
        self.assertEqual(results["accuracy_pct"], 100.0)
        self.assertEqual(results["precision_pct"], 100.0)
        self.assertEqual(results["recall_pct"], 100.0)

    def test_cli_scan(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            ret = main(["--scan", "--skills-dir", str(self.skills_dir)])
        self.assertEqual(ret, 0)
        output = buf.getvalue()
        self.assertIn("Discovered 4 skill(s)", output)
        self.assertIn("- **json-envelope**:", output)

    def test_cli_load(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            ret = main(["--load", "json-envelope", "--skills-dir", str(self.skills_dir)])
        self.assertEqual(ret, 0)
        output = buf.getvalue()
        self.assertIn('<skill name="json-envelope">', output)

    def test_cli_reference(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            ret = main(["--reference", "json-envelope", "schema-spec.md", "--skills-dir", str(self.skills_dir)])
        self.assertEqual(ret, 0)
        output = buf.getvalue()
        self.assertIn("Enterprise JSON Schema Specification", output)

    def test_cli_test_runner(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            ret = main(["--test", "--skills-dir", str(self.skills_dir)])
        self.assertEqual(ret, 0)
        output = buf.getvalue()
        self.assertIn("Trigger Accuracy: 100.0%", output)


if __name__ == "__main__":
    unittest.main()
