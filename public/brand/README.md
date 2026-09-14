# Brand assets

The real Davinki Trading logo, as supplied by the owner
(`image-1789384560347.png` in the repo root, commit `abcb0b5`).

- `davinki-mark.png` — the "D" icon alone, cropped pixel-for-pixel from the
  source file (no redrawing), transparent background, white artwork.
  Used at small sizes: sidebar, login is the wordmark instead (see below).
- `davinki-wordmark.png` — the full lockup (icon + "Davinki" + "TRADING"),
  also cropped directly from the source, used on the login screen where
  there's room for it.
- `app/favicon.ico` — generated from `davinki-mark.png` composited onto a
  small dark circular backdrop (the artwork itself is untouched; the
  backdrop only exists so the icon stays legible in a light browser tab
  bar, the same convention the placeholder favicon it replaced used).

Both PNGs are white-on-transparent. `components/dashboard/brand-mark.tsx`
and `app/login/page.tsx` apply `invert dark:invert-0` so the mark still
reads correctly against the light theme's white background - that's a
CSS filter on screen, the files on disk are never modified.

If the owner supplies a different/updated logo later, replace
`davinki-mark.png` and `davinki-wordmark.png` with the new crops (or drop
in an SVG and update the `src` in `brand-mark.tsx` and `login/page.tsx`
accordingly) and regenerate `app/favicon.ico` from the new mark.
