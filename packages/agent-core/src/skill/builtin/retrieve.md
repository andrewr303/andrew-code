---
name: retrieve
description: >-
  Codebase search and retrieval policy using rg, probe, and ast-grep.
  Routes exact text to rg, semantic/symbol exploration to probe, and syntax/AST
  matching to ast-grep with progressive disclosure.
---

# Codebase Search and Retrieval

## Tool Routing
- **Text and literal matches**: Use `rg` for fast text, exact keywords, regex, error messages, and file filtering (`rg -l`, `-g`).
- **Semantic and symbol exploration**: Use `probe` for token-bounded discovery and symbol extraction:
  - `probe search <PATTERN> [PATH]...` (`--max-tokens N`, `--max-results N`, `-l <lang>`, `-f`, `-o outline|markdown|json`).
  - `probe symbols [FILES]...` (`-o text|json`, `--allow-tests`) for symbol maps and signatures.
  - `probe extract <file:line> | <file#symbol>` (`-c N`, `-o markdown|plain`) for function or class context without reading whole files.
  - `probe query <AST-PATTERN> [PATH]` (`-l <lang>`) runs AST queries internally; prefer raw `ast-grep` for structural queries per policy.
- **Structural and AST matching**: Use `ast-grep` (replaces deprecated `sg`) for syntax-aware pattern matching and outlining:
  - `ast-grep run --lang <ts|tsx|js> -p '<pattern>' [PATH]` (or `ast-grep -p '<pattern>'`) using metavariables (`$NAME`, `$$$BODY`).
  - `ast-grep outline [PATHS]...` (`-l <lang>`, `--items auto|structure|exports|imports|all`, `--view auto|names|signatures|digest|expanded`, `--json`).

## Default Discovery Sequences
- **Unfamiliar questions**: Start with outline discovery (`probe search <PATTERN> [PATH] -o outline` or scoped `rg -l`) -> inspect structure via `probe symbols [FILES]` or `ast-grep outline [PATHS]` -> extract target definitions with `probe extract <file#symbol>` or line-bounded reads.
- **Known questions**: Search exact symbols or identifiers with `rg "<pattern>" [PATH]` (or host Grep) -> jump directly to the target with `probe extract <file#symbol>` or scoped line-range reads. Avoid broad scans.
- **Structural questions**: Search code shapes or API patterns with `ast-grep run --lang <lang> -p '<pattern>' [PATH]` using `$NAME` and `$$$BODY` (or `ast-grep outline [PATHS]`). Prefer raw `ast-grep` over `probe query`.

## Retrieval Discipline
- Scope searches to the smallest plausible directory first; never crawl home, `node_modules`, or build outputs (`dist`).
- Bound all search outputs with path arguments, result counts, token limits, or language filters.
- Apply progressive disclosure: outlines and symbol lists first, targeted extracts second, full-file reads only when necessary.
- Keep retrieval local and lightweight: rely only on vetted CLI tools (`rg`, `probe`, `ast-grep`) or exposed host tools. Do not use background daemons, vector stores, MCP retrieval servers, Zoekt, Sourcegraph, or unvetted wrappers.

## Delegated Code Discovery
- Divide search tasks across workers by subsystem, component, or directory slice; keep ownership non-overlapping.
- Workers return structured findings containing target file paths, specific symbols/functions, why each finding is relevant, and concrete evidence (line references or concise excerpts).
- Never return raw grep dumps, unbounded logs, or full-file transcripts.
