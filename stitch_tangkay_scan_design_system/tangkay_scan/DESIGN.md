---
name: Tangkay Scan
colors:
  surface: '#fdf9f2'
  surface-dim: '#ddd9d3'
  surface-bright: '#fdf9f2'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f7f3ec'
  surface-container: '#f1ede7'
  surface-container-high: '#ece8e1'
  surface-container-highest: '#e6e2dc'
  on-surface: '#1c1c18'
  on-surface-variant: '#3f4940'
  inverse-surface: '#31302c'
  inverse-on-surface: '#f4f0ea'
  outline: '#6f7a70'
  outline-variant: '#bfc9be'
  surface-tint: '#166c3c'
  primary: '#126a3a'
  on-primary: '#ffffff'
  primary-container: '#338351'
  on-primary-container: '#f6fff4'
  inverse-primary: '#87d89d'
  secondary: '#94492b'
  on-secondary: '#ffffff'
  secondary-container: '#fd9e79'
  on-secondary-container: '#773316'
  tertiary: '#4f6053'
  on-tertiary: '#ffffff'
  tertiary-container: '#67796b'
  on-tertiary-container: '#f6fff5'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#a2f5b8'
  primary-fixed-dim: '#87d89d'
  on-primary-fixed: '#00210d'
  on-primary-fixed-variant: '#00522a'
  secondary-fixed: '#ffdbce'
  secondary-fixed-dim: '#ffb59a'
  on-secondary-fixed: '#370e00'
  on-secondary-fixed-variant: '#763316'
  tertiary-fixed: '#d4e7d7'
  tertiary-fixed-dim: '#b9cbbb'
  on-tertiary-fixed: '#0f1f15'
  on-tertiary-fixed-variant: '#3a4b3e'
  background: '#fdf9f2'
  on-background: '#1c1c18'
  surface-variant: '#e6e2dc'
typography:
  headline-xl:
    fontFamily: Bricolage Grotesque
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
  headline-xl-mobile:
    fontFamily: Bricolage Grotesque
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-lg:
    fontFamily: Bricolage Grotesque
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Bricolage Grotesque
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Bricolage Grotesque
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: DM Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: DM Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: DM Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: DM Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  label-md:
    fontFamily: DM Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: DM Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.03em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 1.25rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.25rem
  space-xl: 1.75rem
---

## Brand & Style

The design system embodies a calm, warm, and gently tactile stationery atmosphere designed for education—bridging students, teachers, and guardians. The personality balances the reassuring grounding of a physical daily planner with the breezy simplicity of modern utility. It feels organic, dependable, quiet, and friendly without devolving into childish novelty.

### Aesthetic Principles
- **Notebook & Stationery Ethos:** Interfaces are informed by clean paper stocks, warm unbleached tones, structured tabs, and deliberate ink weights.
- **Organic Softness:** Rigid corners and clinical grays are completely absent. Structure is achieved through warm paper fills, rounded contours, and soft earth-tinted shadows.
- **Intentional Restraint:** Visual decoration is restricted to functional cues and rare botanical garnishes. No glassy specular highlights, neon fills, or artificial sparkle iconography.

## Colors

The palette references classic stationery materials: textured paper, fresh botanical ink, and earthen dyes.

### Surface & Canvas Tiers
- **Canvas / Paper (`#FAF7F2`):** Base canvas layer representing natural, unbleached paper.
- **Surface / Cream (`#FFFFFF`):** Elevated cards, sheets, and active input containers.
- **Surface Alt / Oat (`#F1EBE0`):** Inset containers, segmented track backgrounds, and structural dividers.

### Inks & Hierarchy
- **Ink Soil (`#2B2A26`):** Deep, warm organic black for headlines, body copy, and core iconography.
- **Muted Ink Stone (`#77736A`):** Low-emphasis text, metadata, subtle borders, and unselected states.

### Accents & Semantic States
- **Leaf (`#3F8F5B`):** Primary brand accent for successful attendance scans, affirmative buttons, and selected states.
- **Sprout (`#DDF0DF`):** Soft botanical wash for selected card highlights, tag fills, and progress indicators.
- **Peach (`#FF9F7A`):** Secondary accent used sparingly as a cheerful highlight, pending status, or special badge.
- **Honey (`#E8A92E`):** Tardy attendance, warnings, and attention notes.
- **Berry (`#D4574E`):** Absences, errors, destructive alerts, and failed scans.

## Typography

The type system pairs the human, subtly quirky warmth of Bricolage Grotesque for titles with the clean, legible clarity of DM Sans for interface mechanics and dense student rosters.

