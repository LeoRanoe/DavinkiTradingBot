# Brand assets

`davinki-mark.svg` is a **placeholder** - a simple vector approximation of the
Davinki "D" mark (uses `currentColor`, so it inherits text color and works in
both themes). It is not the real logo file.

To use the real Davinki Trading logo, replace it with the actual asset:

- `public/brand/davinki-mark.svg` — the "D" mark alone, square, transparent
  background. Used at small sizes (sidebar, favicon), so keep it simple at
  16-32px. SVG preferred; a transparent PNG at `davinki-mark.png` works too
  (update the `src` in `components/dashboard/brand-mark.tsx` accordingly).
- `public/brand/davinki-wordmark.svg` (optional) — full lockup (mark +
  "Davinki Trading" text), for surfaces with more room, like the login
  screen. Not required: the app currently sets the wordmark as text next to
  `davinki-mark.svg`, which reads correctly with the placeholder and with a
  transparent-background real mark.

After adding the real file(s), also regenerate `app/favicon.ico` from the
mark (a 32x32/48x48 ICO) so the browser tab matches.

No other code changes are needed - `components/dashboard/brand-mark.tsx` and
the login page already reference these paths.
