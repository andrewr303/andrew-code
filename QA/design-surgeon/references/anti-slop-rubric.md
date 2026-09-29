# Anti-AI-Slop Rubric

Score each dimension from 0 to 5, where 0 is clean and 5 is severe.

| Dimension | What to inspect |
|---|---|
| Workflow clarity | The primary user decision/action is obvious within three seconds. |
| Product specificity | The UI belongs to this product and could not fit any random AI SaaS. |
| Information hierarchy | Labels, metrics, actions, status, and evidence are ordered by user value. |
| Data credibility | Metrics show unit, period, delta, source, confidence, and freshness when relevant. |
| Component discipline | Cards, tables, panels, controls, and charts are purposeful, not soup. |
| Typography | Type supports reading and numbers, not trend imitation. |
| Color/tokens | Color is semantic, accessible, restrained, and tokenized. |
| Motion | Motion supports state, feedback, continuity, or spatial relationship. |
| Accessibility | Contrast, focus, labels, keyboard, target size, and reduced motion are intact. |
| Responsiveness | No overflow, clipping, fixed viewport traps, or chart/table breakage. |
| Copy/trust | No fake proof. CTAs are action-specific. Claims are sourced or removed. |
| Implementation quality | No raw-value chaos, z-index panic, or broad unverified refactors. |

## Score bands

| Score | Meaning |
|---:|---|
| 0-15 | Clean enough for strict review. |
| 16-30 | Visible generated residue. Fix before serious release. |
| 31-55 | Heavy slop. Remediation required. |
| 56-75 | Redesign likely faster than patching. |
| 76-100 | Reject and rebuild direction. |

## Hard bans

- Generic purple-blue gradient as the primary visual idea.
- Gradient text as personality.
- Decorative glassmorphism and blur overload.
- Card soup, nested cards, identical feature grids.
- Generic dashboard shell with four KPI cards, unlabeled chart, and activity feed.
- Fake proof: metrics, logos, testimonials, uptime, user counts, revenue, customer quotes.
- Low-contrast tiny text.
- Color-only status.
- Unlabeled icon buttons or inputs.
- `outline-none` without a visible replacement.
- Motion spam: bounce, pulse, shimmer, transition-all, fade-in parade.
- Over-rounded surfaces everywhere.
- Sketchy SVG/doodle filler art.
- Raw hex and arbitrary value sprawl.
