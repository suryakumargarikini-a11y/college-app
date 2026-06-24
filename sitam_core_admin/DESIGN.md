---
name: SITAM Core Admin
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#434655'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#943700'
  on-tertiary: '#ffffff'
  tertiary-container: '#bc4800'
  on-tertiary-container: '#ffede6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#ffdbcd'
  tertiary-fixed-dim: '#ffb596'
  on-tertiary-fixed: '#360f00'
  on-tertiary-fixed-variant: '#7d2d00'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  mono-label:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin: 24px
  container-max: 1440px
---

## Brand & Style

The design system is engineered for SITAM Smart ERP, focusing on high-utility administrative workflows. The brand personality is authoritative yet accessible, emphasizing clarity, efficiency, and reliability. It targets enterprise administrators and operational managers who require a high information density without cognitive overload.

The visual style is a hybrid of **Corporate Modern** and **Minimalist**. It draws the structural rigor of the Microsoft Admin Center, the whitespace discipline of Notion, and the refined precision of Linear. The aesthetic prioritizes functional beauty through perfect alignment, subtle depth, and a restrained color application to ensure the user's focus remains on data and decision-making.

## Colors

The palette is anchored by a command-focused Primary Blue (#2563EB), used strategically for primary actions and active states. The background architecture utilizes a layered "White to Slate" approach: 

- **Surface Base:** Pure White (#FFFFFF) for primary content areas.
- **Surface Muted:** Light Gray (#F8FAFC) for sidebars, headers, and structural backgrounds.
- **Surface Border:** A soft gray (#E2E8F0) for defining boundaries without creating visual noise.

Semantic colors (Success, Warning, Alert) are high-clarity and used exclusively for status communication. To maintain a professional atmosphere, these colors should be paired with low-saturation backgrounds in toast messages or badges.

## Typography

The design system utilizes **Inter** as the primary typeface for its exceptional legibility in data-rich environments. The hierarchy is established through weight and color rather than excessive scale changes.

- **Headlines:** Use Semi-Bold (600) with slight negative letter-spacing for a modern, compact feel.
- **Body Text:** Standardized at 14px for general use to maximize information density while remaining readable.
- **Labels:** Use 12px Medium or Semi-Bold for table headers and form labels, often in a secondary slate color to diminish visual weight relative to user data.
- **Mono:** **JetBrains Mono** is reserved for ID tags, code snippets, or precise numerical data (e.g., SKU numbers).

## Layout & Spacing

This design system follows a strict **8px grid system**. All margins, paddings, and component heights must be multiples of 8. 

- **Grid Model:** A 12-column fluid grid for the main content area.
- **Desktop:** 24px outer margins, 16px gutters. The sidebar is fixed at 240px (collapsed to 64px).
- **Tablet:** 16px margins, 16px gutters. Sidebars transition to an overlay drawer.
- **Mobile:** 16px margins, single-column stack.

Spacing should prioritize grouping related items. Use 8px between labels and inputs, 16px between distinct form sections, and 24px–32px between major page modules.

## Elevation & Depth

Visual hierarchy is achieved through a combination of **Tonal Layers** and **Ambient Shadows**.

1. **Level 0 (Base):** Light Gray (#F8FAFC) background.
2. **Level 1 (Card/Surface):** Pure White (#FFFFFF) with a 1px border (#E2E8F0). This is the primary container for data.
3. **Level 2 (Active/Hover):** Applied to floating menus or dragged items. Use a soft, diffused shadow: `0 4px 12px rgba(0, 0, 0, 0.05)`.
4. **Level 3 (Modals):** Centered overlays with a backdrop blur (4px) and a deeper shadow: `0 12px 32px rgba(0, 0, 0, 0.1)`.

Avoid high-contrast shadows. Depth should feel "paper-thin" and structural, not floating in deep space.

## Shapes

The shape language is consistently rounded to soften the industrial nature of ERP software.

- **Standard Elements:** Inputs, Buttons, and Small Cards use a **16px (1rem)** radius (rounded-lg).
- **Nested Elements:** Elements inside a card should use a **8px (0.5rem)** radius to maintain visual harmony.
- **Circular:** User avatars and status pips remain fully rounded.

This 16px corner radius is a signature of the system, giving it a modern, "app-like" feel that distinguishes it from legacy enterprise software.

## Components

### Buttons
- **Primary:** Solid #2563EB with white text. 16px radius.
- **Secondary:** White background with #E2E8F0 border and #1E293B text.
- **Ghost:** No border/background until hover. Used for low-priority actions in tables.

### Inputs & Forms
- Inputs are 40px height with 16px radius. 
- Focus state: 1px #2563EB border with a 3px soft blue outer glow.
- Labels are 12px Semi-Bold, positioned 8px above the input.

### Cards
- White background, 16px radius, 1px border (#E2E8F0).
- No shadow by default; use shadows only for interactive cards on hover.

### Lists & Tables
- **Table Rows:** 48px minimum height. Suble gray (#F8FAFC) hover state.
- **Active State:** Use a 4px vertical primary blue bar on the far left of an active list item or navigation link.

### Chips/Badges
- Small, 12px text, 100px radius (pill).
- Backgrounds should be 10% opacity of the semantic color (e.g., Light Green background for Success Green text).

### Navigation
- Sidebar icons should be 20px, stroke-based (Linear style), with 2px stroke width.
- Use "Rounded Active States" for the sidebar—active links have a #EFF6FF background and #2563EB text.