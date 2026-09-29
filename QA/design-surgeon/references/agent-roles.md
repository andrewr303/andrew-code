# Agent Roles

Use these roles as subagents when the environment supports them. If subagents are unavailable, simulate them as sections inside the main audit.

## 1. Design Forensics Auditor

Read code and screenshots. Identify layout, typography, token, accessibility, copy, data-credibility, responsive, and motion issues. Produce evidence-backed rows.

## 2. Playwright UI Inspector

Run browser capture. Save desktop/mobile screenshots. Report console errors, failed requests, overflow, unlabeled controls, transition spam, and visual state risks.

## 3. Design System Curator

Inspect tokens, shared components, variants, Tailwind config, CSS variables, chart tokens, icon systems, status colors, and focus styles. Recommend token-level changes only when local fixes will not hold.

## 4. Accessibility and Responsive Verifier

Probe keyboard path, focus, labels, mobile widths, overflow, tap targets, reduced motion, and non-color status communication.

## 5. Implementation Surgeon

After row selection, edit only selected rows. Keep diffs small. Preserve behavior. Create backup when requested. Report exact files touched.

## 6. Anti-Slop Judge

After implementation, compare before/after evidence and score whether selected problems improved without introducing new slop.
