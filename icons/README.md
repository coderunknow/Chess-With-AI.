# Icons

Toolbar, management-page and store artwork for AI Chess Companion.

| File | Size | Used for |
| --- | --- | --- |
| `icon16.png` | 16×16 | toolbar button (`action.default_icon`) |
| `icon48.png` | 48×48 | extension management page (`icons`) |
| `icon128.png` | 128×128 | Chrome Web Store listing and installation dialog |

All three are referenced from `manifest.json` and are checked by `npm run check:manifest`.

## Design

- Dark tile (`#101317`) matching the side-panel background
- White knight with a soft blue glow (`#71b7ff`) and a few sparkles for the "AI" cue
- No text: it must stay legible at 16 px, where the silhouette carries the whole icon

## Regenerating

The icons are downsampled from a 1024×1024 master with ImageMagick:

```bash
# master.png = 1024x1024 source artwork
convert master.png -gravity center -crop 200x200+0+0 +repage -resize 16x16  -filter Lanczos -unsharp 0x1+0.9+0.03 -strip PNG32:icon16.png
convert master.png -gravity center -crop 220x220+0+0 +repage -resize 48x48  -filter Lanczos -unsharp 0x1+0.7+0.03 -strip PNG32:icon48.png
convert master.png -gravity center -crop 220x220+0+0 +repage -resize 128x128 -filter Lanczos -unsharp 0x1+0.5+0.02 -strip PNG32:icon128.png
```

The crops zoom in on the knight so the glyph still reads at 16 px; the unsharp pass keeps the downsample from
turning into mush. Keep replacements MIT-compatible and remember the PNGs are binary (see `.gitattributes`).
