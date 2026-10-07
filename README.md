# b0r3d DeRes (`img.b0r3d.org`)

A retro image toolkit for [b0r3d.org](https://b0r3d.org) that runs entirely in
your browser.

b0r3d DeRes turns a photo into what old hardware could show: real palettes,
real resolutions, the pixel shapes and dithering of the machines, and the
screens they were seen on. It also includes an authentic BBS-style ASCII/ANSI art
studio and a privacy-preserving byte-level EXIF metadata scrubber.

The app runs entirely in your browser: images are processed and exported on
your device, never uploaded, and the app loads nothing from any other site.
Like the rest of b0r3d.org, the site counts visits; that never includes your
images.

**Status:** v0.6.0, Analog, print & video aesthetics (VHS mode, early CCD noise, NTSC/composite bleed, newspaper halftone rosettes, two-ink risograph, streaky 1-bit fax, green/amber/white monochrome phosphor decay & bloom), is built. Not live yet.

---

## What it does (v0.3.0)

- **Open a picture** with the button, by dragging it onto the page, by pasting
  it (Ctrl+V / Cmd+V), or try the sample (Rukus). It's decoded once into a
  working copy no bigger than 2048 px on its long edge (big phone photos would
  otherwise break the page on iPhones), with the photo's rotation applied.
- **Hardware profiles**, not just palettes: each machine has its native
  resolution, the shape of its pixels on a TV, its colours, and the dither and
  screen that suit it. Picked from a grid of cards with swatch strips:
  - **Fixed palettes:** Game Boy, Game Boy Pocket, Game Boy Camera (with its edge boost and its own
    dither), CGA palettes 0 and 1, EGA, C64 hi-res, NES, PICO-8, Atari 2600,
    Apple II lo-res, Mac 1-bit, Web-safe 216, a thermal receipt printer and the
    b0r3d palette.
  - **Per-cell graphics modes & attribute clash:**
    - **ZX Spectrum:** 256×192 with 8×8 cell attribute clash (1 ink + 1 paper colour per cell, both normal or both bright).
    - **C64 Multicolour:** 160×200 wide pixels with 4×8 double-width cells (1 shared backdrop + 3 cell colours).
    - **NES attributes:** 256×240 with 16×16 attribute blocks (4 hardware sub-palettes of 3 colours + 1 shared backdrop).
    - **Apple II hi-res:** 280×192 with 7-pixel byte rule (high bit selecting Green/Violet vs Orange/Blue).
  - **Picked from a range (bit-grid snapped):** Master System (2 bits per channel, 32 colours),
    Genesis (3 bits per channel, 64 colours), SNES (5 bits per channel, 256 colours),
    PC-9801 (4 bits per channel, 16 colours), VGA 256 (6 bits per channel, 256 colours),
    and Custom N colours.
  - **Amiga HAM6 (Hold-And-Modify):** 320×200, 12-bit hardware colour (4096 colours), 16 base palette colours with horizontal channel hold-and-modify fringing across scanlines.
  - **Nintendo 64:** 320×240 at 16-bit colour (RGBA5551) with authentic RDP 3-point triangular sample filter and VI horizontal anti-aliasing blur.
  - **Direct color:** PlayStation (15-bit direct color with the GPU's hardware dither table).
- **"Would it fit?" hardware tile meter:** slices the processed image into 8×8 tiles, hashes unique patterns, computes unique tile counts and distinct colours, and checks against target machine VRAM/tile budgets (e.g. 256 tiles on NES/Game Boy).
- **Emulator file exports:**
  - **ZX Spectrum `.scr`:** exactly 6,912 bytes (6,144 bytes interleaved bitmap + 768 bytes attributes), ready to load directly in Spectrum emulators.
  - **C64 Koala Painter `.koa`:** exactly 10,003 bytes (load address `$6000`, 8,000 bytes bitmap, 1,000 screen RAM, 1,000 color RAM, 1 background byte).
  - **Game Boy `.chr`:** 2BPP planar tiles (16 bytes per 8×8 tile, deduplicated tile sheet).
- **Quantization & bit grids:** range and custom profiles use deterministic
  weighted median-cut quantization snapped to the machine's exact hardware bit depth.
- **Custom palette files:** import palettes from `.hex`, JASC `.pal`, GIMP `.gpl`,
  and palette PNG files, or download grabbed palettes as `.hex`.
- **Palette grabber:** pull the dominant N colours out of the current picture, apply them
  instantly to the session, and download the `.hex` file.
- **Share links:** encode all current settings into the URL hash (`#s=...`) and copy
  to clipboard with one click.
- **Resolution:** the machine's native size (crop to fill, fit with bars, or
  stretch), or a custom block size. Shrinking is an area average in linear
  light, so nothing aliases.
- **Adjust:** brightness, contrast, saturation and gamma before the colours are
  cut down.
- **Dither:** none, Bayer 2×2 / 4×4 / 8×8, Floyd–Steinberg (serpentine),
  Atkinson, Yliluoma (ordered dithering for uneven palettes), the PlayStation GPU's
  hardware dither table, and the Game Boy Camera's own. Error is carried in linear light;
  colours are matched in OKLab.
- **Screen effects** (preview, and optionally the export from 3× up): CRT with
  shadow mask or aperture grille, scanlines, curve and bloom; Game Boy LCD grid
  with ghosting. Nothing flickers.
- **Compare:** a draggable divider, or hold the picture (or Space) to see the
  original. A readout shows e.g. "14 of 16 colours used · 320×200 · 5:6 pixels · 217 / 256 tiles (fits in VRAM)".
- **Export:** a PNG enlarged by a whole number (1× to 16×, sizes past about 16
  megapixels are greyed out) so every pixel stays a sharp block. Raw pixels or
  stretched to the machine's pixel shape ("as on a TV"). Without screen effects
  it's an indexed PNG holding the machine's exact palette (or RGB for > 256 colors).
  Named like `photo-nes-256x240-4x.png`. Nothing but the picture is written into it.
- **ASCII / ANSI Studio (v0.4.0):**
  - **Half-block color mode (`▀`):** doubles vertical resolution for authentic 24-bit RGB and 16-color ANSI BBS art scenes.
  - **Character ramps:** Standard (` .:-=+*#%@`), Detailed, Block shades (` ░▒▓█`), Katakana (half-width), Binary, and custom text inputs, with 2:1 cell aspect ratio correction.
  - **Colour profiles:** Vintage 16-color ANSI (CGA/PC text mode), Green CRT phosphor, Amber CRT phosphor, Monochrome, and RGB Truecolor.
  - **Clipboard copy:** one-click copy as raw text, GitHub Markdown, terminal ANSI escape codes, or formatted HTML `<pre>`.
  - **BBS `.ans` export:** native CP437 bytes with DOS ANSI escape sequences and 128-byte SAUCE metadata record (title, author `still_b0r3d`, group `b0r3d.org`, date, dimensions).
  - **Rendered PNG export:** crisp 1×, 2×, 4× image export rendered with the bundled CP437 font.
- **EXIF Scrubber (v0.5.0):**
  - **Byte-level stripping (no canvas re-encoding):** pixel streams remain bit-identical with zero generational quality loss, preserving Display P3 and sRGB ICC profiles.
  - **JPEG stripping:** strips APP1 (Exif, XMP), APP13 (Photoshop IRB / IPTC), COM, and APP2 MPF while preserving JFIF, Adobe APP14, and decoding tables.
  - **Trailing data removal:** truncates data following JPEG `FF D9` (EOI) and PNG `IEND` to eliminate Google Pixel Motion Photo MP4 videos, Samsung camera trailers, and gain maps.
  - **Orientation preservation:** writes back a clean, minimal 36-byte APP1 segment holding only the orientation tag (if orientation > 1), preventing vertical phone photos from rendering rotated in viewers.
  - **PNG & WebP stripping:** drops PNG `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`; strips WebP `EXIF` and `XMP ` chunks, clears VP8X flags, and updates RIFF lengths.
  - **Metadata inspector & narrative:** displays camera make/model, lens, timestamps, shutter speed, aperture, ISO, and a plain-English narrative summary.
  - **GPS coordinate callout:** displays coordinates as DMS and decimal with 1-click copy; loads zero external maps or tile APIs (zero phone-home rule).
  - **Uncropped-thumbnail warning:** detects embedded IFD1 thumbnails, renders a preview, and warns users when thumbnails contain uncropped original photos.
  - **Automated privacy self-check:** re-parses the scrubbed output buffer with the metadata inspector to verify zero GPS coordinates, zero camera tags, and confirms preserved color profiles and orientation.
- **Analog, print & video aesthetics (v0.6.0):**
  - **VHS Tape (`vhs`):** 320×240 analog magnetic tape with bottom tracking scanline jitter band, head switching noise, horizontal chroma smear (~0.4 MHz color carrier limitation), and green/white `PLAY ▶` + timestamp OSD in the corner.
  - **Early CCD Camera (`ccd-early`):** 640×480 sensor mode, CCD sensor noise (photon shot noise + thermal chroma grain), and burnt-orange 7-segment digital date stamp (`'99 10 24`) in bottom right.
  - **NTSC Composite chroma bleed (`composite`):** Horizontal YIQ color subcarrier cross-talk, phase ringing, and color fringing on sharp vertical transitions.
  - **JPEG Deep Fry (`deepfry`):** 8×8 block Discrete Cosine Transform (DCT) quantization crunch, high-frequency edge ringing (Gibbs phenomenon), and extreme contrast & saturation boost.
  - **Newspaper Halftone Rosettes (`newspaper`):** CMYK angled screen dot rosettes (Cyan 15°, Magenta 75°, Yellow 0°, Black 45°) over unbleached newsprint paper.
  - **Two-Ink Risograph (`risograph`):** Dual spot-color ink layering (Fluorescent Pink `#ff48b0` + Teal `#00838a`) with halftone screening and mechanical drum misregistration jitter.
  - **Streaky 1-Bit Fax (`fax`):** High-contrast 1-bit thermal print with dirty roller vertical streaks, scanline dropouts, and transmission header (`FROM: B0R3D FAX G3...`).
  - **Monochrome phosphor decay & bloom:** P1 Green (525nm peak), P3 Amber (600nm peak), and P4 White CRT phosphor spectral emission, beam scanlines, and decay bloom.
- Settings are remembered on your device. The picture never is.

## Planned

- **v0.7.0, Extended hardware & handhelds:** Nokia 3310, Game Boy Color, Virtual Boy, Atari ST, Amstrad CPC, MSX.
- **v0.8.0, BBS heritage & Teletext:** PETSCII studio, Teletext/Ceefax mosaics, dial-up baud playback.
- **v0.9.0, Motion, sound & polish:** Animated PNG/GIF export, tactile UI sounds, full test verification.
- 1.0.0 is when all three tools are complete and ready for public launch.

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
| Master System | 64-colour range (2 bits per channel), 32 on screen |
| Genesis | 512-colour range (3 bits per channel), 64 on screen |
| SNES | 32,768-colour range (5 bits per channel), 256 on screen |
| PC-9801 | 4,096-colour range (4 bits per channel), 16 on screen |
| VGA 256 | 262,144-colour range (6 bits per channel), 256 on screen |
| PlayStation | 15-bit direct colour (5 bits per channel) with GPU dither table |
| ZX Spectrum | Sinclair 15-colour palette (8 normal, 7 bright duplicates merged) |
| C64 multicolour | The Colodore palette (double-width 2:1 pixels) |
| NES attributes | NES palette with 4 hardware sub-palettes of 3 colours + 1 shared backdrop |
| Apple II hi-res | 6 NTSC artifact colours (Black, White, Green, Violet, Orange, Blue) |
| Amiga HAM6 | 12-bit hardware colour (4096 colours) with 16 base palette colours |
| Nintendo 64 | 15-bit color (RGBA5551) with RDP 3-point sample filter and VI blur |
| Custom | User-defined palette file or quantized from picture |

## Credits

All the code here is written for this project; nothing is bundled from
elsewhere. The methods come from:

- OKLab, by Björn Ottosson.
- Ordered dithering for arbitrary palettes, by Joel Yliluoma ("algorithm 2").
- Floyd–Steinberg (1976), Bill Atkinson's dither from the original Macintosh,
  and Bayer's ordered dithering (1973).
- PlayStation GPU hardware dither matrix.
- ZX Spectrum memory interleaving layout and C64 Koala Painter specification.
- Includes Px437 IBM VGA 8x16 font from The Ultimate Oldschool PC Font Pack by VileR, licensed under CC BY-SA 4.0.
- SAUCE (Standard Architecture for Universal Comment Extentions) v00 specification.

---

## Versioning

Versions look like `0.1.0`: the second number goes up for each new stage or
feature release, the third for fixes and small changes (`0.1.1`). `1.0.0` is
when all three tools are out. The version lives in `package.json` and is bumped
for every release that goes live, with a row added below. The footer shows the
version and the build (the commit it was built from).

| Version | Date | Notes |
|---------|------|-------|
| 0.6.0 | 2026-10-07 | Analog, print & video aesthetics: VHS mode (tracking jitter, head noise, chroma smear, PLAY ▶ OSD), early CCD (640×480, noise, date stamp), NTSC composite bleed, JPEG deep fry DCT crunch, newspaper halftone rosettes, two-ink risograph, streaky 1-bit fax, monochrome P1/P3/P4 phosphors. |
| 0.5.0 | 2026-10-07 | EXIF Scrubber: byte-level stripping (JPEG, PNG, WebP), minimal orientation preservation, GPS coordinates inspector & copy, uncropped-thumbnail warning, trailing data removal, automated privacy self-check. |
| 0.4.0 | 2026-10-07 | ASCII / ANSI studio: half-block color mode, character ramps, ANSI 16/phosphor/RGB profiles, .ans export with SAUCE record, clipboard copy (text/MD/ANSI/HTML), CP437 font-rendered PNG export. |
| 0.3.0 | 2026-10-07 | Per-cell modes (Spectrum clash, C64 MC, NES attributes, Apple II hi-res), Amiga HAM6, N64 blur, tile meter and emulator export (.scr, .koa, .chr). |
| 0.2.0 | 2026-10-07 | Range profiles (SNES, Genesis, Master System, PC-98, VGA 256, custom), PS1 hardware dither, palette files (.hex, .pal, .gpl, PNG), palette grabber, settings share link. |
| 0.1.0 | 2026-10-07 | DeRes core: 15 fixed-palette profiles, worker pipeline, 8 dithers, pre-filters, screen effects, compare divider, integer export. |

---

## License

MIT, see [LICENSE](LICENSE). Use it, change it, host your own copy. Keep the
copyright line and license text in your copy; a link back to
[img.b0r3d.org](https://img.b0r3d.org) is appreciated.
