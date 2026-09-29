---
description: Review and refactor UI code using principles from Refactoring UI - hierarchy, spacing, typography, color, depth, and polish. Use this when the user asks for UI review, visual design feedback, CSS audit, frontend polish, or wants to improve the look and feel of their interface.
user-invocable: true
argument-hint: "[file-or-directory]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
  - WebSearch
  - WebFetch
---

Review frontend UI code and produce actionable refactoring suggestions based on proven visual design principles. The target is: $ARGUMENTS (if empty, auto-detect frontend files in the current project).

## Step 0: Discover UI Files

If $ARGUMENTS is empty, find frontend files automatically:
```
find . -type f \( -name "*.html" -o -name "*.css" -o -name "*.scss" -o -name "*.less" -o -name "*.tsx" -o -name "*.jsx" -o -name "*.vue" -o -name "*.svelte" -o -name "*.astro" \) \
  -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.next/*' -not -path '*/vendor/*' | head -50
```

Also detect the CSS framework in use (Tailwind, Bootstrap, Material UI, etc.) by checking config files and imports. This affects how recommendations are phrased (utility classes vs raw CSS).

If $ARGUMENTS points to a specific file or directory, scope the review to that.

Read all discovered files. For large projects, prioritize: pages/layouts first, then components, then shared styles.

## Step 1: Visual Hierarchy Audit

Check every component/page for hierarchy issues. Hierarchy is the single most effective tool for making UI feel designed.

### 1a. Font size overreliance
- Flag cases where hierarchy is achieved only through font size differences
- Look for primary text that is oversized or secondary text that is too small
- PRINCIPLE: Use font weight (600-700 for emphasis, 400-500 for normal) and color (dark for primary, grey for secondary, lighter grey for tertiary) instead of relying solely on font size
- Flag any use of font-weight below 400 for body text -- too hard to read at small sizes

### 1b. Grey text on colored backgrounds
- Find instances of grey or low-opacity text on colored (non-white) backgrounds
- PRINCIPLE: Never use literal grey text on colored backgrounds. Instead, hand-pick a color with the same hue as the background, adjusting saturation and lightness for the right contrast
- Flag `opacity` or `rgba(255,255,255,...)` approaches on colored backgrounds -- these look washed out and let backgrounds bleed through images

### 1c. Competing elements
- Identify sections where all elements have equal visual weight
- PRINCIPLE: Emphasize by de-emphasizing. Instead of making the target element louder, make competing elements quieter (softer colors, lighter weights)
- Check sidebars: if they have a background color competing with main content, suggest removing the sidebar background and letting content sit on the page background

### 1d. Label usage
- Find label:value pairs displayed with naive formatting (e.g., "Email: john@example.com")
- PRINCIPLE: Labels are a last resort. If the format is self-evident (email, phone, price), omit the label. If needed, combine label into value ("12 left in stock" not "In stock: 12"). When labels are required (dashboards), de-emphasize them -- smaller, lighter, thinner
- Exception: information-dense pages where users scan for labels (tech specs) -- there the label can be darker than the value

### 1e. Document vs visual hierarchy
- Check if heading elements (h1-h6) are styled purely by their default sizes
- PRINCIPLE: Style headings based on visual needs, not HTML semantics. Section titles often act as labels and should be small/supportive, not large/dominant. The content below the heading should usually be the focus
- Flag any h1/h2 that is larger than necessary for its role

### 1f. Weight and contrast balance
- Check icon + text combinations: icons (especially solid) are heavy and tend to dominate
- PRINCIPLE: De-emphasize heavy elements (icons) by reducing contrast (softer color). Emphasize light elements (thin borders) by increasing weight (thicker) rather than darkening
- Flag solid icons at full color intensity sitting next to text

### 1g. Button hierarchy
- Audit all button styles in the project
- PRINCIPLE: Primary actions get solid high-contrast backgrounds. Secondary actions get outline styles or lower contrast backgrounds. Tertiary actions are styled as links. Destructive actions are NOT automatically big/red/bold -- give them secondary treatment with a confirmation step where the destructive action becomes primary

