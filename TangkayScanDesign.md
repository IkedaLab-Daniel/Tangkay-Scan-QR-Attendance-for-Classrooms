# Tangkay Scan — Style Update

> **How to use:** Replace the "Design Direction", "Visual Principles", "Color Palette" and "Typography" sections of `style.md` with the sections below, and append the rest. Components, Motion, Screens and Consistency Rule from the original still apply unless overridden here.

---

## Design Direction (updated)

**Modern, minimalist, and a little cute — made for students, still trustworthy for teachers and parents.**

Think a calm notebook-and-stationery feel, not a corporate dashboard and not a kids' game. The brand name *Tangkay* (Filipino for "stem/stalk") gives us a natural visual identity: **a small sprout that grows**. Each attendance mark is a small growth moment.

Personality in one line: *friendly, tidy, quietly delightful.*

- Cute comes from **shape, color and small moments**, not from clutter, mascots everywhere, or emoji spam
- Minimalist means few elements per screen, generous spacing, one clear action at a time
- Trust still comes first: the app handles student photos, GPS and parent contact info, so errors, consent and flags must look calm and clear, never playful

---

## Avoid Generic "AI-Looking" Styling

Do **not** use:

- Purple-to-blue (or any rainbow) gradients, glowing orbs, aurora/mesh blobs
- Glassmorphism on every surface (translucency only where the custom background needs a scrim, see below)
- Sparkle/magic-wand icons, robot imagery, or "✨" anywhere
- Emoji used as icons or as UI decoration
- Inter/system gray everything, with identical white cards in a uniform grid of icon + title + description
- Stock 3D blob illustrations or generic "people holding giant phones" art
- Neon accent on near-black "techy" dark mode
- Copy like "Welcome back 👋", "Supercharge your attendance", "Seamless experience"
- Excessive drop shadows, heavy borders, or competing accent colors

Do instead:

- A **distinct, limited palette** with a warm, organic base
- **Rounded, soft geometry** with one consistent radius scale
- Hand-drawn-feeling or simple geometric **sprout/leaf motif** as the single recurring illustration idea
- **Plain, warm, human copy** ("You're in. Nice and early.")
- Varied layouts per screen where it helps (not every screen is a stack of identical cards)

---

## Visual Principles (updated)

- Soft, chunky, friendly shapes: large radii, thick-ish line icons (2px), rounded terminals
- Radius scale: `12px` (inputs, chips), `20px` (cards), `28px` (sheets, hero panels), full pill for badges and primary buttons
- Depth through **soft, low-opacity, slightly tinted shadows** (tint with the accent/ink color, never pure black)
- Generous spacing on a 4px grid; default screen padding `20px`
- One focal element per screen (the QR, the scan frame, the "start" button)
- Large tap targets (min `48px`), thumb-reachable primary actions at the bottom of the screen
- Illustrations: simple flat shapes in palette colors, limited to empty states, success moments, onboarding and the sprout mark

---

## Color Palette (updated)

Warm, natural, slightly playful. All values are starting points; verify contrast before locking.

| Role | Name | Hex | Use |
|---|---|---|---|
| Background | Paper | `#FAF7F2` | App background (when no custom image) |
| Surface | Cream | `#FFFFFF` | Cards, sheets |
| Surface alt | Oat | `#F1EBE0` | Secondary panels, input fills |
| Ink | Soil | `#2B2A26` | Primary text (warm near-black, never pure black) |
| Muted ink | Stone | `#77736A` | Secondary text, captions |
| Primary accent | Leaf | `#3F8F5B` | Primary buttons, active states, success |
| Accent soft | Sprout | `#DDF0DF` | Accent tint backgrounds, selected rows |
| Secondary accent | Peach | `#FF9F7A` | Rare highlights, small illustrations, streak/cute moments |
| Warning | Honey | `#E8A92E` | Flags needing review (location mismatch, medium risk) |
| Error | Berry | `#D4574E` | Rejections, destructive actions |

Rules:

- **Leaf green is the only primary accent.** Peach is a rare garnish, never on buttons
- Status colors appear only as small badges, icons and thin indicators, never as large fills
- Dark mode (optional, post-MVP): deep warm brown-green base (`#1C1F1B`), same Leaf accent lightened for contrast. No pure black, no neon
- Minimum contrast: 4.5:1 for body text, 3:1 for large text and UI components

---

## Typography (updated)

Friendly and rounded for personality, calm and legible for data.

- **Display / headings:** `Bricolage Grotesque` (or `Fredoka` if you want it cuter). Semi-bold, slightly tight tracking
- **Body / UI:** `Nunito` or `DM Sans`. Regular and medium weights
- **Numbers / times / codes:** same as body, with tabular figures enabled for attendance counts and timestamps
- Fallback stack: `system-ui, -apple-system, "Segoe UI", sans-serif` (the app must still look right if fonts fail on slow campus wifi)
- Scale: `32 / 24 / 20 / 16 / 14 / 12`. Body never below `16px` on mobile inputs (prevents iOS zoom)
- Max 2 font families and 3 weights across the app
- Load fonts via self-hosting (`font-display: swap`), no third-party font CDN calls (privacy and offline PWA)

