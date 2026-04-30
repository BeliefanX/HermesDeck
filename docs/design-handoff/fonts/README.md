# Fonts

The product loads two families from Google Fonts CDN — there are no local binaries.

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;550;600;650;700&family=JetBrains+Mono:wght@400;500&display=swap');
```

- **Inter** — primary UI. Used weights: 400, 500, 550, 600, 650, 700. Loaded with `font-feature-settings: "cv01","cv03","ss03"` (alt-1, straight-leg-l, alt-curly-comma). The negative-tracking display sizes (H1 at -0.035em) lean on Inter's tall x-height.
- **JetBrains Mono** — code, kbd, IDs, timestamps, log output, anything tabular. Used weights: 400, 500. Always paired with `font-variant-numeric: tabular-nums`.

> **Substitution flag for the user.** No local TTF/WOFF files were provided. If you'd like the design system to ship with self-hosted webfonts (offline / privacy / FOUT-control), drop the `.woff2` files here and we'll wire `@font-face` declarations to point at them.

## Fallback stacks

Used in `globals.css`:

```
font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
font-family: 'JetBrains Mono', ui-monospace, monospace;
```
