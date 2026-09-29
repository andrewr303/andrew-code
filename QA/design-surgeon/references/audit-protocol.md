# Audit Protocol

Audit mode is read-only.

## Phase 1: Project discovery

Read package and framework files first:

- `package.json`
- framework config such as Next, Vite, Astro, SvelteKit, Tailwind, PostCSS, TypeScript
- global CSS and design tokens
- target route/component and direct children
- shared components used by the target surface
- design docs such as `PRODUCT.md`, `DESIGN.md`, `CLAUDE.md`, `AGENTS.md`, `README.md`

Do not infer project paths. If you name a path, read it.

## Phase 2: Static anti-slop scan

Use code reading plus the CLI:

```bash
node scripts/hds.mjs audit --target <path> --out .design-review/deslop/audits/<timestamp>
```

Look for:

- gradient reflex
- decorative glass and glow
- card soup
- generic icons
- fake proof
- copy void
- accessibility focus failures
- token chaos
- responsive risk
- motion spam

## Phase 3: Live browser audit

Use Playwright, Codex browser, Claude Code browser tools, or the local CLI when possible.

Capture these widths when feasible:

- 1440x900
- 1280x832
- 1024x768
- 768x1024
- 430x932
- 390x844
- 375x812

Check console errors, failed requests, horizontal overflow, clipped controls, low contrast candidates, unlabeled icon buttons, keyboard focus, modal/drawer behavior, tables, charts, and empty/loading/error states.

## Phase 4: Numbered report

Return three tables:

1. Top Priority Fixes, IDs 1-99.
2. Medium Priority Improvements, IDs 101-199.
3. Radical Overhaul Options, IDs 201-299.

Each row needs: ID, region/file/component, problem, evidence, severity, principle, recommended change, impact, files likely touched, effort, risk, confidence, notes.

Finish with: "No edits made. Pick row IDs to implement."