## Step 2: Layout and Spacing Audit

### 2a. White space
- Measure padding/margins in key containers
- PRINCIPLE: Start with too much white space, then remove. Elements given only minimum breathing room look actively bad. What feels like "too much" in isolation is usually "just enough" in context
- Flag tight padding in cards, sections, and page containers (e.g., padding under 16px on containers that should breathe)
- Exception: dense dashboards where packing information is intentional

### 2b. Spacing system
- Check if spacing values follow a consistent scale
- PRINCIPLE: Use a constrained spacing scale based on a base value (16px recommended). Scale should grow non-linearly: tighter at small end, more spread at large end. Adjacent values should differ by at least ~25%
- Recommended scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 640, 768
- Flag arbitrary values like 13px, 17px, 22px, 31px that sit between scale stops
- For Tailwind projects, check for arbitrary bracket values `[13px]` that bypass the system

### 2c. Unnecessary full-width
- Find elements stretched to fill available space unnecessarily
- PRINCIPLE: Give each element only the space it needs. If it only needs 600px, use 600px. Spreading things out makes interfaces harder to interpret
- Check forms, cards, and content blocks -- they usually have an optimal max-width
- PRINCIPLE: If a narrow element feels unbalanced in a wide layout, split into columns rather than making wider

### 2d. Grid over-reliance
- Check if percentage-based widths are used where fixed widths would work better
- PRINCIPLE: Sidebars, navs, and panels with known content should use fixed widths. Let main content flex. Don't use percentages to size something unless you want it to scale
- Flag sidebar widths expressed as column fractions (e.g., `col-span-3`) where a fixed width like `w-64` or `250px` is more appropriate

### 2e. Relative sizing that doesn't scale
- Check for em-based heading sizes or proportional padding in components
- PRINCIPLE: Large elements should shrink faster than small elements at smaller breakpoints. The ratio between heading and body should be smaller on mobile. Button padding should be disproportionately tighter at small sizes, more generous at large sizes
- Flag components where all dimensions scale proportionally via a single variable

### 2f. Ambiguous spacing
- Check form layouts: is space between label and its input the same as space between form groups?
- PRINCIPLE: Space within a group must be less than space between groups. Labels must be closer to their input than to the previous input. Headings must be closer to their section content than to previous section
- Flag equal spacing in stacked form elements, bulleted lists, and between section headings

## Step 3: Typography Audit

### 3a. Type scale
- Inventory all font sizes used in the project
- PRINCIPLE: Define a constrained type scale. Hand-crafted scales work better than modular ratios for UI design. Recommended sizes: 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72 (px)
- Flag projects using more than 10-12 distinct font sizes
- Flag any use of em units for font-size (causes compounding issues with nesting). Use px or rem only

### 3b. Font selection
- Check what fonts are loaded and used
- PRINCIPLE: For UI, prefer neutral sans-serifs. Fonts with 5+ weights indicate higher quality craftsmanship. System font stack is a safe default. Avoid condensed typefaces with short x-height for UI text
- Flag decorative or display fonts used for body text
- Check that headline fonts have appropriate letter-spacing (tighter for large headlines)

### 3c. Line length
- Measure paragraph width in characters
- PRINCIPLE: Optimal line length is 45-75 characters. Use `max-width: 20-35em` to constrain paragraphs. Even if surrounding content is wider (images, etc.), paragraphs should still be width-constrained
- Flag any paragraph or text block that can exceed 75 characters per line

### 3d. Baseline alignment
- Check places where different font sizes appear on the same line
- PRINCIPLE: Align mixed font sizes by their baseline, not by vertical centering. Baseline alignment creates a cleaner, simpler look
- Flag `items-center` / `align-items: center` on elements with mixed font sizes side by side

### 3e. Line height
- Check line-height values across the project
- PRINCIPLE: Line-height is inversely proportional to font size. Small text (body copy) needs taller line-height (1.5-2.0). Large text (headings) needs shorter line-height (1.0-1.25). Wide paragraphs need more line-height than narrow ones
- Flag uniform line-height applied to all text sizes
- Flag headings with line-height > 1.3 or body text with line-height < 1.4

