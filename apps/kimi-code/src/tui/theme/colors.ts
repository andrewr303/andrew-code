/**
 * Color palette definitions for dark and light themes.
 *
 * `darkColors` / `lightColors` are the semantic `ColorPalette` consumed by
 * every UI component via the global Theme singleton. Each token holds its hex
 * value directly — see the per-token docs on `ColorPalette` for what each one
 * controls.
 *
 * Light palette values are tuned for ≥ 4.5:1 contrast against #FFFFFF
 * for text tokens and ≥ 3:1 for chrome (border / large text), matching
 * WCAG AA.
 */

// Each token below documents where it is actually consumed, so theme authors
// know what changing it affects. "Widely" means the token is read across most
// dialogs/messages rather than in one specific place.
export interface ColorPalette {
  // ── Brand ──
  /** Dominant interactive/brand colour: links & inline code, the selected item
   *  in nearly every dialog, the focused editor border, plan/"running" badges,
   *  spinners. The most widely used token. */
  primary: string;
  /** Secondary highlight: approval "▶" prefix, device-code box, image
   *  placeholder, BTW / queue panes, custom-registry import. */
  accent: string;

  // ── Text ──
  /** Default body text: dialog bodies, todo titles, footer model label,
   *  markdown headings, tool/read output, and assistant-side message bullets
   *  (assistant / tool / agent / read) plus markdown list bullets. */
  text: string;
  /** Emphasised / bold text: input dialogs, status messages. */
  textStrong: string;
  /** Secondary, dimmed text (the most widely used dim shade): thinking blocks,
   *  hints, descriptions, completed todos, markdown quotes, and the footer
   *  status bar (cwd path, git badge). */
  textDim: string;
  /** Faintest text: counters, scroll info, descriptions, markdown link URLs,
   *  code-block borders. */
  textMuted: string;

  // ── Surface ──
  /** Borders: pane & editor borders, markdown horizontal rule. */
  border: string;
  /** Focus / attention border — currently only the approval panel. */
  borderFocus: string;

  // ── State ──
  /** Success: ✓ marks, "enabled", completed states. */
  success: string;
  /** Warning: auto/yolo badges, stale markers, plan-mode hint. */
  warning: string;
  /** Error: error messages, failed tool output. */
  error: string;

  // ── Diff (all consumed by components/media/diff-preview.ts) ──
  /** Added lines. */
  diffAdded: string;
  /** Removed lines. */
  diffRemoved: string;
  /** Added lines — intra-line changed words (bold). */
  diffAddedStrong: string;
  /** Removed lines — intra-line changed words (bold). */
  diffRemovedStrong: string;
  /** Line-number gutter (also approval panel/preview). */
  diffGutter: string;
  /** Meta / hunk headers. */
  diffMeta: string;

  // ── Roles ──
  /** User message: bullet & text, skill-activation name. The one role colour
   *  with its own hue — assistant/thinking/status bullets reuse text/textDim. */
  roleUser: string;

  // ── Shell mode ──
  /** Shell mode (`!`): the `!` prompt symbol, bash-mode editor border, and the
   *  echoed `$ command` line. Its own hue (violet), distinct from
   *  plan-mode (primary) and the user role (roleUser). */
  shellMode: string;

  // ── Swarm ──
  /** Swarm mode chrome: footer `[swarm]` badge, welcome swarm line, and
   *  swarm-activated transcript markers. Distinct fuchsia in the purple family. */
  swarm: string;
  /** Native Fusion CEO role chip (architect / owner). */
  roleCeo: string;
  /** Native Fusion COO role chip (operator / implementer). */
  roleCoo: string;
  /** Native Fusion worker / hive-captain role chip. */
  roleWorker: string;
  /** Native Fusion muse / dual-consultant role chip. */
  roleMuse: string;
}

export const darkColors: ColorPalette = {
  primary: '#B388FF',
  accent: '#A78BFA',

  text: '#EDE7F6',
  textStrong: '#F5F3FF',
  textDim: '#A89BB8',
  textMuted: '#7E6E95',

  border: '#6D5A8A',
  borderFocus: '#C4B5FD',

  success: '#4EC87E',
  warning: '#E8A838',
  error: '#E85454',

  diffAdded: '#4EC87E',
  diffRemoved: '#E85454',
  diffAddedStrong: '#7AD99B',
  diffRemovedStrong: '#F08585',
  diffGutter: '#6B6B6B',
  diffMeta: '#888888',

  roleUser: '#E9D5FF',
  shellMode: '#DDD6FE',

  swarm: '#E879F9',
  roleCeo: '#F9A8D4',
  roleCoo: '#7DD3FC',
  roleWorker: '#6EE7B7',
  roleMuse: '#FCD34D',
};

export const lightColors: ColorPalette = {
  primary: '#5B21B6',
  accent: '#7C3AED',

  text: '#1A1A1A',
  textStrong: '#1A1A1A',
  textDim: '#454545',
  textMuted: '#5F5F5F',

  border: '#737373',
  borderFocus: '#92660A',

  success: '#0E7A38',
  warning: '#92660A',
  error: '#B91C1C',

  diffAdded: '#0E7A38',
  diffRemoved: '#B91C1C',
  diffAddedStrong: '#0E7A38',
  diffRemovedStrong: '#B91C1C',
  diffGutter: '#737373',
  diffMeta: '#5F5F5F',

  roleUser: '#5B21B6',
  shellMode: '#6D28D9',

  swarm: '#A21CAF',
  roleCeo: '#9D174D',
  roleCoo: '#0369A1',
  roleWorker: '#047857',
  roleMuse: '#B45309',
};

export type ResolvedTheme = 'dark' | 'light';

/** Synchronous palette lookup for built-in themes only. */
export function getBuiltInPalette(resolved: ResolvedTheme): ColorPalette {
  return resolved === 'dark' ? darkColors : lightColors;
}
