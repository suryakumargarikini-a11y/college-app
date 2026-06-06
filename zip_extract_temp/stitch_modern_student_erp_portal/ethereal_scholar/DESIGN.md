# Design System: Ethereal Scholar

### 1. Overview & Creative North Star
**Creative North Star: "The Digital Curator"**
The Ethereal Scholar system is designed to transform academic management into a curated, high-end editorial experience. It moves away from the rigid, spreadsheet-like interfaces of traditional education software, instead utilizing **Bento-box layouts**, **glassmorphism**, and **asymmetrical emphasis** to create a sense of intellectual calm. 

The system prioritizes breathability and tonal depth. By utilizing high-contrast typography scales and overlapping translucent layers, we create a UI that feels less like a tool and more like a sophisticated digital journal.

### 2. Colors
Our palette is rooted in soft lavenders (`#efdbff`), muted charcoal (`#5f5f5f`), and sophisticated rose tones (`#fca3ae`).

- **The "No-Line" Rule:** Sectioning is achieved through color-blocking and background shifts. Explicit 1px solid borders are strictly prohibited for layout division. Boundaries are defined by transitions between `surface_container_low` and `surface_container_highest`.
- **Surface Hierarchy & Nesting:** Depth is created by nesting `surface_container_lowest` cards within `background` or `surface` areas.
- **The "Glass & Gradient" Rule:** Use `backdrop-blur` (20px to 30px) for floating headers and primary cards to maintain a sense of environmental awareness and light.
- **Signature Textures:** Use subtle 30% opacity fills for container backgrounds (e.g., `secondary_container/30`) to allow the background color to bleed through, creating a "custom-tinted" appearance.

### 3. Typography
The typography system uses **Plus Jakarta Sans** for headlines to provide a modern, geometric authority, paired with **Manrope** for body and label text to ensure high legibility and a humanist feel.

**Typography Scale (Calibrated):**
- **Display/Hero:** 1.5rem (24px) - Extrabold, tracking-tight.
- **Headlines:** 1.125rem (18px) to 1.25rem (20px) - Bold.
- **Body Large:** 1rem (16px) - Medium/Regular.
- **Body Small/Label:** 11px to 13px - Often used with `uppercase` and `tracking-wider` for a scholarly metadata feel.
- **Micro-labels:** 9px to 10px - Bold, tracking-widest for secondary descriptors (e.g., GPA labels).

### 4. Elevation & Depth
Elevation is achieved through **Tonal Layering** and soft, ambient diffusion rather than harsh shadows.

- **The Layering Principle:** Use `surface_container_lowest` (#ffffff) for the most prominent interactive cards to "lift" them off the `surface` (#faf9fc).
- **Ambient Shadows:** The system uses the `shadow-md` property, specifically calibrated as `0 4px 20px rgba(48, 51, 55, 0.04)`. These are nearly imperceptible, providing just enough definition to separate layers.
- **Glassmorphism & Depth:** Primary headers and timetable cards use `rgba(255, 255, 255, 0.7)` with a `backdrop-blur-3xl` (20px+ blur) to create a premium, "frosted" aesthetic.
- **The "Ghost Border" Fallback:** If extra definition is required, use `white/20` or `white/40` borders on glass elements to simulate light catching an edge.

### 5. Components
- **Bento Tiles:** Non-uniform grid items with internal flex layouts. Use varying background colors (`secondary_container`, `tertiary_container`, `surface_container_high`) to denote different categories of information.
- **Glass Cards:** Used for temporal data (like schedules). Must include a subtle white border and heavy backdrop blur.
- **Action Buttons:** Pill-shaped (`rounded-full`) with high-contrast text. Secondary actions use `secondary_container` fills with `secondary` text.
- **Pill Navigation:** The bottom navigation uses a floating pill design for the active state, reinforcing the "curated" feel.
- **Progress Gauges:** Minimalist SVG circles with thin stroke weights (stroke-width 4) for a refined, data-lite appearance.

### 6. Do's and Don'ts
**Do:**
- Use asymmetric grids (Bento style) to group related data.
- Apply `uppercase` and `tracking-widest` to labels under 11px to ensure legibility.
- Use `backdrop-filter: blur` on all fixed or floating elements.
- Mix serif-like geometric headers with clean sans-serif body text.

**Don't:**
- Never use a solid black (#000000) for text; use `on_surface` (#303337) for better tonal harmony.
- Avoid sharp 90-degree corners; the system defaults to `rounded-lg` (0.75rem) or `rounded-xl` (2rem).
- Do not use heavy, dark shadows. If a shadow is visible at first glance, it is too heavy.
- Do not use lines to separate list items; use vertical spacing or very subtle tonal shifts.