### 3f. Link styling
- Audit link styles
- PRINCIPLE: In body text, links need to stand out (color/underline). In navigation or interfaces where almost everything is a link, use subtler treatment -- heavier font weight or darker color. Ancillary links can be styled only on hover
- Flag aggressive link styling (bright colors, underlines) in nav-heavy interfaces

### 3g. Text alignment
- Check for center-aligned text blocks
- PRINCIPLE: Don't center text longer than 2-3 lines. Right-align numbers in tables for easy comparison. If using justified text, enable hyphenation
- Flag center-aligned paragraphs or descriptions longer than 3 lines

### 3h. Letter spacing
- Check letter-spacing on headings and uppercase text
- PRINCIPLE: Tighten letter-spacing on large headlines (especially with wide font families). Increase letter-spacing on all-caps text to improve readability
- Flag `text-transform: uppercase` / `uppercase` without increased letter-spacing (suggest `tracking-wide` or `letter-spacing: 0.05em`)

## Step 4: Color Audit

### 4a. Color format
- Check what color format is used in the codebase
- PRINCIPLE: HSL is more intuitive than hex/RGB. Colors that look similar should look similar in code. HSL lets you reason about hue, saturation, and lightness independently
- Suggest HSL for new projects; don't flag existing hex if it's consistent

### 4b. Color palette completeness
- Count distinct colors in the project
- PRINCIPLE: A real UI needs 8-10 grey shades (not pure black to white), 5-10 shades of each primary color, and 5-10 shades each for accent/semantic colors (red, yellow, green, blue, etc.). Total: potentially 10+ hues with 5-10 shades each
- Flag projects with only 3-5 colors defined -- they will feel limiting

### 4c. Shade definition
- Check if color shades form a coherent 100-900 scale
- PRINCIPLE: Define shades up front, don't use CSS `lighten()`/`darken()` or opacity tricks. Pick base color (good button background), pick darkest (for text) and lightest (for tinted backgrounds), fill in between. 9 shades per hue is ideal
- Flag dynamic color manipulation functions (Sass lighten/darken, Tailwind opacity modifiers used to create shades)

### 4d. Saturation at extremes
- Check very light and very dark shades for washed-out appearance
- PRINCIPLE: As lightness approaches 0% or 100%, saturation impact weakens. Increase saturation for lighter and darker shades to keep them vibrant. For lighter shades, rotate hue toward nearest bright hue (60/180/300 degrees). For darker shades, rotate toward nearest dark hue (0/120/240 degrees). Don't rotate more than 20-30 degrees
- Flag flat shade scales where only lightness changes and saturation stays constant

### 4e. Grey temperature
- Check if greys are pure (0% saturation) or tinted
- PRINCIPLE: Saturate greys with a hint of blue (cool) or yellow/orange (warm) to give them personality. Increase saturation for lighter and darker grey shades to maintain consistent temperature
- Suggest warming or cooling greys if they are all pure grey

### 4f. Accessibility
- Check text contrast ratios (4.5:1 for normal text, 3:1 for large text per WCAG)
- PRINCIPLE: Accessible doesn't mean ugly. Flip the contrast -- use dark colored text on light colored background instead of white text on dark colored background. Rotate hue toward brighter colors to increase contrast without losing color
- Flag white text on insufficiently dark backgrounds. Suggest the flip approach

### 4g. Color-only communication
- Check if color is the sole indicator for states (success/error/warning, chart data, etc.)
- PRINCIPLE: Never rely on color alone. Add icons (checkmarks, warning triangles), text labels, or contrast differences. For charts with multiple colors, also use contrast differences (light vs dark) not just hue differences
- Flag status indicators, chart legends, and badges that use only color

## Step 5: Depth and Shadow Audit

### 5a. Light source consistency
- Check if shadows, borders, and gradients imply a consistent top-down light source
- PRINCIPLE: Light comes from above. Raised elements: lighter top edge (top border or inset box-shadow with slight positive y-offset), small dark shadow below (box-shadow with slight positive y-offset). Inset elements: lighter bottom edge, small dark inset shadow at top
- Flag mixed shadow directions or inconsistent light source assumptions

