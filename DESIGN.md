---
name: Aaptha
description: Warm ivory paper, ocean-blue brand, marigold accent; a calm family-care product.
colors:
  ocean-blue: "#006baa"
  ocean-blue-deep: "#005187"
  ocean-ink: "#003860"
  ocean-mist: "#e4f5ff"
  marigold: "#f2a33a"
  marigold-text: "#a8510c"
  marigold-soft: "#fcefdc"
  ivory-paper: "#f8f5ef"
  parchment: "#f1ece3"
  white-card: "#ffffff"
  warm-ink: "#1f1c18"
  warm-ink-muted: "#57514a"
  warm-ink-subtle: "#766f66"
  hairline: "#e2dbcf"
  night-band: "#011a2e"
  status-green: "#1a6f45"
  status-amber: "#8a4f06"
  status-red: "#b42318"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 6vw, 4.75rem)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Bricolage Grotesque, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.6vw, 3rem)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Bricolage Grotesque, Segoe UI, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Figtree, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Figtree, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.76rem"
    fontWeight: 600
    letterSpacing: "0.01em"
rounded:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "22px"
  xl: "32px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "16": "64px"
components:
  button-primary:
    backgroundColor: "{colors.ocean-blue}"
    textColor: "{colors.white-card}"
    rounded: "{rounded.full}"
    padding: "0 22px"
    height: "46px"
  button-primary-hover:
    backgroundColor: "{colors.ocean-blue-deep}"
  button-ghost:
    backgroundColor: "{colors.white-card}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.full}"
    padding: "0 22px"
    height: "46px"
  input:
    backgroundColor: "{colors.white-card}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    height: "48px"
  panel:
    backgroundColor: "{colors.white-card}"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge-teal:
    backgroundColor: "{colors.ocean-mist}"
    textColor: "{colors.ocean-blue}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
---

# Design System: Aaptha

## Overview

**Creative North Star: "The Kitchen-Table Ledger"**

A family's care should feel like a warm, well-kept notebook on a kitchen table: ivory paper, a steady blue pen, a marigold marker for what needs a glance. Nothing shouts. The system exists to make health information readable at a glance by someone worried and far away, so it favors soft surfaces, generous radii, plain wording and a single confident blue.

Density is moderate: cards breathe, but sections were deliberately tightened (the page "felt too airy" earlier). Dark navy bands carry the landing's cinematic scenes; the app itself stays on paper. Colour carries meaning (blue for the brand, marigold for warmth, green/amber/red only for status), never decoration for its own sake. The landing hero is the one place for expression: a voice orb and animated gradient CTA.

Rejected by the owner: peacock teal/green and violet as the brand colour.

**Key Characteristics:**
- Warm ivory paper with a hand-made, human feel, not clinical white.
- Pill buttons, large rounded cards, soft warm-tinted shadows.
- Ocean blue for action and identity; marigold as the warm accent.
- Bricolage Grotesque headings with Figtree body.
- Full dark theme (warm charcoal) and dark "film" bands on the landing.
- Calm status colours; emergencies are clear, never alarmist.

## Colors

Ocean blue on ivory with a marigold spark; status colours are used only for status. Token names in CSS (`--teal`, `--gold`) are legacy; the values are the truth.

