"""
DeepSeek Agent Skills System
============================
A progressive-loading Skills system for DeepSeek-based agent harnesses,
mirroring Anthropic's Agent Skills specification.

Features:
- Progressive context loading in three levels:
    1. Frontmatter-only indexing at startup (~100 words/skill)
    2. `load_skill` pulls the SKILL.md body on demand
    3. `read_skill_reference` pulls one reference document on demand
- On-demand tool invocation via DeepSeek/OpenAI function calling, with the
  skill name constrained by a JSON-schema enum so invalid names cannot be
  produced
- Anti-hallucination / forced trigger instructions
- Built-in evaluation harness measuring trigger accuracy against either the
  live model or an offline heuristic -- the report always states which

NOTE: this is a standalone prototype. The production skill capability for dsh
lives in `packages/skill/*` (TypeScript); this module exists to explore the
progressive-loading contract against the DeepSeek chat-completions API.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

#: Mirrors the kebab-case grammar enforced by `isSkillName` in packages/skill/skill.
SKILL_NAME_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')

#: Execution modes. "auto" picks live when an API key is present, else mock.
MODE_AUTO = "auto"
MODE_LIVE = "live"
MODE_MOCK = "mock"

#: Resolver signature used to stub skill selection in offline mode.
MockResolver = Callable[[str, Dict[str, "SkillSummary"]], Optional[str]]


class SkillError(RuntimeError):
    """Raised when a skill cannot be resolved, read, or parsed."""


class HarnessAPIError(RuntimeError):
    """Raised when the DeepSeek API call fails or returns an unusable payload."""


# =====================================================================
# Data Structures
# =====================================================================

@dataclass
class SkillSummary:
    """Lightweight metadata parsed from SKILL.md frontmatter."""
    name: str
    description: str
    path: Path
    extra_metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def directory(self) -> Path:
        """Directory holding SKILL.md, references/, and scripts/."""
        return self.path.parent


@dataclass
class SkillDefinition:
    """A loaded skill: body instructions plus pointers to its on-demand resources."""
    name: str
    description: str
    body: str
    path: Path
    reference_names: List[str] = field(default_factory=list)
    scripts: List[str] = field(default_factory=list)

    def format_for_model(self) -> str:
        """Format the loaded skill instructions for tool-result injection.

        Reference documents are advertised by name only. Their contents stay out
        of context until the model asks for one via `read_skill_reference`,
        which is the level-3 half of progressive disclosure.
        """
        sections = [
            f'<skill name="{self.name}">',
            f'# Skill: {self.name}',
            f'**Description**: {self.description}\n',
            '## Instructions',
            self.body.strip(),
        ]

        if self.reference_names:
            sections.append('\n## Reference Documents (not yet loaded)')
            sections.append(
                'These documents are available but are NOT included above. Call '
                f'`read_skill_reference` with skill_name="{self.name}" and the file '
                'name below to read one, and only if you actually need it.'
            )
            sections.extend(f'- {ref_name}' for ref_name in self.reference_names)

        if self.scripts:
            sections.append('\n## Helper Scripts (reference implementations)')
            sections.append(
                "These files exist on disk under this skill's `scripts/` directory. "
                'This harness cannot execute them; treat them as reference '
                'implementations to read or reproduce, not as callable tools.'
            )
            sections.extend(f'- scripts/{script}' for script in self.scripts)

        sections.append('</skill>')
        return '\n\n'.join(sections)


# =====================================================================
# Skill Manager (Scanner, Parser, Loader)
# =====================================================================

class SkillManager:
    """Manages discovery, frontmatter indexing, and progressive loading of skills."""

    #: Block scalar indicators that introduce a multi-line YAML value.
    _BLOCK_INDICATORS = ('|', '>', '|-', '>-', '|+', '>+')

    def __init__(self, skills_dir: str | Path = "skills"):
        self.skills_dir = Path(skills_dir).resolve()
        self._skills_index: Dict[str, SkillSummary] = {}
        #: Non-fatal problems found during the last scan, surfaced by `--scan`.
        self.warnings: List[str] = []
        self.scan_skills()

    # -- public accessors -------------------------------------------------

    def skill_names(self) -> List[str]:
        """Sorted names of every indexed skill."""
        return sorted(self._skills_index)

    def summaries(self) -> Dict[str, SkillSummary]:
        """Shallow copy of the skill index, keyed by name."""
        return dict(self._skills_index)

    def get_summary(self, name: str) -> Optional[SkillSummary]:
        """Return the summary for `name`, or None when it is not indexed."""
        return self._skills_index.get(name)

    def __len__(self) -> int:
        return len(self._skills_index)

    # -- frontmatter parsing ----------------------------------------------

    def _warn(self, message: str) -> None:
        self.warnings.append(message)
        logger.warning("%s", message)

    def _parse_frontmatter(self, file_path: Path) -> Tuple[Dict[str, Any], str]:
        """Parse YAML frontmatter and body from a Markdown file.

        Uses PyYAML when importable and falls back to a line-based parser that
        reports, rather than silently drops, anything it cannot represent.
        """
        try:
            content = file_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise SkillError(f"cannot read {file_path}: {exc}") from exc

        match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)$', content, re.DOTALL)
        if match:
            raw_fm, body = match.group(1), match.group(2)
        else:
            match_only = re.match(r'^---\s*\n(.*?)\n---\s*$', content, re.DOTALL)
            if not match_only:
                self._warn(f"{file_path}: no YAML frontmatter found; treating whole file as body")
                return {}, content
            raw_fm, body = match_only.group(1), ""

        parsed: Any = None
        try:
            import yaml
        except ImportError:
            yaml = None  # type: ignore[assignment]

        if yaml is not None:
            try:
                parsed = yaml.safe_load(raw_fm)
            except yaml.YAMLError as exc:
                self._warn(f"{file_path}: invalid YAML frontmatter ({exc}); using fallback parser")
                parsed = None

        if isinstance(parsed, dict):
            return parsed, body

        if parsed is not None:
            self._warn(
                f"{file_path}: frontmatter is a {type(parsed).__name__}, not a mapping; "
                "using fallback parser"
            )
        return self._parse_frontmatter_fallback(raw_fm, file_path), body

    def _parse_frontmatter_fallback(self, raw_fm: str, file_path: Path) -> Dict[str, Any]:
        """Zero-dependency frontmatter parser for `key: value`, lists, and block scalars."""
        metadata: Dict[str, Any] = {}
        lines = raw_fm.splitlines()
        current_key: Optional[str] = None
        index = 0

        while index < len(lines):
            line = lines[index].strip()
            index += 1

            if not line or line.startswith('#'):
                continue

            if line.startswith('- '):
                if current_key is None:
                    self._warn(f"{file_path}: dropped orphan list item in frontmatter: {line!r}")
                    continue
                existing = metadata.get(current_key)
                if not isinstance(existing, list):
                    metadata[current_key] = [] if existing in (None, '') else [existing]
                metadata[current_key].append(self._unquote(line[2:].strip()))
                continue

            if ':' not in line:
                self._warn(f"{file_path}: dropped unparsable frontmatter line: {line!r}")
                continue

            key, value = line.split(':', 1)
            key, value = key.strip(), value.strip()
            current_key = key

            if value in self._BLOCK_INDICATORS:
                block: List[str] = []
                while index < len(lines) and (not lines[index].strip() or lines[index][:1] in (' ', '\t')):
                    block.append(lines[index].strip())
                    index += 1
                joiner = '\n' if value.startswith('|') else ' '
                metadata[key] = joiner.join(block).strip()
                continue

            metadata[key] = self._unquote(value)

        return metadata

    @staticmethod
    def _unquote(value: str) -> str:
        """Strip a single matched pair of surrounding quotes."""
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            return value[1:-1]
        return value

    # -- discovery ---------------------------------------------------------

    def scan_skills(self) -> Dict[str, SkillSummary]:
        """Scan `skills/*/SKILL.md`, parsing ONLY frontmatter (name + description).

        The markdown body is deliberately left on disk until `load_skill` runs.
        """
        self._skills_index.clear()
        self.warnings.clear()

        if not self.skills_dir.exists():
            self._warn(f"skills directory does not exist: {self.skills_dir}")
            return self._skills_index

        for skill_dir in sorted(self.skills_dir.iterdir()):
            if not skill_dir.is_dir():
                continue

            skill_file = skill_dir / "SKILL.md"
            if not skill_file.exists():
                continue

            try:
                metadata, _ = self._parse_frontmatter(skill_file)
            except SkillError as exc:
                self._warn(f"skipping {skill_dir.name}: {exc}")
                continue

            name = str(metadata.get("name") or skill_dir.name).strip()
            description = str(metadata.get("description") or "").strip()

            if not SKILL_NAME_RE.match(name):
                self._warn(
                    f"{skill_file}: skill name {name!r} is not kebab-case; "
                    "skills should match ^[a-z0-9]+(-[a-z0-9]+)*$"
                )

            if name != skill_dir.name:
                self._warn(
                    f"{skill_file}: frontmatter name {name!r} does not match directory "
                    f"name {skill_dir.name!r}; keep them identical so paths stay predictable"
                )

            if not description:
                self._warn(
                    f"{skill_file}: missing `description`; routing quality will suffer "
                    "because the model selects skills by description"
                )
                description = f"Workflow instructions for {name}"

            existing = self._skills_index.get(name)
            if existing is not None:
                self._warn(
                    f"duplicate skill name {name!r}: {skill_file} overrides {existing.path}"
                )

            self._skills_index[name] = SkillSummary(
                name=name,
                description=description,
                path=skill_file,
                extra_metadata=metadata,
            )

        return self._skills_index

    # -- prompt construction ------------------------------------------------

    def get_available_skills_index(self) -> str:
        """Build the compact `- <name>: <description>` list for the system prompt."""
        if not self._skills_index:
            return "No skills currently available."
        return "\n".join(
            f"- **{name}**: {self._skills_index[name].description}"
            for name in self.skill_names()
        )

    def get_forcing_instructions(self) -> str:
        """Return the forcing prompt that makes the model call `load_skill` reliably."""
        return (
            "## Available Skills\n"
            "The following domain-specific skills are available to teach you specialized workflows:\n"
            f"{self.get_available_skills_index()}\n\n"
            "## CRITICAL SKILL TRIGGERING RULES\n"
            "1. Before starting ANY non-trivial task, check the Available Skills list above.\n"
            "2. If ANY skill's description plausibly applies - even partially - you MUST call `load_skill` "
            "for it before taking any other action or generating your response.\n"
            "3. Do NOT skip calling `load_skill` because the task seems simple or because you think you "
            "already know how to do it. The skill contains required domain-specific constraints.\n"
            "4. A loaded skill may list reference documents. Call `read_skill_reference` for one only when "
            "the task actually needs it; do not load them all speculatively.\n"
            "5. Only proceed without calling `load_skill` if NO skill in the list applies to the request."
        )

    def inject_system_prompt(self, base_system_prompt: str = "") -> str:
        """Inject the compact skills index and forcing instructions into the system prompt."""
        base = base_system_prompt.strip()
        forcing = self.get_forcing_instructions()
        return f"{base}\n\n{forcing}" if base else forcing

    # -- progressive loading -------------------------------------------------

    def load_skill(self, name: str) -> str:
        """Load the SKILL.md body for `name` and advertise its on-demand resources."""
        summary = self._skills_index.get(name)
        if summary is None:
            available = ", ".join(self.skill_names()) or "none"
            return f"Error: Skill '{name}' not found. Available skills: [{available}]."

        try:
            _, body = self._parse_frontmatter(summary.path)
        except SkillError as exc:
            return f"Error: could not read skill '{name}': {exc}"

        definition = SkillDefinition(
            name=name,
            description=summary.description,
            body=body,
            path=summary.path,
            reference_names=self.list_reference_names(name),
            scripts=self._list_dir_files(summary.directory / "scripts"),
        )
        return definition.format_for_model()

    def list_reference_names(self, name: str) -> List[str]:
        """File names available under a skill's `references/` directory."""
        summary = self._skills_index.get(name)
        if summary is None:
            return []
        return self._list_dir_files(summary.directory / "references")

    def read_reference(self, name: str, file_name: str) -> str:
        """Read one reference document for a skill (level-3 progressive load)."""
        summary = self._skills_index.get(name)
        if summary is None:
            available = ", ".join(self.skill_names()) or "none"
            return f"Error: Skill '{name}' not found. Available skills: [{available}]."

        refs_dir = (summary.directory / "references").resolve()
        candidate = (refs_dir / file_name).resolve()

        # Reject traversal: `file_name` comes from the model, so never trust it.
        if refs_dir not in candidate.parents:
            return f"Error: '{file_name}' is outside the references directory for skill '{name}'."

        if not candidate.is_file():
            available = ", ".join(self.list_reference_names(name)) or "none"
            return (
                f"Error: reference '{file_name}' not found for skill '{name}'. "
                f"Available references: [{available}]."
            )

        try:
            content = candidate.read_text(encoding="utf-8")
        except OSError as exc:
            return f"Error: could not read reference '{file_name}' for skill '{name}': {exc}"

        return (
            f'<skill_reference skill="{name}" file="{file_name}">\n'
            f'{content.strip()}\n'
            f'</skill_reference>'
        )

    @staticmethod
    def _list_dir_files(directory: Path) -> List[str]:
        """Sorted names of the regular files directly inside `directory`."""
        if not directory.is_dir():
            return []
        return sorted(entry.name for entry in directory.iterdir() if entry.is_file())

    # -- tool schemas ---------------------------------------------------------

    def get_tool_definitions(self) -> List[Dict[str, Any]]:
        """OpenAI-compatible function definitions for the two skill tools.

        The skill name is constrained to an enum of indexed skills so the model
        cannot invent a skill that does not exist.
        """
        name_schema: Dict[str, Any] = {
            "type": "string",
            "description": "The exact name of the skill to load (from Available Skills).",
        }
        if self._skills_index:
            name_schema["enum"] = self.skill_names()

        return [
            {
                "type": "function",
                "function": {
                    "name": "load_skill",
                    "description": (
                        "Load the full workflow instructions for a domain-specific skill. "
                        "Must be called BEFORE starting any task where a skill's description applies."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {"name": name_schema},
                        "required": ["name"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "read_skill_reference",
                    "description": (
                        "Read one reference document belonging to a skill you already loaded. "
                        "Call this only when the task needs the detail it contains."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "skill_name": dict(name_schema, description="The skill that owns the reference."),
                            "file_name": {
                                "type": "string",
                                "description": "Reference file name exactly as listed by `load_skill`.",
                            },
                        },
                        "required": ["skill_name", "file_name"],
                    },
                },
            },
        ]


# =====================================================================
# DeepSeek API Harness & Agent Loop
# =====================================================================

class DeepSeekAgentHarness:
    """Executes tasks against the DeepSeek chat completions API with progressive skill loading."""

    #: HTTP statuses worth retrying: rate limiting and transient server faults.
    _RETRYABLE_STATUSES = frozenset({408, 429, 500, 502, 503, 504})

    def __init__(
        self,
        skill_manager: SkillManager,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: str = "deepseek-chat",
        mode: str = MODE_AUTO,
        temperature: float = 0.1,
        timeout_s: float = 60.0,
        max_retries: int = 3,
        retry_backoff_s: float = 1.0,
        max_iterations: int = 6,
    ):
        self.skill_manager = skill_manager
        self.api_key = api_key if api_key is not None else os.environ.get("DEEPSEEK_API_KEY", "")
        self.base_url = (base_url or os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")).rstrip('/')
        self.model = model
        self.mode = mode
        self.temperature = temperature
        self.timeout_s = timeout_s
        self.max_retries = max_retries
        self.retry_backoff_s = retry_backoff_s
        self.max_iterations = max_iterations
        #: Indirection so tests can run the retry path without real delays.
        self._sleep = time.sleep

    # -- mode ---------------------------------------------------------------

    def resolve_mode(self) -> str:
        """Resolve the configured mode to a concrete `live` or `mock`.

        `auto` degrades to `mock` without an API key. Callers must report the
        resolved mode: a mock run measures the local heuristic, not the model.
        """
        if self.mode == MODE_LIVE:
            return MODE_LIVE
        if self.mode == MODE_MOCK:
            return MODE_MOCK
        if self.mode != MODE_AUTO:
            raise ValueError(f"unknown mode {self.mode!r}; expected one of auto/live/mock")
        return MODE_LIVE if self.api_key else MODE_MOCK

    # -- transport ------------------------------------------------------------

    def _call_api(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Call the DeepSeek chat completions endpoint, retrying transient failures."""
        if not self.api_key:
            raise HarnessAPIError(
                "DEEPSEEK_API_KEY is not set; export it or run with --mock for the offline heuristic."
            )

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )

        body: Optional[str] = None
        for attempt in range(self.max_retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
                    body = response.read().decode("utf-8")
                break
            except urllib.error.HTTPError as exc:
                detail = self._read_error_body(exc)
                if exc.code in self._RETRYABLE_STATUSES and attempt < self.max_retries:
                    self._backoff(attempt, f"HTTP {exc.code}")
                    continue
                raise HarnessAPIError(f"DeepSeek API returned HTTP {exc.code}: {detail}") from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                if attempt < self.max_retries:
                    self._backoff(attempt, str(exc))
                    continue
                raise HarnessAPIError(f"DeepSeek API request failed: {exc}") from exc

        if body is None:  # pragma: no cover - every loop path breaks or raises
            raise HarnessAPIError("DeepSeek API request produced no response body.")

        try:
            parsed = json.loads(body)
        except json.JSONDecodeError as exc:
            raise HarnessAPIError(f"DeepSeek API returned non-JSON body: {body[:300]!r}") from exc

        choices = parsed.get("choices") if isinstance(parsed, dict) else None
        if not isinstance(choices, list) or not choices:
            raise HarnessAPIError(f"DeepSeek API response has no choices: {str(parsed)[:300]}")
        if not isinstance(choices[0], dict) or not isinstance(choices[0].get("message"), dict):
            raise HarnessAPIError(f"DeepSeek API choice has no message: {str(choices[0])[:300]}")

        return parsed

    @staticmethod
    def _read_error_body(exc: urllib.error.HTTPError) -> str:
        """Best-effort read of an error response body for diagnostics."""
        try:
            return exc.read().decode("utf-8", errors="replace")[:500]
        except Exception:  # pragma: no cover - diagnostics must never mask the HTTPError
            return "<unreadable error body>"

    def _backoff(self, attempt: int, reason: str) -> None:
        """Sleep with exponential backoff before the next retry."""
        delay = self.retry_backoff_s * (2 ** attempt)
        logger.warning("retrying DeepSeek request in %.1fs after %s", delay, reason)
        self._sleep(delay)

    # -- tool dispatch ---------------------------------------------------------

    def _dispatch_tool(self, func_name: str, args: Dict[str, Any]) -> Tuple[str, Optional[str]]:
        """Run one tool call. Returns `(tool_result, loaded_skill_name_or_None)`."""
        if func_name == "load_skill":
            name = args.get("name")
            if not isinstance(name, str) or not name:
                return "Error: `load_skill` requires a string `name` argument.", None
            return self.skill_manager.load_skill(name), name

        if func_name == "read_skill_reference":
            skill_name = args.get("skill_name")
            file_name = args.get("file_name")
            if not isinstance(skill_name, str) or not isinstance(file_name, str):
                return (
                    "Error: `read_skill_reference` requires string `skill_name` and `file_name`.",
                    None,
                )
            return self.skill_manager.read_reference(skill_name, file_name), None

        return (
            f"Error: unknown tool '{func_name}'. Available tools: load_skill, read_skill_reference.",
            None,
        )

    @staticmethod
    def _parse_tool_arguments(raw_arguments: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Parse a tool call's JSON arguments. Returns `(args, error_message)`."""
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

    # -- agent loop --------------------------------------------------------------

    def run_turn(
        self,
        user_prompt: str,
        base_system_prompt: str = "You are an expert AI assistant with specialized domain skills.",
        mock_skill_resolver: Optional[MockResolver] = None,
    ) -> Dict[str, Any]:
        """Execute one user turn through the agent loop.

        Live mode loops until the model stops requesting tools (bounded by
        `max_iterations`), so a skill can be loaded and its references read in
        the same turn. Mock mode substitutes a deterministic local resolver and
        marks the trace accordingly.
        """
        mode = MODE_MOCK if mock_skill_resolver is not None else self.resolve_mode()

        trace: Dict[str, Any] = {
            "user_prompt": user_prompt,
            "mode": mode,
            "skill_loaded": None,
            "skills_loaded": [],
            "tool_calls": [],
            "final_response": "",
            "iterations": 0,
            "stop_reason": "completed",
            "warnings": [],
        }

        if mode == MODE_MOCK:
            return self._run_turn_mock(user_prompt, trace, mock_skill_resolver)

        system_prompt = self.skill_manager.inject_system_prompt(base_system_prompt)
        tools = self.skill_manager.get_tool_definitions()
        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        for iteration in range(self.max_iterations):
            trace["iterations"] = iteration + 1
            response = self._call_api(messages, tools=tools)
            message = response["choices"][0]["message"]
            tool_calls = message.get("tool_calls") or []

            if not tool_calls:
                trace["final_response"] = message.get("content") or ""
                break

            # Append the assistant message exactly once, then answer every tool
            # call it made. Appending inside the loop would duplicate the turn
            # and mis-pair the tool results whenever the model batches calls.
            messages.append(message)

            for position, tool_call in enumerate(tool_calls):
                func = tool_call.get("function") or {}
                func_name = func.get("name") or "<missing>"
                args, arg_error = self._parse_tool_arguments(func.get("arguments"))

                call_id = tool_call.get("id")
                if not call_id:
                    call_id = f"call_{iteration}_{position}"
                    trace["warnings"].append(
                        f"tool call {func_name!r} had no id; synthesized {call_id!r}"
                    )

                if arg_error is not None:
                    result, loaded = arg_error, None
                else:
                    result, loaded = self._dispatch_tool(func_name, args or {})

                trace["tool_calls"].append({"tool": func_name, "args": args, "id": call_id})
                if loaded:
                    trace["skills_loaded"].append(loaded)
                    if trace["skill_loaded"] is None:
                        trace["skill_loaded"] = loaded

                # Every tool_call id must get a reply or the next request is rejected.
                messages.append({"role": "tool", "tool_call_id": call_id, "content": result})
        else:
            trace["stop_reason"] = "max_iterations"
            trace["warnings"].append(
                f"stopped after {self.max_iterations} iterations without a final answer"
            )

        return trace

    def _run_turn_mock(
        self,
        user_prompt: str,
        trace: Dict[str, Any],
        mock_skill_resolver: Optional[MockResolver],
    ) -> Dict[str, Any]:
        """Offline turn: resolve a skill locally, without contacting the API."""
        resolver = mock_skill_resolver or (
            lambda prompt, _index: self._heuristic_mock_trigger(prompt)
        )
        selected = resolver(user_prompt, self.skill_manager.summaries())
        trace["iterations"] = 1

        if not selected:
            trace["final_response"] = "[mock] direct execution without skills"
            return trace

        trace["skill_loaded"] = selected
        trace["skills_loaded"].append(selected)
        trace["tool_calls"].append({"tool": "load_skill", "args": {"name": selected}, "id": "mock_0"})
        skill_content = self.skill_manager.load_skill(selected)
        trace["final_response"] = (
            f"[mock] simulated execution using skill '{selected}'; "
            f"loaded {len(skill_content)} chars of instructions"
        )
        return trace

    def _heuristic_mock_trigger(self, prompt: str) -> Optional[str]:
        """Deterministic keyword trigger used only in offline mode.

        This scores prompts against each skill's own description, so it measures
        keyword overlap, not model behaviour. Never present its results as the
        model's trigger accuracy.
        """
        prompt_lower = prompt.lower()
        best_skill: Optional[str] = None
        best_score = 0

        for name in self.skill_manager.skill_names():
            summary = self.skill_manager.get_summary(name)
            if summary is None:  # pragma: no cover - names come from the index
                continue

            score = sum(3 for part in name.split('-') if part in prompt_lower)
            desc_words = set(re.findall(r'\b[a-zA-Z]{4,}\b', summary.description.lower()))
            score += sum(1 for word in desc_words if word in prompt_lower)

            if score > best_score and score >= 2:
                best_score = score
                best_skill = name

        return best_skill


# =====================================================================
# Test Harness & Trigger Accuracy Evaluator
# =====================================================================

@dataclass
class TestCase:
    #: Not a pytest class despite the name; keep collection from warning.
    __test__ = False

    prompt: str
    expected_skill: Optional[str]
    description: str


class SkillTestHarness:
    """Evaluates trigger accuracy of the skills system across test prompts."""

    def __init__(self, harness: DeepSeekAgentHarness):
        self.harness = harness

    @staticmethod
    def get_standard_test_cases() -> List[TestCase]:
        """Curated suite of 8 prompts covering each skill plus a negative control."""
        return [
            TestCase(
                prompt="Format this user registration payload as standardized JSON with metadata and ISO timestamp.",
                expected_skill="json-envelope",
                description="JSON enterprise formatting task",
            ),
            TestCase(
                prompt="Write a conventional git commit message for adding user authentication with JWT tokens.",
                expected_skill="git-commit-helper",
                description="Conventional git commit generation",
            ),
            TestCase(
                prompt="Our PostgreSQL query with 4 joins is running slow and doing a full table sequential scan. How can we optimize it?",
                expected_skill="sql-query-optimizer",
                description="SQL performance & query optimization",
            ),
            TestCase(
                prompt="Write a complete unit test suite for our PaymentProcessor class testing error handling and mocking the Stripe API.",
                expected_skill="unit-test-writer",
                description="Unit test generation and mocking",
            ),
            TestCase(
                prompt="Produce a JSON error response when an invalid email is provided to our API.",
                expected_skill="json-envelope",
                description="JSON error response generation",
            ),
            TestCase(
                prompt="Create a commit message following project standards for fixing a race condition in the cache layer.",
                expected_skill="git-commit-helper",
                description="Git fix commit generation",
            ),
            TestCase(
                prompt="Can you recommend B-tree vs GIN indexes for JSONB fields in our database tables?",
                expected_skill="sql-query-optimizer",
                description="Database indexing strategy",
            ),
            TestCase(
                prompt="What is the capital of Australia and what is its approximate population?",
                expected_skill=None,
                description="General knowledge query (negative control: should NOT trigger any skill)",
            ),
        ]

    def run_evaluation(self, test_cases: Optional[List[TestCase]] = None) -> Dict[str, Any]:
        """Run the suite and compute accuracy, precision, and recall.

        A case that raises is recorded as an error rather than aborting the run.
        """
        cases = test_cases or self.get_standard_test_cases()
        mode = self.harness.resolve_mode()
        results: List[Dict[str, Any]] = []
        correct = errors = 0
        true_pos = false_pos = false_neg = 0

        for case in cases:
            error: Optional[str] = None
            actual: Optional[str] = None
            tool_calls: List[Dict[str, Any]] = []

            try:
                trace = self.harness.run_turn(case.prompt)
                actual = trace.get("skill_loaded")
                tool_calls = trace.get("tool_calls", [])
            except (HarnessAPIError, SkillError) as exc:
                error = str(exc)
                errors += 1

            matched = error is None and actual == case.expected_skill
            if matched:
                correct += 1

            if error is None:
                if case.expected_skill is not None and actual == case.expected_skill:
                    true_pos += 1
                else:
                    if actual is not None:
                        false_pos += 1
                    if case.expected_skill is not None:
                        false_neg += 1

            results.append({
                "prompt": case.prompt,
                "description": case.description,
                "expected": case.expected_skill,
                "actual": actual,
                "matched": matched,
                "error": error,
                "tool_calls": tool_calls,
            })

        total = len(cases)
        return {
            "mode": mode,
            "total": total,
            "correct": correct,
            "errors": errors,
            "accuracy_pct": (correct / total) * 100.0 if total else 0.0,
            "precision_pct": (true_pos / (true_pos + false_pos)) * 100.0 if (true_pos + false_pos) else None,
            "recall_pct": (true_pos / (true_pos + false_neg)) * 100.0 if (true_pos + false_neg) else None,
            "results": results,
        }

    def print_report(self, eval_results: Dict[str, Any]) -> None:
        """Print the accuracy report, always stating which engine produced it."""
        mode = eval_results["mode"]
        engine = "LIVE DeepSeek API" if mode == MODE_LIVE else "OFFLINE keyword heuristic"

        print("\n" + "=" * 80)
        print("  SKILLS TRIGGER ACCURACY EVALUATION REPORT")
        print("=" * 80)
        print(f"Execution mode:   {mode} ({engine})")

        if mode == MODE_MOCK:
            print(
                "\n!! These numbers describe the local keyword matcher, NOT DeepSeek.\n"
                "!! The heuristic scores prompts against the same skill descriptions the\n"
                "!! prompts were written from, so a high score here is close to circular.\n"
                "!! Set DEEPSEEK_API_KEY and rerun with --api to measure the model."
            )

        print(f"\nTotal Test Cases: {eval_results['total']}")
        print(f"Correct Triggers: {eval_results['correct']}/{eval_results['total']}")
        print(f"Trigger Accuracy: {eval_results['accuracy_pct']:.1f}%")
        print(f"Precision:        {self._format_pct(eval_results['precision_pct'])}")
        print(f"Recall:           {self._format_pct(eval_results['recall_pct'])}")
        if eval_results["errors"]:
            print(f"Errored Cases:    {eval_results['errors']}")
        print()

        print(f"{'#':<3} | {'Expected Skill':<22} | {'Actual Skill':<22} | {'Status':<6} | {'Test Scenario'}")
        print("-" * 80)
        for i, res in enumerate(eval_results["results"], 1):
            status = "ERROR" if res["error"] else ("PASS" if res["matched"] else "FAIL")
            expected = res["expected"] or "(None)"
            actual = res["actual"] or "(None)"
            print(f"{i:<3} | {expected:<22} | {actual:<22} | {status:<6} | {res['description']}")
        print("-" * 80)

        failures = [r for r in eval_results["results"] if not r["matched"]]
        if not failures:
            print("\nEvery case matched its expected skill.\n")
            return

        print("\nDIAGNOSTICS & RECOMMENDATIONS:")
        for res in failures:
            print(f"  - Scenario: '{res['description']}'")
            if res["error"]:
                print(f"    Errored: {res['error']}\n")
                continue

            print(f"    Expected: {res['expected'] or '(None)'}, but got: {res['actual'] or '(None)'}")
            snippet = res["prompt"][:60]
            if res["expected"] is None:
                print(
                    f"    Tip: skill '{res['actual']}' fired on a prompt it should ignore. Narrow its "
                    f"description so it stops matching: \"{snippet}...\"\n"
                )
            else:
                print(
                    f"    Tip: tighten the description in skills/{res['expected']}/SKILL.md to include "
                    f"trigger keywords from the prompt: \"{snippet}...\"\n"
                )

    @staticmethod
    def _format_pct(value: Optional[float]) -> str:
        """Render an optional percentage, or n/a when it is undefined."""
        return "n/a" if value is None else f"{value:.1f}%"


# =====================================================================
# CLI Entrypoint
# =====================================================================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DeepSeek Agent Skills System")
    parser.add_argument("--skills-dir", default="skills", help="Path to skills directory (default: skills)")
    parser.add_argument("--scan", action="store_true", help="Scan and list discovered skills")
    parser.add_argument("--load", metavar="SKILL", help="Load and print full content of a specific skill")
    parser.add_argument(
        "--reference",
        nargs=2,
        metavar=("SKILL", "FILE"),
        help="Print one reference document belonging to a skill",
    )
    parser.add_argument("--test", action="store_true", help="Run the trigger accuracy test harness (default)")
    parser.add_argument("--prompt", help="Run a single user prompt through the harness")
    parser.add_argument("--model", default="deepseek-chat", help="Model id (default: deepseek-chat)")

    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--api",
        dest="mode",
        action="store_const",
        const=MODE_LIVE,
        help="Force live API calls; fails loudly if DEEPSEEK_API_KEY is unset",
    )
    mode_group.add_argument(
        "--mock",
        dest="mode",
        action="store_const",
        const=MODE_MOCK,
        help="Force the offline keyword heuristic, even when an API key is present",
    )
    parser.set_defaults(mode=MODE_AUTO)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
    args = build_parser().parse_args(argv)

    manager = SkillManager(args.skills_dir)
    harness = DeepSeekAgentHarness(manager, model=args.model, mode=args.mode)

    if args.mode == MODE_LIVE and not harness.api_key:
        print("Error: --api requires DEEPSEEK_API_KEY to be set.")
        return 2

    if args.scan:
        print(f"Scanning skills in: {manager.skills_dir}")
        print(f"Discovered {len(manager)} skill(s):\n")
        print(manager.get_available_skills_index())
        if manager.warnings:
            print(f"\n--- {len(manager.warnings)} Warning(s) ---")
            for warning in manager.warnings:
                print(f"  ! {warning}")
        print("\n--- System Prompt Injection Preview ---")
        print(manager.get_forcing_instructions())
        return 0

    if args.load:
        print(manager.load_skill(args.load))
        return 0

    if args.reference:
        print(manager.read_reference(args.reference[0], args.reference[1]))
        return 0

    if args.prompt:
        print(f"Prompt: {args.prompt}")
        try:
            trace = harness.run_turn(args.prompt)
        except (HarnessAPIError, SkillError) as exc:
            print(f"Error: {exc}")
            return 1
        print(f"Mode: {trace['mode']}")
        print(f"Skill Triggered: {trace['skill_loaded'] or 'None'}")
        print(f"Response: {trace['final_response']}")
        return 0

    evaluator = SkillTestHarness(harness)
    try:
        results = evaluator.run_evaluation()
    except (HarnessAPIError, SkillError) as exc:
        print(f"Error: {exc}")
        return 1
    evaluator.print_report(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
