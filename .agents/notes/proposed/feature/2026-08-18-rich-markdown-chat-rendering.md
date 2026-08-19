# Agent Note: Rich Markdown Chat Rendering in Web UI

Status: proposed

English | [中文](2026-08-18-rich-markdown-chat-rendering.zh.md)

## Problem

Assistant answers in the Web UI rendered plain Markdown blocks without modern visual polish or interactive semantic features. Users had no support for:
- GitHub Flavored Markdown (GFM) alert callouts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`).
- Collapsible `<details>` and `<summary>` disclosure sections for long logs or deep dives.
- Interactive footnote in-page navigation anchors (`#user-content-fn-*`) and backlinks (`↩`).
- Mermaid diagram rendering directly from ````mermaid` fences.
- Sandboxed HTML snippet execution and previewing.
- Model prompt guidance directing agents to format answers with rich visual structures.

## Proposal

Implement comprehensive rich Markdown capabilities across `packages/client/ui-primitives` and `packages/client/ui-deliverables`:

1. **Visual Polish (CSS Design Tokens)**:
   - Polished headings vertical rhythm, line heights, and subtle dividers.
   - Structured table styling with alternating zebra striping and sticky raised headers.
   - Accent-bordered blockquotes with surface tints.
   - Tokenized inline code badges and code block header chrome with language badges.
   - Animated pulsing streaming caret for active token generation.

2. **Rich Semantic Constructs (`packages/client/ui-primitives/src/markdown/render.tsx`)**:
   - Parse GFM alerts into dedicated styled containers with SVG icons and themed borders.
   - Support native `<details>` and `<summary>` disclosure containers.
   - Transform footnote references and definitions into interactive jump links and backref anchors.

3. **Mermaid Diagram Fencing (`MermaidBlock.tsx`)**:
   - Dynamic import of `mermaid` with dark/light theme awareness (`data-ds-dark-theme`).
   - Interactive toggle between visual diagram and underlying source code.
   - Fallback to syntax-highlighted `CodeBlock` upon parse error.
   - Plain code preservation during streaming to avoid rendering incomplete ASTs.

4. **Sandboxed HTML Previews (`HtmlPreviewBlock.tsx`)**:
   - Render HTML snippets inside `<iframe sandbox="allow-scripts" srcdoc=... referrerPolicy="no-referrer" />` with strict CSP injection.
   - Default to source code view with an explicit user toggle to run the live sandbox.

5. **Prompt Guidance (`packages/client/ui-deliverables/src/index.ts`)**:
   - Register `ui:rich-formatting-guidance` section in `systemPrompt` directing models to structure answers using tables, GFM alerts, Mermaid diagrams, and collapsible details.

## Alternatives considered

- **Render HTML snippets inline without iframe**: Rejected due to severe cross-site scripting (XSS) risks and style leakage into the main application.
- **Eagerly bundle Mermaid into the main shell**: Rejected to avoid penalizing initial page load time with a heavy diagram library.

## Risks

- **Iframe Sandboxing Escape**: Mitigated by disallowing `allow-same-origin`, enforcing `allow-scripts`, setting `referrerpolicy="no-referrer"`, and injecting strict CSP meta tags.
- **Streaming Parser Instability**: Mitigated by keeping incomplete token streams as plain text code blocks until message settlement.

## Acceptance criteria

- Unit test coverage in `packages/client/ui-primitives` verifies alert parsing, details disclosure, footnote anchors, HTML sandbox isolation, and Mermaid toggling.
- Prompt guidance test in `packages/client/ui-deliverables` verifies system prompt registration and disposal.
- DOM parity and incremental rendering snapshot suites remain green.
- Client bundles and web application build cleanly with code-split chunks.