### Primary
- **Ocean Blue** (#006baa): text, borders, icons and solid button fills (`--teal` / `--teal-fill`, white text on fills). Hover **Deep Ocean** (#005187). In dark mode text becomes a pale sky (#8ccdf7) while fills stay #006baa.
- **Ocean Ink** (#003860): blue-toned text on pale blue; **Ocean Mist** (#e4f5ff) is the soft tint behind badges and icon tiles.

### Secondary
- **Marigold** (#f2a33a): fills and decoration only. **Marigold Text** (#a8510c) is the text-safe version; **Marigold Soft** (#fcefdc) the tint.

### Neutral
- **Ivory Paper** (#f8f5ef): page background. **Parchment** (#f1ece3): inset panels. **White Card** (#ffffff): elevated cards. **Hairline** (#e2dbcf): borders.
- **Warm Ink** (#1f1c18), **Muted** (#57514a), **Subtle** (#766f66): text ladder.
- **Night Band** (#011a2e): the dark landing scenes.

### Status
- **Green** (#1a6f45), **Amber** (#8a4f06), **Red** (#b42318), each with a soft tint and border; they mean call/alert state only.

### Named Rules
**The Status-Only Rule.** Green, amber and red appear only to report status (taken, needs attention, emergency). Never decorate with them.
**The Marigold Warmth Rule.** Marigold is the warm accent for fills; as text it must be the darker #a8510c.
**The No-Teal Rule.** The brand is ocean blue; do not drift back to green/teal or to violet.

## Typography

**Display Font:** Bricolage Grotesque (with Segoe UI, system-ui)
**Body Font:** Figtree (with system sans fallbacks)

**Character:** Bricolage brings a friendly, slightly quirky voice to headings; Figtree keeps reading text open and clear for older eyes.

### Hierarchy
- **Display** (600, clamp(2.6rem, 6vw, 4.75rem), 1.12): hero headline only.
- **Headline** (600, clamp(2rem, 3.6vw, 3rem), 1.12): section titles.
- **Title** (600, 1.375rem to 1.5rem): card and panel headings.
- **Body** (400, 1rem, 1.6): reading text; keep lines to about 65-75ch.
- **Label** (600, 0.76rem to 0.875rem, +0.01em): badges, captions, small controls.

### Named Rules
**The Readable-Small Rule.** Nothing below 0.75rem, and parent-facing text never drops below base size.

## Layout

A centred content column with generous but trimmed section rhythm (`--section-y` clamp(44px, 7.5vw, 96px)). Spacing runs on a 4px base (4, 8, 12, 16, 20, 24, 32, 40, 48, 64). Cards stack with 20px gaps. The dashboard is tabbed panels; the landing is a vertical sequence of ivory sheets and dark film bands. Must work at 375px with no sideways scroll; touch targets at least 44px (buttons 46px, inputs 48px).

## Elevation & Depth

Mostly tonal layering (ivory, parchment, white cards) plus soft warm-tinted shadows (brown-black at low alpha, blue-tinted for large lifts). In dark mode shadows turn pure black and deeper.

### Shadow Vocabulary
- **Hairline** (`0 1px 2px rgba(41,30,15,.05)`): cards at rest.
- **Soft** (`0 1px 2px …, 0 4px 12px -4px …`): panels, ghost buttons on hover.
- **Lift** (`0 2px 4px …, 0 18px 36px -14px rgba(41,30,15,.16)`): hovered cards.
- **Float** (`… 0 40px 72px -28px rgba(0,32,56,.32)`): hero and modal-scale objects.

### Named Rules
**The Quiet-At-Rest Rule.** Surfaces are nearly flat at rest; depth grows on hover and focus.

## Shapes

Soft and rounded: pills (9999px) for buttons and badges, 16px for inputs, 22px to 32px for cards and panels, 12px for icon tiles. Borders are 1px warm hairlines. Silhouettes are never sharp.

## Components

### Buttons
- **Shape:** full pill, 46px tall, 22px side padding, 600 weight.
- **Primary:** Ocean Blue fill, white text, faint inner highlight and blue glow; hover deepens and lifts 1px; press scales to 0.98.
- **Ghost:** white fill, hairline border, soft shadow; also Quiet (text only), Gold, Danger variants.
- **Glow (hero CTA):** slowly turning blue/sky/pink gradient with bloom; one per view only.
- **Disabled:** 55% opacity, no shadow.

### Inputs / Fields
- **Style:** white, 1px hairline, 16px radius, 48px tall.
- **Focus:** Ocean Blue border with a 4px soft blue ring. **Error:** red border on a red tint.

### Cards / Panels
- White card, 1px subtle hairline, 32px radius (22px on phones), 24px padding (20px on phones), soft shadow.

### Badges
- Pill, 0.76rem 600; tinted background with matching text (teal, gold, green, amber, red, neutral variants).

### Navigation
- Ivory header; the navbar switches to the dark scene colours while a dark film band is directly beneath it.

### Voice Orb (signature)
- The landing hero's live orb (blue to violet to magenta, cyan when Saathi speaks, pink for family), reacting to touch and voice. A Siri-style glass orb is saved as an alternative.

## Do's and Don'ts

### Do:
- **Do** use ocean blue for primary actions and identity, with `--teal-fill` + `--on-teal` for solid backgrounds.
- **Do** read colours from tokens (`var(--teal)`, `var(--paper)`); never raw hex in components.
- **Do** keep status colours for status and pair them with words or icons.
- **Do** support light and dark themes and `prefers-reduced-motion`.
- **Do** keep health and emergency copy calm, plain and translatable across nine languages.

### Don't:
- **Don't** use green/teal or violet as the brand colour.
- **Don't** introduce Tailwind or shadcn; the design system is plain CSS in `globals.css`.
- **Don't** add sharp corners, heavy shadows or harsh red alarm styling.
- **Don't** use more than one `.btn-glow` per view.
- **Don't** show invented data (fake logs, stats, testimonials).
