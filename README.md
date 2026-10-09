# b0r3d DeRes (`img.b0r3d.org`)

A retro image toolkit for [b0r3d.org](https://b0r3d.org) that runs entirely in
your browser.

b0r3d DeRes turns a photo into what old hardware could show: real palettes,
real resolutions, the pixel shapes and dithering of the machines, and the
screens they were seen on. It also includes an authentic BBS-style ASCII/ANSI art
studio, a privacy-preserving byte-level EXIF metadata scrubber, and an EXIF
injector that edits a photo's metadata without touching its pixels.

The app runs entirely in your browser: images are processed and exported on
your device, never uploaded, and the app loads nothing from any other site.
Like the rest of b0r3d.org, the site counts visits; that never includes your
images.

**Status:** v0.8.5 is live at [img.b0r3d.org](https://img.b0r3d.org).

---

## What it does (v0.8.5)

- **Open a picture** with the button, by dragging it onto the page, by pasting
  it (Ctrl+V / Cmd+V), or try the sample (Rukus, who carries made-up,
  site-themed EXIF, a thumbnail and a colour profile so every tool has
  something to show). It's decoded once into a
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
    - **NES attributes:** 256×240 with 16×16 attribute blocks (4 sub-palettes of 3 colours, chosen from the picture, + 1 shared backdrop).
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
  - **Game Boy `.chr`:** 2BPP planar tiles (16 bytes per 8×8 tile, each distinct tile once), colour 0 the lightest as on the hardware.
  - **NES `.chr`** (NES attributes only): CHR tiles, 8 bytes of plane 0 then 8 of plane 1 per tile, each pixel's number inside its block's sub-palette. The plain NES look has no .chr because it uses any colour anywhere.
  - With "fit" bars, the files hold the bars too, so they match the preview.
- **Quantization & bit grids:** range and custom profiles use deterministic
  weighted median-cut quantization snapped to the machine's exact hardware bit depth.
  Each machine gets its own number of colours; the slider can ask for fewer, never more.
- **Custom palette files:** import palettes from `.hex`, JASC `.pal`, GIMP `.gpl`,
  and palette PNG files, or download grabbed palettes as `.hex`.
- **Palette grabber:** pull the dominant N colours out of the current picture, switch to
  the Custom machine with them, and download the `.hex` file. Grabbed and loaded palettes
  only ever apply to Custom.
- **Share links:** encode all current settings into the URL hash (`#s=...`) and copy
  to clipboard with one click. Opening one checks every value like saved settings, so a
  link from another version falls back instead of breaking the page.
- **Resolution:** the machine's native size (crop to fill, fit with bars, or
  stretch), or a custom block size. Shrinking is an area average in linear
  light, so nothing aliases.
- **Adjust:** brightness, contrast, saturation and gamma before the colours are
  cut down.
- **Dither:** none, Bayer 2×2 / 4×4 / 8×8, Floyd–Steinberg (serpentine),
  Atkinson, Yliluoma (ordered dithering for uneven palettes), the PlayStation GPU's
  hardware dither table, and the Game Boy Camera's own. Error is carried in linear light;
  colours are matched in OKLab. Dithers that change nothing on a machine are greyed out with
  a note (the cell machines choose their colours cell by cell; the PlayStation only has its
  own table).
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
  Animations (below) hold every frame at once, so they stop at 1024×1024.
- **ASCII / ANSI Studio (v0.4.0):**
  - **Half-block color mode (`▀`):** doubles vertical resolution for authentic 24-bit RGB and 16-color ANSI BBS art scenes.
  - **Character ramps:** Standard (` .:-=+*#%@`), Detailed, Block shades (` ░▒▓█`), Katakana (half-width), Binary, and custom text inputs, with 2:1 cell aspect ratio correction.
  - **Colour profiles:** Vintage 16-color ANSI (CGA/PC text mode), Green CRT phosphor, Amber CRT phosphor, Monochrome, and RGB Truecolor.
  - **Clipboard copy:** one-click copy as raw text, GitHub Markdown, terminal ANSI escape codes, or formatted HTML `<pre>`.
  - **BBS `.ans` export:** native CP437 bytes with DOS ANSI escape sequences and 128-byte SAUCE metadata record (title, group `b0r3d.org`, date, dimensions; the author is left blank for the artist).
  - **Rendered PNG export:** crisp 1×, 2×, 4× image export rendered with the bundled CP437 font.
- **EXIF Scrubber (v0.5.0):**
  - **Byte-level stripping (no canvas re-encoding):** pixel streams remain bit-identical with zero generational quality loss, and the colour profile is kept.
  - **JPEG stripping:** strips APP1 (Exif, XMP), APP13 (Photoshop IRB / IPTC), COM, and APP2 MPF while preserving JFIF, Adobe APP14, and decoding tables, including metadata tucked between a progressive JPEG's scans.
  - **Trailing data removal:** truncates data following JPEG `FF D9` (EOI), PNG `IEND` and a WebP's RIFF end, to eliminate Google Pixel Motion Photo MP4 videos, Samsung camera trailers, and gain maps.
  - **Orientation preservation:** writes back a clean, minimal 36-byte APP1 segment holding only the orientation tag (if orientation > 1), at the start of the file (after JFIF if there is one) where viewers look for it, so upright phone photos stay upright. WebP gets none: browsers ignore a WebP's orientation tag.
  - **PNG & WebP stripping:** drops PNG `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME` and `caBX` (Content Credentials); strips WebP `EXIF`, `XMP ` and `C2PA` chunks, clears VP8X flags, and updates RIFF lengths.
  - **HEIC and AVIF:** inspect only (the metadata is shown even when the browser can't display the picture); convert to JPEG or WebP to scrub.
  - **Metadata inspector & narrative:** displays camera make/model, lens, timestamps, shutter speed, aperture, ISO, and a plain-English narrative summary.
  - **All Tags list:** every tag in the file (IFD0, Exif, GPS, Interop, the thumbnail's IFD1, XMP, PNG text, Content Credentials) with its full value: coordinates in degrees, minutes and seconds, versions, Windows XP text, UserComment, signed values, and a byte count for maker notes. A filter finds tags by name, number or value. (Shown in the EXIF Injector too.)
  - **AI markers:** says when a file declares it was made or edited with AI: the IPTC digital source type (in XMP, including a PNG's), Content Credentials that say so, Stable Diffusion / ComfyUI settings, Midjourney prompts, DALL-E's name. Content Credentials on their own are shown as a neutral note with the app or device that wrote them, since cameras, phones and editors add them too; their signature isn't checked. No marker never proves a person made a picture, and pixel watermarks like SynthID can't be read here.
  - **GPS coordinate callout:** displays coordinates as DMS and decimal with 1-click copy; loads zero external maps or tile APIs (zero phone-home rule).
  - **Uncropped-thumbnail warning:** detects embedded IFD1 thumbnails, renders a preview, and warns that a thumbnail may show the uncropped original.
  - **Automated privacy self-check:** re-parses the scrubbed output buffer with the metadata inspector. The "Verified Clean" badge (and each batch row's "Cleaned") only shows when no GPS or camera metadata is left; otherwise it says what is.
- **EXIF Injector (v0.8.5):**
  - **Edits, doesn't replace:** the form starts with what the photo has; only the fields you change are written, an emptied field removes its tag, and every other tag (exposure details, serial numbers, the maker's own data, the thumbnail) stays as it was, in the photo's own byte order. A maker note stays at the same place in the block when it can, since some makers point inside it from the block's start.
  - **Fields:** camera make and model, lens, artist, copyright, software, orientation, aperture, shutter speed, ISO, focal length, date and time, description, and GPS latitude, longitude and altitude, with presets (b0r3d Defaults, three places) and a Now button.
  - **Checked before writing:** a shutter speed, ISO, coordinate or date that isn't real is refused with a message on that field. A changed date also drops the old time zone and GPS clock; a changed f-number, shutter speed, ISO or focal length drops the copies worked out from it; a new location replaces all the GPS tags.
  - **XMP:** when the photo also has an XMP block with its own copy of the location, date or camera, a ticked box offers to remove it so it can't contradict the new EXIF.
  - **JPEG and PNG**, written byte by byte (no re-encoding; anything after the picture is left as it is). Other formats are named up front as read-only. The saved file becomes the photo the Scrubber shows, in a batch too.
  - **VHS Tape (`vhs`):** 320×240 analog magnetic tape with bottom tracking scanline jitter band, head switching noise, horizontal chroma smear (~0.4 MHz color carrier limitation), and green/white `PLAY ▶` + timestamp OSD in the corner.
  - **Early CCD Camera (`ccd-early`):** 640×480 sensor mode, CCD sensor noise (photon shot noise + thermal chroma grain), and burnt-orange 7-segment digital date stamp (`'99 10 24`) in bottom right.
  - **NTSC Composite chroma bleed (`composite`):** Horizontal YIQ color subcarrier cross-talk, phase ringing, and color fringing on sharp vertical transitions.
  - **JPEG Deep Fry (`deepfry`):** 8×8 block Discrete Cosine Transform (DCT) quantization crunch, high-frequency edge ringing (Gibbs phenomenon), and extreme contrast & saturation boost.
  - **Newspaper Halftone Rosettes (`newspaper`):** CMYK angled screen dot rosettes (Cyan 15°, Magenta 75°, Yellow 0°, Black 45°) over unbleached newsprint paper.
  - **Two-Ink Risograph (`risograph`):** Dual spot-color ink layering (Fluorescent Pink `#ff48b0` + Teal `#00838a`) with halftone screening and mechanical drum misregistration jitter.
  - **Streaky 1-Bit Fax (`fax`):** High-contrast 1-bit thermal print with dirty roller vertical streaks, scanline dropouts, and transmission header (`FROM: B0R3D FAX G3...`).
  - **Monochrome phosphor decay & bloom:** P1 Green (525nm peak), P3 Amber (600nm peak), and P4 White CRT phosphor spectral emission, beam scanlines, and decay bloom.
- **Extended hardware & handhelds (v0.7.0):**
  - **Nokia 3310:** 84×48 monochrome green backlight LCD (`#1c281a`, `#879b6f`) with square pixel grid.
  - **Game Boy Color per-tile mode:** 160×144, 8 background palettes of 4 colors from 32,768 RGB555 gamut, 1 palette per 8×8 tile constraint, `.chr` tile export.
  - **Virtual Boy:** 384×224, 4 shades of crimson on black (`#000000`, `#460000`, `#8c0000`, `#ff0000`) with CRT scanlines.
  - **Atari ST:** 320×200, 16 colors picked from 512 (3 bits per RGB channel), 5:6 pixel aspect ratio.
  - **Amstrad CPC (Modes 0 & 1):** Mode 0 (160×200, 16 from 27 colors, 2:1 aspect) and Mode 1 (320×200, 4 from 27 colors, 1:1 aspect) using the 27 hardware color gate array pool.
  - **MSX Screen 2:** 256×192, max 2 colors per 8×1 horizontal pixel slice from 15 fixed TMS9918 colors.
  - **CGA Composite artifact mode:** 320×200, 16 NTSC composite artifact colors produced by color burst subcarrier crosstalk.
  - **Crisp wallpaper export presets:** 1-click centered integer exports for Phone Lockscreen (1080×2400), b0r3d 95 Desktop (1024×768), and Full HD Desktop (1920×1080).
  - **"Surprise me" randomizer:** `🎲 Surprise me` button shuffling a random retro profile, dither, pre-filter recipe, and screen effect.
- **BBS Heritage, Teletext & Batch Tools (v0.8.0):**
  - **PETSCII Studio (Commodore 64):** always the C64's own 40×25 screen, the C64 character glyph set, 16-color VIC-II palette matching, and two exports:
    - `.seq`: a PETSCII byte stream (colour and reverse control codes) that prints the picture through the C64's CHROUT.
    - `.prg`: a program that shows it. `LOAD"NAME",8` then `RUN`: a one-line BASIC stub (`10 SYS 2061`) starts a short routine that copies the picture into screen memory (`$0400`) and colour memory (`$D800`), waits for a key, then clears the screen.
  - **Teletext / Ceefax 2×3 Mosaics:** Sub-pixel mosaic character generator with 64 contiguous/separated block patterns (Unicode's sextant characters), 8 broadcast colors, optional Ceefax broadcast header row (`P100 CEEFAX 100...`), and a `.txt` download (plain Unicode text, not a broadcast teletext file).
  - **Dial-Up Baud Rate Playback Simulation:** Vintage modem streaming playback simulation at 300, 1200, 2400, 9600, 14.4k, 28.8k baud, or Instant, featuring Play, Pause, Replay controls, streaming byte progress counter, and blinking teletype cursor `█`.
  - **Batch EXIF Scrubber & In-Browser ZIP Bundling:** Multi-photo drag-and-drop and file picking, interactive batch queue inspector with GPS and trailer detection badges, and 1-click "Download Clean ZIP" bundling all cleaned photos into standard `.zip` files entirely in browser memory with zero network requests. A batch is the photos picked or dropped together (never the sample); repeated names get `-2`, `-3`, and every entry has the same fixed 1980-01-01 date.
- **Animated PNG (APNG) & Looping GIF Exports (v0.8.2):**
  - **Zero-dependency APNG encoder:** creates standard Animated PNGs with `acTL`, `fcTL`, `IDAT`, and `fdAT` chunk sequences, supporting infinite loops (`num_plays = 0`), indexed palettes, and 24-bit RGB with native browser zlib deflate compression.
  - **Zero-dependency GIF89a encoder:** complete in-browser GIF encoder with Logical Screen Descriptor, Global/Local Color Tables, Netscape 2.0 loop extension block, Graphic Control Extensions with frame delays, and pure TypeScript LZW stream compression.
  - **Screen FX loop:** cycles CRT scanline ripples, electron beam oscillations, composite chroma subcarrier phase rotations, and rolling VHS tracking glitches with dynamic tape head noise snow.
  - **A/B compare wipe loop:** smooth looping split wipe transition between the original photo and the retro deres result with a crisp retro divider bar.
  - **Dither shimmer loop:** shifts Bayer, PS1, and ordered dither matrix coordinates across 8 phase rotations for an authentic retro hardware shimmer.
  - **Export actions:** 1-click "Download APNG" and "Download GIF" buttons directly in the Export section with animation style selector, up to 1024×1024 per frame, with the status line counting the frames as they're made.
- Settings are remembered on your device. The picture never is.

## Planned

- **v0.9.0, Tactile sound & retro polish:** Web Audio tactile click/switch sounds, floppy disk drive head stepping feedback, and UI polish.
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
pnpm sample            # rebuild the sample's made-up metadata (b0r3d-brand/rukus.png)
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
| Nokia 3310 | 2-level green backlight LCD matrix (#1c281a, #879b6f) |
| Game Boy Color | 15-bit RGB555 gamut (32,768 colours), 8 palettes of 4 colours |
| Virtual Boy | 4 intensity levels of crimson on black |
| Atari ST | 512-colour range (3 bits per RGB channel), 16 on screen |
| Amstrad CPC | 27-colour hardware gate array palette (16 for Mode 0, 4 for Mode 1) |
| MSX Screen 2 | 15 TMS9918 fixed colours (2 per 8×1 horizontal pixel slice) |
| CGA Composite | 16 NTSC composite artifact colours from color burst crosstalk |
| Custom | User-defined palette file or quantized from picture |

## Credits

All the code here is written for this project. The one thing bundled from
elsewhere is the ASCII studio's font (below, CC BY-SA 4.0). The methods come from:

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
| 0.8.5 | 2026-10-08 | Includes what went live unversioned earlier on 2026-10-08 (phone layout fix, All Tags list, AI markers, EXIF Injector tab, sample metadata), then fixes from its review. AI markers: Content Credentials alone are no longer called AI (cameras sign photos too) and are shown as a neutral note with who wrote them; AI-edited pictures, a PNG's XMP and prompts in PNG iTXt are found; WebP credentials are read and scrubbed. Injector: edits instead of replacing the whole EXIF (before, changing one field on a phone photo lost its rotation, camera and location), checks every value, says up front which formats it can't write, offers to remove a contradicting XMP block, updates the batch. All Tags: full values (every coordinate part, signed numbers, versions, comments), at most 2,000 tags listed and 500 shown. Sample: a real sRGB profile instead of an empty one, a white-background thumbnail, `pnpm sample` to rebuild it. A location preset tooltip reworded. |
| 0.8.3 | 2026-10-07 | Fix release from the 2026-10-07 review. Scrubber: phone photos keep their rotation, honest Verified Clean badge, batch only holds the photos picked together, HEIC/AVIF inspection, damaged files can't freeze the page, WebP trailers and progressive-JPEG metadata removed. DeRes: each machine its own colour count, grabbed palettes stay with Custom, safe share links, repeat .scr/.koa downloads, real NES .chr, 8 machines' colours fixed, NES sub-palettes from the picture, files match the preview with bars, unusable dithers greyed out, no more "387 of 256 colours" on machines without a colour list, the made-up Digipal machine removed. ASCII: correct Teletext blocks and C64 screen codes, 40×25 PETSCII, working .seq and a .prg that shows the picture, blank .ans author, Teletext saved as .txt. Animations: size limit, progress, faster GIFs. |
| 0.8.2 | 2026-10-07 | First live release. Animated PNG and looping GIF exports (Screen FX loop, A/B wipe, dither shimmer). |
| 0.8.0 | 2026-10-07 | BBS heritage, Teletext & batch tools: PETSCII mode with .seq and .prg exports, Teletext mosaics with .ttx export, dial-up baud playback, batch EXIF scrubber with ZIP download. |
| 0.7.0 | 2026-10-07 | Extended hardware & handhelds: Nokia 3310, GBC per-tile mode & .chr export, Virtual Boy crimson, Atari ST, Amstrad CPC Modes 0 & 1, MSX Screen 2, CGA composite artifact mode, Digipal LCD pet, integer wallpaper presets (Phone, Win95, 1080p), and "Surprise me" randomizer. |
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