- **Headlines:** Set in Bricolage Grotesque with natural optical sizing. Expressive strokes provide a friendly greeting on launch and scan confirmations.
- **Body & Numerical Readouts:** Set in DM Sans with open counters and balanced heights, maintaining instant legibility when reading student names, timestamps, and classroom numbers in fast-moving environments.

## Layout & Spacing

Layouts follow a handheld-first fluid grid optimized for rapid thumb actions and camera viewfinder alignment.

- **Mobile Viewport:** 4-column layout with 16px lateral canvas margins and 12px gutters. All primary actions reside in the lower thumb-reach zone.
- **Tablet / Attendance Kiosk Mode:** 8-column layout with 24px margins and 16px gutters, providing dual-pane support (live camera scanner left, confirmed roster stream right).
- **Rhythm:** Spacing follows an 8pt base scale (with 4pt sub-steps for compact list items and metadata). Elements maintain generous interior whitespace to evoke uncluttered, high-grade stationery notebooks.

## Elevation & Depth

Visual hierarchy is maintained through tactile layering and warm, diffuse environmental shadows rather than stark elevation drops.

- **Base Layer:** Background Paper (`#FAF7F2`) sits beneath all interface modules.
- **Stationery Cards & Insets:** Surface Cream (`#FFFFFF`) cards resting on paper use a soft, earth-tinted shadow: `0 4px 16px rgba(43, 42, 38, 0.05), 0 1px 2px rgba(43, 42, 38, 0.03)`.
- **Active Floats & Bottom Sheets:** Attendance scanner overlays, filter sheets, and bottom modals use a deeper, grounding ambient shadow: `0 12px 32px rgba(43, 42, 38, 0.08), 0 2px 6px rgba(43, 42, 38, 0.04)`.
- **Subtle Surface Definition:** When cards require structural distinction without elevation, a 1px soft border in `#E8E2D5` is used in lieu of harsh shadows.

## Shapes

The shape hierarchy establishes clear tactile meaning across interactive scales:

- **12px (`rounded-md`):** Compact inputs, roster search bars, segmented chips, and data pill containers.
- **20px (`rounded-lg`):** Attendance cards, student profile summaries, and grouped list modules.
- **28px (`rounded-xl`):** Camera scanner viewfinders, modal sheets, and hero dashboard headers.
- **Full Pill (`rounded-full`):** Buttons, status badges, counter dots, and floating action indicators.
- **Iconography:** Built with consistent 2px rounded strokes, continuous paths, and curved terminals that mimic smooth fountain pen drawings.

## Components

### Buttons
- **Primary:** Full pill container with Leaf (`#3F8F5B`) fill, White (`#FFFFFF`) bold text, and a soft Leaf shadow (`0 4px 12px rgba(63, 143, 91, 0.25)`). Pressed state translates down 1px with reduced shadow.
- **Secondary / Soft:** Sprout (`#DDF0DF`) container with Leaf (`#3F8F5B`) text. No drop shadow.
- **Ghost:** Transparent background with Ink Soil (`#2B2A26`) text and 1px Oat (`#F1EBE0`) border.

### Inputs & Scanner Fields
- **Search & Fields:** Surface Cream (`#FFFFFF`) fill, 12px radius, 1px border in `#E8E2D5`, and Ink Soil placeholder text. Focused state transitions border to Leaf (`#3F8F5B`) with a 3px Sprout (`#DDF0DF`) outer aura.
- **Viewfinder Reticle:** 28px rounded viewport outlined in Leaf with smooth corner notches and sprout leaf tick indicators.

### Chips & Filter Tabs
- **Default:** Oat (`#F1EBE0`) surface, Stone (`#77736A`) text, 12px radius.
- **Selected:** Sprout (`#DDF0DF`) surface, Leaf (`#3F8F5B`) text, accompanied by a small 6px Leaf dot indicator.

### Cards & Roster Lists
- **Student Roster Card:** Surface Cream (`#FFFFFF`), 20px radius, soft earth-tinted shadow. Contains avatar with Oat circle, bold student name, and status pill on the trailing edge.
- **Status Pills:** Full pill badge with 4px vertical padding and 10px horizontal padding.
  - Present: Sprout (`#DDF0DF`) background, Leaf (`#3F8F5B`) text.
  - Tardy: Pale Honey (`#FCF2DE`) background, Honey (`#E8A92E`) text.
  - Absent: Pale Berry (`#FAECEB`) background, Berry (`#D4574E`) text.

### Selection Controls
- **Checkboxes & Radios:** 20px containers with smooth 6px rounded corners (checkbox) or circular profiles (radio). Unchecked: 1.5px Stone outline on Cream. Checked: Leaf solid fill with a 2px white organic checkmark.