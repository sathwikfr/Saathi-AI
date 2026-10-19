# Product

<!-- impeccable:product-schema 1 -->

> Drafted from CLAUDE.md and the codebase, then corrected by the owner on primary user, brand name status and accessibility/tone.

## Platform

web

## Users
- **Paying customer: an adult child**, mostly living abroad (NRI) or in another Indian city, paying for a parent in India. They live apart from the parent and worry about medicines, missed calls and emergencies. Uses the website, dashboard and WhatsApp updates. Family members (co-managers, viewers) and siblings join through invite links.
- **The parent** never uses a screen account: they receive Saathi's phone calls (Remind plan: WhatsApp medicine checks) in their own language, and may read a parent notice page. Text and tone aimed at them must be plain and warm.
- Customers abroad are supported (country picker on the customer's phone); the parent's phone is always an Indian number.

## Product Purpose
Aaptha lets an adult child look after an elderly parent from afar. **Saathi AI**, a voice companion, phones the parent on schedule for short medicine checks. Answers update the child's dashboard and raise alerts, levels 0 (fine) to 4 (emergency). Core loop: call, ask 2-3 questions, record answers, update dashboard, alert if needed. Success is a family that knows, without nagging, that the parent took their tablets and is safe.

## Positioning
A real phone call in the parent's own language (9 languages), with no app or smartphone needed on their side, paired with a family dashboard and WhatsApp alerts. The cheaper **Remind** plan (₹99, WhatsApp only) does the same medicine check without calls.

## Operating Context
- Deployed on Vercel (live site saathi-ai-delta.vercel.app); calls through Sarvam Voice Agents; alerts through Meta WhatsApp; payments through Razorpay (₹ plans, 7-day trial).
- Prices are in rupees and tax-inclusive. Plans: Free Trial, Remind, Solo, Family, Extended, with a Health Monitor add-on.
- Families read alerts on phones, mostly WhatsApp first, dashboard second.

## Capabilities and Constraints
- Next.js 16 App Router, React 19, plain CSS design system in `src/app/globals.css` plus CSS modules; **no Tailwind or shadcn**.
- Saathi never diagnoses, never panics the parent, and never identifies medicines by appearance. Medicine names from photos are always an editable draft the user confirms.
- Medicines carry a nickname Saathi says; the prescription name stays inside Aaptha unless the family opts in.
- Never show fabricated data (call logs, stats, medicines) to families.
- Wearable integration is parked.
- Open decision: the app name and domain (see Brand Commitments).

## Brand Commitments
- Working name **Aaptha** (renamed from CareCircle on 2026-10-01); the voice is **Saathi AI**. Aaptha is provisional: the name and domain are still being chosen, so keep it that way.
- User rejected green/teal and violet as the brand colour (2026-10-03); the current brand is ocean blue on warm ivory paper with a marigold accent. Hero uses a live voice orb. These are the current incumbent look, not a binding brief.

## Evidence on Hand
- Real families have made live test calls (Telugu, 2026-10-01). No real customer testimonials, case studies or press exist; do not invent any.
- Business details (name, address, GSTIN, support phone) are env-driven and not yet set; show nothing until set.

## Product Principles
1. Calm and plain over clever: health and emergency copy is warm, never alarmist.
2. The parent's dignity and consent come first (consent on the first call, "stop calling me", no spam).
3. Trust is shown by honesty: real data only, clear prices, clear limits of what Saathi does.
4. The family gets signal, not noise: one message per call, escalation only when it matters.
5. Cost is kept visible and low; prices are stated as the amount actually charged.

## Accessibility & Inclusion
- Nine languages (English plus Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati) in family- and parent-facing text.
- Parent-facing pages must suit older eyes and low-end Android phones.
- Tone is calm and never alarmist.
- Target standard: WCAG 2.1 AA.
