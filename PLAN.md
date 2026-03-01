# Implementation Plan — Email List + Detail View Interaction Updates

## Checklist

- [x] **1. Date formatting** — `formatTimestamp()` now returns absolute date+time (e.g. `Feb 28, 3:45 PM`), omits year in current year, includes year otherwise. Fallback `—` for missing timestamp.
- [x] **2. Left panel action repositioning** — Reply/Read/Summary moved to bottom row (left), date moved to bottom row (right). Actions restyled as pill buttons with borders, hover states, focus rings, and ARIA labels.
- [x] **3. Email detail full content** — Detail view renders full `email.preview` with `whitespace-pre-wrap`, no truncation. Falls back to `'No content available.'` if empty.
- [x] **4. Detail view actions row** — Reply, Read, Summary buttons added as an action row between the email metadata and the body, above the content. Consistent styling with hover/focus states and ARIA labels.
- [x] **5. Intent suggestions toggle chips** — Replaced Yes/No button pairs with single-click toggle chips. Selected = blue filled, unselected = gray outline. `toggleIntent` simplified to single-arg toggle. `selectedIntentsList` in submit only emits selected items (`accepted: true`).
- [x] **6. Paragraph buttons outside frame** — Rewrite and Delete buttons moved outside the paragraph border into a `flex justify-end` row below each paragraph. Applied to both Format B (`renderParagraphs`) and Format A (legacy). `DeleteButton` wrapped in `relative` div so its absolute dropdown still anchors correctly.
- [x] **7. Regenerate paragraph spacing** — Paragraph list containers changed from `space-y-3` to `space-y-5`. Paragraph content uses `whitespace-pre-wrap` to preserve line breaks in both normal and rewriting states.
- [x] **8. Confirm & Send green** — Button color changed from `bg-gray-900 hover:bg-gray-700` to `bg-green-600 hover:bg-green-700` in both Format B and Format A. Disabled state retains `opacity-50`.

---


Based on `PDR.txt`. All changes are in `packages/web/src/pages/ReviewPage.tsx` (Format B two-column layout) unless noted otherwise.

---

## 1. Date Formatting (PDR §5.4)

**Current**: `formatTimestamp()` shows relative time ("2h ago", "3d ago").

**Change**: Replace with absolute date+time. Omit year if current year.

```
Current year:  Feb 28, 3:45 PM
Other year:    Feb 28, 2025, 3:45 PM
```

**Where**: Update the `formatTimestamp()` function (~line 84). Used in both left-panel preview items and email detail view.

---

## 2. Left Panel — Reposition Actions & Date (PDR §5.3)

**Current**: Reply/Read/Summary actions are inline in the top row next to sender name, date is at the bottom.

**Change**:
- Move Reply / Read / Summary to a **bottom row, aligned left**
- Move date/time to the **bottom row, aligned right**
- Style actions as pill buttons or outlined links with clear hover/focus states (not just faint text)

**Layout target**:
```
┌─────────────────────────┐
│ [Category] Sender Name  │
│ Subject line            │
│ Preview snippet...      │
│ Reply  Read  Summary  Feb 28 │
└─────────────────────────┘
```

**Where**: Left panel `visibleEmails.map(...)` block (~lines 380-425).

---

## 3. Email Click → Full Content Display (PDR §5.1)

**Current**: Email detail view (`rightView === 'email'`) shows subject, from, timestamp, and `email.preview` in a single `<p>` tag. Content may be truncated.

**Change**:
- Render full email body with `whitespace-pre-wrap` (already present)
- Ensure no `line-clamp` or `truncate` is applied in detail view
- Add scrollable container if content is long (the right panel already has `overflow-y-auto`, so this should work)
- Handle missing content gracefully (show fallback text)

**Where**: `rightView === 'email'` block (~lines 487-523).

---

## 4. Detail View Actions: Reply + Read + Summary (PDR §5.2)

**Current**: Detail view has a "Back" breadcrumb and a single "Reply" button at the bottom.

**Change**:
- Add an action row at the top of the detail view (below breadcrumb, above body)
- Include Reply, Read, and Summary as consistent pill/outlined buttons
- Buttons should have hover/focus states and keyboard accessibility

**Where**: `rightView === 'email'` block (~lines 487-523). Add action buttons between the header metadata and the email body.

---

## 5. Intent Suggestions — Click-to-Toggle Chips (PDR §5.6)

**Current**: Each intent has Yes/No buttons. Selection state uses `true`/`false` values. Three visual states: neutral, accepted (green), rejected (red).

**Change**:
- Replace Yes/No with a **single clickable chip per suggestion**
- Click toggles between selected (highlighted, e.g. blue/green fill) and unselected (gray outline)
- Multi-select by default (click toggles independently)
- Store as `Record<string, boolean>` — key present + true = selected, absent = unselected

**Where**: Intent suggestions section (~lines 568-613). Remove the Yes/No button pair, make the entire suggestion row clickable.

---

## 6. Per-Paragraph Rewrite/Delete Buttons Outside Frame (PDR §5.7)

**Current**: Rewrite and Delete buttons appear **inside** the paragraph container, shown on hover via `group-hover:opacity-100`.

**Change**:
- Move Rewrite and Delete **outside** the paragraph border/background
- Render as a small toolbar row below or to the right of the paragraph container
- Paragraph content area stays visually clean (no overlay buttons)

**Layout target**:
```
┌──────────────────────────────┐
│ Paragraph text here...       │
└──────────────────────────────┘
                    Rewrite  Delete
```

**Where**: `renderParagraphs()` function (~lines 317-371) and the Format A equivalent (~lines 666-719). Both need the same change.

---

## 7. Regenerate Paragraph Spacing (PDR §5.5)

**Current**: Paragraphs rendered with `space-y-3` gap between cards. Content inside each card uses `leading-relaxed`.

**Change**:
- Ensure paragraph spacing is visually clear (current `space-y-3` is 12px — may increase to `space-y-4` or `space-y-5`)
- If regenerated content contains `\n\n` within a single paragraph, split or render with `whitespace-pre-wrap` so line breaks are preserved
- Verify copy/paste preserves paragraph breaks

**Where**: Paragraph list containers (~line 544 Format B, ~line 665 Format A). Also check if `whitespace-pre-wrap` is needed on paragraph `<p>` tags.

---

## 8. Confirm & Send Button — Green (PDR §5.8)

**Current**: `bg-gray-900 text-white` (dark/black button).

**Change**:
- Normal state: `bg-green-600 text-white hover:bg-green-700`
- Disabled state: `bg-green-300 text-white cursor-not-allowed` (or `opacity-50`)
- Apply to both Format B (~line 620) and Format A (~line 732)

---

## Summary of Files Changed

| File | Changes |
|------|---------|
| `packages/web/src/pages/ReviewPage.tsx` | All 8 items above |

No backend changes required. No new files needed.

## Implementation Order

1. **Date formatting** (§1) — isolated utility function, no layout risk
2. **Confirm & Send green** (§8) — one-line class change
3. **Left panel action repositioning** (§2) — layout restructure of preview items
4. **Email detail full content + actions** (§3, §4) — detail view changes
5. **Intent suggestions toggle** (§5) — interaction pattern change
6. **Paragraph buttons outside frame** (§6) — affects both Format A and B
7. **Regenerate spacing** (§7) — spacing/whitespace tuning, verify last
