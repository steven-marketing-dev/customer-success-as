# Design System

The visual language for the Customer Success KB. The aesthetic is **warm, calm, and confident** — soft off-white surfaces, mint-accented actions, generous radii, and content that reads more like a notebook than a SaaS dashboard.

## Design principles

1. **Warm over cool.** Backgrounds are off-white (`#FAF9F6`), not pure white. Text is desaturated navy (`#2D3142`), not black. The palette avoids the cold grey-blue of generic admin tools.
2. **One accent, used sparingly.** Mint (`#33b29c`) marks the primary action, the active state, and brand moments. Every other surface stays neutral so the accent reads as a signal.
3. **Soft edges, no hard lines.** Radii start at 10px and go up to 24px. Borders are a single hairline of `--border`; shadows are diffuse and low-contrast.
4. **Type does the structural work.** Display headings in Nunito set hierarchy; DM Sans body text carries the rest. No box-shadows or borders are needed where typographic contrast already separates content.
5. **Motion is acknowledgement, not decoration.** A 200ms cubic-bezier ease on interactives, a `fade-up` on first paint, and a `mint-pulse` only on live indicators.

## Color tokens

Defined in [globals.css](src/app/globals.css) as CSS variables and mirrored in [tailwind.config.ts](tailwind.config.ts).

### Brand — mint
| Token | Hex | Use |
|---|---|---|
| `mint-50` / `--mint-light` | `#e8f6f3` | Tint backgrounds for primary callouts |
| `mint-100` | `#ccf0e8` | Hover tint, badge fill |
| `mint-200` | `#99e0d1` | Borders on mint surfaces |
| `mint-500` / `--mint` | `#33b29c` | Primary buttons, links, focus ring, active tab |
| `mint-600` / `--mint-dark` | `#2a9483` | Primary hover |
| `mint-700` / `--mint-darker` | `#1e7a6d` | Pressed, headings on mint |

### Surfaces — warm
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#FAF9F6` | Page background |
| `--bg-warm` / `warm-100` | `#F5F3EF` | Recessed panels, hover row |
| `--card` | `#ffffff` | Cards, modals |
| `warm-200` / `--border` | `#E8E6E1` | Default 1px border |
| `warm-300` / `--border-hover` | `#D4D1CB` | Hover border |
| `warm-400` / `--text-muted` | `#A0A5B2` | Disabled, captions |
| `warm-500` / `--text-secondary` | `#6B7280` | Secondary copy, metadata |
| `warm-700` | `#374151` | Body emphasis |
| `warm-800` / `--text` | `#2D3142` | Primary body text |
| `warm-900` | `#1a1a2e` | Strong / heading dark |

### Status
| Token | Hex | Use |
|---|---|---|
| `coral-400` / `--coral` | `#F97066` | Destructive, errors |
| `--coral-light` | `#FEF2F1` | Error background |
| `--amber` | `#F59E0B` | Warning, "in progress" |
| `--amber-light` | `#FEF9EC` | Warning background |
| `--success` | `#33b29c` (mint) | Success — intentionally the same as brand |
| `emerald-500` | `#10B981` (Tailwind) | Resolved / positive metrics in cards |

> **Rule:** never introduce a fifth status color. If a state doesn't fit success/warning/error/info, restate it with iconography against neutral text.

## Typography

Two families, loaded from Google Fonts in [globals.css](src/app/globals.css).

| Family | Stack alias | Used for |
|---|---|---|
| **Nunito** (400–800) | `font-display` | All headings (`h1`–`h6`), card titles, numeric stat values |
| **DM Sans** (400–700, italic) | `font-sans` (body default) | Body, UI labels, inputs, buttons |
| **JetBrains Mono / Fira Code** | `font-mono` | Code, logs, raw IDs |