---

## Motion & Cute Moments

Small, purposeful delight. Never blocks the user, always skippable by `prefers-reduced-motion`.

- **Successful scan:** a sprout pops up from the checkmark (≈600ms ease-out), then settles into "You're marked present"
- **Session started (officer):** QR panel fades in; the refresh ring is a thin leaf-green arc
- **Empty states:** small sprout illustration with a short friendly line
- **Buttons:** gentle scale-down (`0.97`) on press, soft spring back
- **Counts:** attendance count ticks up with a subtle number roll
- Keep durations 150-300ms for UI, up to 600ms for the one success moment
- Respect `prefers-reduced-motion`: replace animation with a static state

---

## Custom Background Image (Teacher Setting)

Teachers can upload an image that becomes the photo background of their room's screens, so each class feels like theirs.

### Behavior

- Setting location: **Room Settings → Appearance → Background**
- Options: upload a photo, choose from built-in presets (soft pastel textures, leaf patterns, paper), or none (default Paper)
- Scope: **per room** (primary). Optional teacher-level default that new rooms inherit
- Shown on: student home/scan screens, officer screens, room detail
- Sliders: **Dim** (scrim strength) and **Blur** (0-20px), with live preview
- "Reset to default" always available

### Readability rules (non-negotiable)

- Content never sits directly on the photo. Text lives on **surface cards** (`Cream` at ~92% opacity) or on an automatic **scrim** (dark or light overlay, default dim 35%)
- Auto-contrast: compute the image's average luminance on upload and pick a light or dark scrim so text stays at 4.5:1
- **QR display panel is always solid white** with a proper quiet zone, regardless of background. Scannability beats aesthetics
- Camera screens (scan, selfie) ignore the background entirely
- Status badges and flags always use their solid status colors on solid surfaces

### Upload constraints & processing

- Accepted: `jpeg`, `png`, `webp`. Max upload `5 MB`
- Server-side: resize to max `1600px` on the long edge, re-encode to `webp` (quality ~80), generate a small blurred placeholder for fast load
- **Strip all EXIF metadata** (GPS, device, timestamps). Teachers' photos must not leak location data
- Validate by file signature (not just extension); reject SVG, animated formats
- Store on EC2 under a non-public path, served through an authenticated, cacheable route (`Cache-Control` with versioned filename)
- Cap one active custom background per room; delete the old file on replace
- Cache the processed image in the PWA service worker so it works offline

### Safety & moderation

- Students (often minors) will see this image, so show a short guideline at upload ("Use appropriate, school-friendly images")
- Add a **Report background** option for students/officers, and let an admin remove an image and revert the room to default
- Do not allow images containing identifiable student photos by default (guideline text only at MVP; automated checks later)

### Data model additions

```
rooms (add)
  background_type ('none' | 'preset' | 'custom')
  background_preset_id (nullable)
  background_image_path (nullable)
  background_placeholder (nullable, tiny blurred data URI)
  background_dim (0-100, default 35)
  background_blur (0-20, default 0)
  background_scrim ('light' | 'dark', auto-computed, overridable)
```

---

## Screen Notes for the UI Builder

- **Teacher dashboard:** room cards vary in accent tint (Sprout, Oat, Peach tint) so the list doesn't feel like a wall of identical white boxes; small sprout mark in the header
- **Officer QR screen:** big solid-white QR panel with a thin leaf-green countdown arc; live "present" count beneath with a tiny sprout icon
- **Student scan screen:** full-bleed camera, soft rounded viewfinder corners, one line of friendly instruction
- **Success screen:** sprout pop animation, "You're in. Nice and early.", parent-notified confirmation line in muted text
- **Appearance settings:** large preview of the room with the chosen background, Dim and Blur sliders directly under it, presets as a horizontal row of rounded thumbnails

---

## Prompt Snippet for Stitch (optional)

```
Style: modern, minimalist, and gently cute, made for students but trustworthy for teachers and parents. Warm paper background (#FAF7F2), white cards with soft low-opacity tinted shadows, large rounded corners (20-28px), pill-shaped buttons, thick rounded line icons. Single primary accent: leaf green (#3F8F5B), rare peach (#FF9F7A) garnish. Warm near-black text (#2B2A26). Rounded friendly typography (Bricolage Grotesque headings, Nunito body). Recurring sprout/leaf motif as the only illustration idea. Avoid gradients, glassmorphism, neon, sparkle icons, emoji icons, stock 3D illustrations, and uniform grids of identical icon cards. Content sits on solid cards over an optional teacher-uploaded photo background with a dim overlay; the QR code always sits on a solid white panel.
```