# Polymux site design board — Editorial Atlas

This board follows Kole Jain's sequence: establish a brand feeling, assemble a wireframe from proven section patterns, then apply one repeated motion language.

## Core promise

**Everything you work with, in one place.** Polymux removes the switching and setup tax between conversations, files, browser tabs, and AI providers. It is a focused desktop workspace that arrives useful rather than asking ordinary users to assemble an agent stack.

## Audience feeling

- Authored editorial atlas, not another dashboard.
- Capable out of the box, not configuration-heavy.
- Private and personal, not enterprise automation theatre.
- Precise enough for technical users, clear enough for everyone else.

## Typography

- Display: `Iowan Old Style`, `Baskerville`, serif. Used sparingly to make the promise feel authored rather than generated.
- Interface/body: `Inter`, `SF Pro Text`, system sans-serif. Mirrors the desktop app.
- Technical labels: `SFMono-Regular`, `Menlo`, monospace. Reserved for model/provider and status details.
- Hero scale: `clamp(3.6rem, 8vw, 8rem)` with tight tracking and 0.9 line height.

## Palette

| Role | Colour | Use |
| --- | --- | --- |
| Ink | `#191916` | Product surfaces, footer, high-contrast frames |
| Paper | `#eee9dc` | Main page field and hero |
| Porcelain | `#fbfaf7` | Interface cards |
| Atlas red | `#d94a35` | Routing lines, editorial emphasis, primary accent |
| Archive blue | `#75889a` | Files and secondary information surfaces |
| Moss | `#89a86b` | Local/private status |

## Texture and imagery

- The product interface is the hero image. No stock people, floating 3D blobs, or fake AI portraits.
- A dark desktop surface sits within a warm ivory atlas field; a graph-paper grid and thin red routes make connections legible.
- Editorial index numbers, marginal notes, and ruled sections replace decorative cards.
- Product images dominate feature sections; copy stays short.

## Component language

- App-like 16–22px rounded panels with hairline borders and restrained shadows.
- Bare icon/text controls; no decorative pills unless they communicate status.
- Tight label/icon spacing, optical centring, hidden scrollbars, and no edge-to-edge dividers.
- Primary download action is dark on paper and light on ink. Secondary actions remain plain text.

## Page flow

1. Focused promise + macOS download + product composition.
2. A compact platform ribbon showing what comes together.
3. The problem: work scattered across disconnected surfaces.
4. Three large product chapters: communicate, find/use files, choose/run models.
5. Built-in capabilities rail: browser, memory, schedules, local inference, skills.
6. Privacy/local-first statement.
7. macOS-only install CTA with Windows/Linux clearly marked as coming next.

## Motion identity

- Sections gently hand over through vertical reveal and opacity; no parallax for its own sake.
- Connection paths breathe slowly, and provider tiles rotate through emphasis.
- Product surfaces lift by 2–4px on hover without resizing.
- All motion respects `prefers-reduced-motion`.

## Avoid

- Gradient headline text, excessive glass cards, rainbow blobs, fake metrics, fake testimonials, and vague “revolutionise your workflow” copy.
- Dense feature grids before the product problem is understood.
- Advertising Windows/Linux before installers have passed target-platform verification.