### Scale (rendered sizes in current components)
- **Hero / page title** — `text-2xl`–`text-3xl`, `font-display font-bold`, `text-warm-900`
- **Card title** — `text-lg font-display font-bold text-warm-800`
- **Section label** — `text-[10px] uppercase tracking-wide font-semibold text-warm-500`
- **Body** — `text-sm leading-snug text-warm-800`
- **Metadata / caption** — `text-xs text-warm-500`
- **Numeric stat** — `font-display font-semibold tabular-nums text-warm-700`

### Rules
- Use `tabular-nums` on any number that can change (counts, ratings, percentages) — it prevents layout jitter.
- Section labels are always `[10px] uppercase tracking-wide` — never use sentence case for these eyebrow labels.
- Strong emphasis inside body copy is `font-semibold text-warm-900`, not `font-bold`.

## Spacing & layout

Tailwind's default 4px scale. Common rhythms used across components:

- **Card padding** — `p-5` (20px). `p-6` only for top-level panels.
- **Card internal stack** — `space-y-4` between sections, `space-y-2` within a section.
- **Inline gaps** — `gap-2` for related controls, `gap-3` for groups, `gap-4` for sibling cards.
- **Header row** — `flex items-start gap-3 flex-wrap`.
- **Grid** — `grid grid-cols-1 md:grid-cols-2 gap-4` for two-column content blocks inside a card; outer card grids use `gap-4` to `gap-6`.

## Radii

From [globals.css](src/app/globals.css):

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 10px | Inline pills, small badges |
| `--radius-md` | 14px | Inputs, dropdowns, small buttons |
| `--radius-lg` | 18px | Cards (`.card-warm`) |
| `--radius-xl` | 24px | Modals, hero panels |
| `--radius-full` | 9999px | Pill buttons, avatars, status dots |

> **Rule:** never mix radii on the same element family. A card containing an input uses `rounded-[18px]` outside and `rounded-[14px]` inside — the step is intentional.

## Elevation

Diffuse, low-contrast shadows tinted with the navy text color so they feel warm.

| Token | Value | Use |
|---|---|---|
| `--shadow-xs` | `0 1px 2px rgba(45,49,66,0.04)` | Default resting card |
| `--shadow-sm` | `0 2px 8px rgba(45,49,66,0.06)` | Card hover |
| `--shadow-md` | `0 4px 16px rgba(45,49,66,0.08)` | Sticky bars, popovers |
| `--shadow-lg` | `0 8px 32px rgba(45,49,66,0.10)` | Modals |
| `--shadow-mint` | `0 4px 14px rgba(51,178,156,0.20)` | Primary button rest/hover |

No pure-black shadows. No 2-stop dramatic shadows. Elevation is felt, not seen.

## Component patterns

### Card — `.card-warm`
The default container for everything browsable.
```html
<article class="card-warm p-5 space-y-4">…</article>
```
- White surface, 1px `--border`, 18px radius, `--shadow-xs`.
- On hover: lifts `translateY(-1px)`, border darkens to `--border-hover`, shadow steps to `--shadow-sm`.
- Transition: `0.25s cubic-bezier(0.4, 0, 0.2, 1)`.

### Pill button — `.pill-btn`
Compact action affordance used in dense action bars (agent responses, ticket rows).
```html
<button class="pill-btn bg-mint-500 text-white hover:bg-mint-600">…</button>
```
- `padding: 6px 14px`, `font-size: 13px`, `font-weight: 600`, fully rounded.
- Variants in the wild: mint (primary), warm-100 background (secondary/neutral), coral (destructive).

### Input — `.input-warm`
```html
<input class="input-warm" placeholder="Search…" />
```
- 1.5px border, 14px radius, `--bg` background that turns white on focus.
- Focus ring: 3px `--mint-glow` halo + `--mint` border (no outline).

### Badge / tag (inline)
Used for categories, status, term counts.
```html
<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium">…</span>
```
- 11px font, `rounded-md` (6px), tinted background that matches its meaning (`bg-mint-50 text-mint-700`, `bg-amber-50 text-amber-700`, etc.).