### 5b. Shadow elevation system
- Inventory all box-shadow values
- PRINCIPLE: Define 5 fixed shadow levels representing z-axis elevation. Small/tight shadows for buttons (slightly raised). Medium shadows for dropdowns (floating above). Large shadows for modals (capturing attention). The closer to user, the more attention it draws
- Flag more than 6-7 distinct shadow definitions (suggests no system)
- Flag shadows that don't match their element's importance

### 5c. Two-part shadows
- Check if shadows use the dual-shadow technique
- PRINCIPLE: Combine a larger/softer shadow (direct light source) with a tighter/darker shadow (ambient occlusion). At higher elevations, the tight ambient shadow should fade away
- Suggest this technique for key elevated elements (cards, dropdowns, modals)

### 5d. Flat depth techniques
- For designs without shadows, check if depth is communicated other ways
- PRINCIPLE: Even flat designs need depth. Use lighter colors to raise elements and darker colors to inset them. Use solid shadows (no blur, vertical offset only) for flat aesthetic. Overlap elements across background transitions to create layers
- Flag flat designs where all elements sit at the same visual depth

## Step 6: Image Audit

### 6a. Icon scaling
- Check if small icons (16-24px intended size) are scaled up beyond 2x
- PRINCIPLE: Icons designed for 16-24px look chunky at 3-4x. Instead, enclose small icons in a shape with a background color, keeping the icon near its intended size
- Flag icons at 48px+ that look chunky or lack detail

### 6b. Screenshot scaling
- Check for full-app screenshots shrunk to fit small spaces
- PRINCIPLE: Don't shrink full screenshots -- text becomes illegible. Use smaller viewport screenshots, partial screenshots, or simplified UI illustrations instead
- Flag `<img>` or `<screenshot>` elements with large source images displayed small

### 6c. Text over images
- Check for text overlaid on background images
- PRINCIPLE: Background images with variable brightness make text hard to read. Solutions: semi-transparent overlay (black for light text, white for dark text), lower image contrast, colorize image (desaturate + solid fill with multiply blend), or text-shadow with large blur and no offset
- Flag text-on-image without any contrast treatment

### 6d. User-uploaded content
- Check how user-uploaded images are displayed
- PRINCIPLE: Always use fixed containers with `object-fit: cover` for consistent layout. Prevent background bleed (image background matches page background) with a subtle inner box-shadow or semi-transparent inner border, NOT a visible border
- Flag user images displayed at intrinsic aspect ratio without cropping containers

## Step 7: Finishing Touches Audit

### 7a. Default elements
- Check for unstyled default elements (bullets, quotes, checkboxes, radio buttons)
- PRINCIPLE: Supercharge defaults. Replace bullets with icons (checkmarks, arrows, or content-specific icons). Style blockquotes with large decorative quote marks. Use custom checkboxes/radios with brand colors
- Flag default `<ul>` bullets, unstyled `<blockquote>`, and browser-default form controls

### 7b. Accent borders
- Check if the design uses colorful accent borders
- PRINCIPLE: Accent borders are a simple way to add visual flair without graphic design skill. Use them at top of cards, on active nav items, beside alert messages, under headlines, or across the top of the entire layout
- Suggest accent borders for bland-looking cards, alerts, or sections

### 7c. Background decoration
- Check for large monotonous background areas
- PRINCIPLE: Break monotony with background color changes between sections, subtle gradients (two hues within 30 degrees), repeating patterns (low contrast), or positioned geometric shapes/illustrations
- Flag long pages with uniform white/grey backgrounds throughout

### 7d. Empty states
- Search for empty state handling in the codebase
- PRINCIPLE: Empty states are a user's first interaction with a feature. Use illustrations/images, emphasize the call-to-action, and consider hiding supporting UI (tabs, filters) that does nothing without content. Don't just show "No items found"
- Flag empty states that are plain text with no visual treatment

