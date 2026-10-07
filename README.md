# b0r3d DeRes (`img.b0r3d.org`)

A retro image toolkit for [b0r3d.org](https://b0r3d.org) that runs entirely in
your browser.

b0r3d DeRes turns a photo into what old hardware could show: real palettes,
real resolutions, the pixel shapes and dithering of the machines, and the
screens they were seen on. Later it will also make BBS-style ASCII/ANSI art and
strip location and camera details out of photos.

The app runs entirely in your browser: images are processed and exported on
your device, never uploaded, and the app loads nothing from any other site.
Like the rest of b0r3d.org, the site counts visits; that never includes your
images.

**Status:** v0.1.0, the DeRes core, is built. Not live yet.

---

## What it does (v0.1.0)

- **Open a picture** with the button, by dragging it onto the page, by pasting
  it (Ctrl+V / Cmd+V), or try the sample (Rukus). It's decoded once into a
  working copy no bigger than 2048 px on its long edge (big phone photos would
  otherwise break the page on iPhones), with the photo's rotation applied.
- **Hardware profiles**, not just palettes: each machine has its native
  resolution, the shape of its pixels on a TV, its colours, and the dither and
  screen that suit it. Picked from a grid of cards with swatch strips:
  Game Boy, Game Boy Pocket, Game Boy Camera (with its edge boost and its own
  dither), CGA palettes 0 and 1, EGA, C64 hi-res, NES, PICO-8, Atari 2600,
  Apple II lo-res, Mac 1-bit, Web-safe 216, a thermal receipt printer and the
  b0r3d palette.
- **Resolution:** the machine's native size (crop to fill, fit with bars, or
  stretch), or a custom block size. Shrinking is an area average in linear
  light, so nothing aliases.
- **Adjust:** brightness, contrast, saturation and gamma before the colours are
  cut down.
- **Dither:** none, Bayer 2×2 / 4×4 / 8×8, Floyd–Steinberg (serpentine),
  Atkinson, Yliluoma (ordered dithering for uneven palettes) and the Game Boy
  Camera's own. Error is carried in linear light; colours are matched in
  OKLab.
- **Screen effects** (preview, and optionally the export from 3× up): CRT with
  shadow mask or aperture grille, scanlines, curve and bloom; Game Boy LCD grid
  with ghosting. Nothing flickers.
- **Compare:** a draggable divider, or hold the picture (or Space) to see the
  original. A readout shows e.g. "14 of 16 colours used · 320×200 · 5:6 pixels".
- **Export:** a PNG enlarged by a whole number (1× to 16×, sizes past about 16
  megapixels are greyed out) so every pixel stays a sharp block. Raw pixels or
  stretched to the machine's pixel shape ("as on a TV"). Without screen effects
  it's an indexed PNG holding the machine's exact palette. Named like
  `photo-nes-256x240-4x.png`. Nothing but the picture is written into it.
- Settings are remembered on your device. The picture never is.

## Planned

- **v0.2.0:** machines whose colours are picked from a bigger range (Master
  System, Genesis, SNES, PC-98, VGA 256, custom N colours), the PS1's dither
  table, palette files (.hex, JASC .pal, .gpl, palette PNG), a palette grabber,
  a share link that holds the settings.
- **v0.3.0:** per-cell colour limits (ZX Spectrum, C64 multicolour, NES
  attributes, Apple II hi-res), N64, Amiga HAM6, a "would it fit?" meter, files
  that load in emulators (Spectrum .scr, C64 Koala, Game Boy tiles).
- **v0.4.0, ASCII / ANSI studio:** character ramps, colour profiles, 80/132/160
  columns, half-block colour, `.ans` with SAUCE, copy as ANSI / HTML /
  Markdown, PNG in a bundled CP437 font.
- **v0.5.0, EXIF scrubber:** see what a photo gives away (location, camera,
  dates) and remove it at the byte level, without re-encoding the picture.
- Then more machines, looks and screen effects. 1.0.0 is when all three tools
  are out.

---

## Development

Node 22 and pnpm 10 (pinned in `package.json`).

```bash
pnpm install
pnpm dev               # the app, with live reload
pnpm check             # typecheck + lint + unit tests; run before every commit
pnpm test:e2e          # end-to-end in Chromium, Firefox and WebKit
pnpm build             # the site, in dist/
pnpm verify:site       # whole-site check of dist/ (or pass the live URL)
```

`test:e2e` and `verify:site` need Playwright's browsers
(`pnpm exec playwright install`).

How it fits together:

- `src/core/`: the image engine, as plain functions with unit tests next to
  them. Colour maths (`color.ts`), palette matching with its cache
  (`matcher.ts`), dithering (`dither.ts`, `bayer.ts`, `yliluoma.ts`), resizing
  (`resample.ts`), framing (`geometry.ts`), pre-filters (`adjust.ts`), screen
  effects (`fx.ts`), PNG (`png.ts`, no library: the browser's own
  CompressionStream), the machines (`profiles.ts`) and the pipeline that ties
  them together (`pipeline.ts`, `export.ts`).
- `src/worker/`: the image worker. It keeps the working copy, so moving a
  slider only sends settings. One job runs at a time and the newest settings
  win.
- `src/ui/`: the page (no framework).
- `public/_headers` and `public/404.html`: the response headers and the real
  404 page (the reasons are in `_headers`). The Content-Security-Policy is a
  `<meta>` tag built in `vite.config.ts`.

## Where the colours come from

Most of these machines put out analogue video, so there is no official RGB for
their colours and every emulator's numbers differ a little.

| Machine | Colours |
|---|---|
| Game Boy | The BGB emulator's default greens |
| Game Boy Pocket | A common approximation of the Pocket's screen |
| Game Boy Camera | Four even greys, as its photos print |
| CGA, EGA | The standard RGBI values (steps of 0x55, with the EGA's brown) |
| C64 | The Colodore palette |
| NES | A widely used emulator palette (the 64 entries, repeated blacks merged: 55 colours) |
| PICO-8 | The official palette |
| Atari 2600 | A common NTSC emulator palette (16 hues × 8 brightness steps) |
| Apple II lo-res | Common NTSC values (lo-res colours 5 and 10 are the same grey) |
| Mac 1-bit | Black and white |
| Web-safe 216 | The 6×6×6 cube of 00, 33, 66, 99, CC, FF |
| Receipt printer | Ink and paper |
| b0r3d | The site's near-black, cyan, magenta and mint |

## Credits

All the code here is written for this project; nothing is bundled from
elsewhere. The methods come from:

- OKLab, by Björn Ottosson.
- Ordered dithering for arbitrary palettes, by Joel Yliluoma ("algorithm 2").
- Floyd–Steinberg (1976), Bill Atkinson's dither from the original Macintosh,
  and Bayer's ordered dithering (1973).

---

## Versioning

Versions look like `0.1.0`: the second number goes up for each new stage or
feature release, the third for fixes and small changes (`0.1.1`). `1.0.0` is
when all three tools are out. The version lives in `package.json` and is bumped
for every release that goes live, with a row added below. The footer shows the
version and the build (the commit it was built from).

| Version | Date | Notes |
|---------|------|-------|

---

## License

MIT, see [LICENSE](LICENSE). Use it, change it, host your own copy. Keep the
copyright line and license text in your copy; a link back to
[img.b0r3d.org](https://img.b0r3d.org) is appreciated.