### Section eyebrow
```html
<p class="text-[10px] uppercase tracking-wide font-semibold text-warm-500">…</p>
```
Used inside cards to label sub-blocks ("Top mentions", "Customers", "Helpful resources").

### Modal
- Backdrop: `.glass-overlay` (`backdrop-filter: blur(12px)`, `rgba(45,49,66,0.25)`).
- Surface: white, `rounded-[24px]`, `--shadow-lg`.
- Click-outside is **disabled** on work-in-progress modals (e.g. Email Draft Composer) to prevent accidental data loss — closing requires the explicit X or Cancel button.

### Active states & live indicators
- **Active tab** — mint underline + `text-mint-700`; no pill background on tabs.
- **Live process** (sync, recording) — `.mint-pulse` outward glow on a small dot.
- **Empty state** — centered `font-display text-warm-500` line, no illustration unless the empty state is the destination of a primary action.

## Motion

Standard easing: `cubic-bezier(0.4, 0, 0.2, 1)`. Two reusable animations:

- `.fade-up` — 0.4s entry, 12px upward translate. Staggered children: `.fade-up-1` through `.fade-up-4` (50ms increments).
- `.mint-pulse` — 2s outward halo, infinite. Reserved for live/streaming indicators.

Every interactive element (`button`, `a`, `input`, `textarea`, `select`) inherits a global `transition: all 0.2s` from [globals.css:69-71](src/app/globals.css#L69-L71) — do not re-declare it on individual components.

## Iconography

Single source: **lucide-react**. Rules:
- Default `size={16}` inside body text, `size={14}` inside dense rows, `size={20}+` only in headers.
- Color matches the surrounding text color — pass `className="text-warm-400"` or `text-mint-600`, never `stroke` props.
- Pick icons by meaning, not novelty. `HelpCircle` for support, `Sparkles` for AI-generated content, `Tag` for categories, `CheckCircle2` for resolved.

## Accessibility

- **Focus ring** is global: `2px solid var(--mint)` with 2px offset, applied via `*:focus-visible` in [globals.css:74-78](src/app/globals.css#L74-L78). Do not suppress it.
- Body text on `--bg` (`#2D3142` on `#FAF9F6`) clears WCAG AA at 12.4:1. Secondary text (`--text-secondary` on `--bg`) clears AA for normal text at 5.3:1 — do not use `text-muted` (`#A0A5B2`) for anything below 14px.
- Mint on white is **3.4:1** — passes for large text and UI components, but **does not pass** for body text. Use `mint-700` (`#1e7a6d`, 6.1:1) for inline mint text in paragraphs.

## Anti-patterns

Things this design system does **not** do — calling these out so they stay out:

- **No gradients on UI chrome.** The `.mint-gradient` exists but is reserved for hero/branding moments (login, "What's new" header). Buttons and cards stay flat.
- **No pure black or pure white.** `text-warm-900` is the darkest text; `--card` is the only true white surface, and it sits on a tinted page background.
- **No icon-only buttons without tooltip or aria-label.** Compact action bars (stars, email, correct) include accessible labels even when the icon is obvious.
- **No competing accent colors.** If a new feature feels like it needs a second brand color, treat it as a category badge instead.
- **No drop shadows tinted with the accent.** `--shadow-mint` exists only for the primary CTA hover state.

## File map

- [tailwind.config.ts](tailwind.config.ts) — color scale, font family aliases.
- [src/app/globals.css](src/app/globals.css) — CSS variables, base styles, reusable utility classes (`.card-warm`, `.pill-btn`, `.input-warm`, `.glass-overlay`, `.mint-gradient`, `.pattern-warm`, `.fade-up`, `.mint-pulse`, agent markdown styles).
- [src/components/QACard.tsx](src/components/QACard.tsx), [src/components/IssueCard.tsx](src/components/IssueCard.tsx), [src/components/TermCard.tsx](src/components/TermCard.tsx) — canonical reference implementations of the card pattern.
- [src/components/EmailDraftModal.tsx](src/components/EmailDraftModal.tsx) — canonical modal pattern.