### 7e. Border overuse
- Count border usage vs alternative separation techniques
- PRINCIPLE: Use fewer borders. Alternatives: box-shadow for outlining elements (more subtle), different background colors for adjacent elements, or simply more spacing. Borders make designs feel busy
- Flag borders used between elements that could be separated by background color or spacing alone

### 7f. Component creativity
- Check for overly conventional component designs
- PRINCIPLE: Think outside the box. Dropdowns can have sections, multiple columns, icons, and descriptions. Tables can combine related columns, add images, and use color. Radio buttons can become selectable cards
- Suggest creative alternatives for plain dropdowns, basic tables, and standard radio groups

## Step 8: Design Systems Check

### 8a. Systematize everything
- Verify that the project has defined systems for: font size, font weight, line height, color, spacing/margin/padding, width, height, box shadows, border radius, border width, opacity
- PRINCIPLE: Systems make decisions faster and designs more consistent. When constrained to values that all look noticeably different, picking the best one is easy -- use process of elimination
- Flag any of these categories that appear to use arbitrary values

### 8b. Personality consistency
- Check if the design has a consistent personality
- PRINCIPLE: Personality comes from font choice (serif = elegant, rounded sans = playful, neutral sans = plain), color (blue = safe, gold = sophisticated, pink = fun), border-radius (small = neutral, large = playful, none = formal), and language tone (formal vs casual). Mixing styles (rounded corners + angular elements) looks worse than committing to one
- Flag inconsistent border-radius values or mixed font personalities

## Step 9: Responsive Design Audit

### 9a. Mobile-first approach
- Check if styles are built mobile-first (min-width breakpoints) or desktop-first (max-width)
- PRINCIPLE: Design the mobile layout first, then adapt for larger screens. You'll change less than you think going up in size

### 9b. Proportional scaling issues
- Check for elements that scale proportionally across breakpoints
- PRINCIPLE: Large elements (headings, hero padding, images) should shrink faster than small elements (body text, button padding) at smaller breakpoints. The visual difference between large and small should decrease on mobile
- Flag headings and padding that maintain the same ratio at all breakpoints

### 9c. Fixed widths on mobile
- Check for fixed pixel widths that could overflow on small screens
- PRINCIPLE: Use max-width instead of width for elements that should shrink. Only force an element to shrink when the screen is smaller than the element's ideal size
- Flag `width: Xpx` without corresponding responsive overrides

## Step 10: Present Report

Organize findings by priority:

### Critical
Issues that significantly hurt usability or aesthetics:
- No visual hierarchy (everything competing)
- Ambiguous spacing (labels disconnected from inputs)
- Text unreadable on colored/image backgrounds
- Color-only state communication (accessibility)
- Line length exceeding 75+ characters

### Important
Issues that make the design feel unpolished:
- No spacing/sizing system (arbitrary values everywhere)
- Missing type scale
- Border overuse
- Shadows without a system
- Default/unstyled elements
- No shade palette (only a few flat colors)

### Polish
Refinements that elevate from good to great:
- Grey temperature (warm/cool tinting)
- Accent borders
- Two-part shadows
- Letter-spacing on uppercase text
- Background decoration
- Creative component alternatives
- Empty state design

For each finding:
1. State the specific issue with file path and line number
2. Quote the relevant code
3. Explain the principle being violated (one sentence)
4. Provide the concrete fix (exact code change or Tailwind class swap)

After presenting the report, ask the user which fixes to apply. Apply approved fixes directly using Edit/Write tools.

## Rules

- Read all relevant files before making any recommendations
- Base every suggestion on the specific principles above, not generic "best practices"
- Provide exact code changes, not vague advice
- Respect the existing tech stack and framework conventions
- Don't suggest adding dependencies unless absolutely necessary
- Don't rewrite entire components -- suggest targeted, minimal changes
- If the project uses Tailwind, give Tailwind class suggestions. If raw CSS, give CSS. Match the codebase
- Prioritize high-impact, low-effort fixes first
- When suggesting colors, provide actual HSL values, not just "make it darker"
- When suggesting spacing, reference the scale (step 2b) and give exact values
