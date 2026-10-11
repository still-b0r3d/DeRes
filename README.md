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

**Status:** v0.9.2.1 is live at [img.b0r3d.org](https://img.b0r3d.org).

---

## What it does (v0.9.2.1)

- **Open a picture** with the button, by dragging it onto the page, by pasting
  it (Ctrl+V / Cmd+V), or try a sample. Pictures: Rukus, who carries made-up,
  site-themed EXIF, a thumbnail and a colour profile so every tool has
  something to show; Chainsaw Squirrel's crystal forest; a cat nap. GIFs:
  Rukus breaking out of his hamster ball in z0mbie crystal, a Chainsaw
  Squirrel yeti fight, and three moments from b0r3d.org's music clips (a
  crystal waking up, a neon cube, a cat at a 90s desk). All of them come from
  the site's own games and clips (`samples/`, `b0r3d-brand/`). A picture is
  decoded once into a working copy no bigger than 2048 px
  on its long edge (big phone photos would otherwise break the page on
  iPhones), with the photo's rotation applied.
- **Settings sections:** each visit starts with only Image open (the EXIF
  tools also keep the section with their main button open); the rest open
  with a click.
- **Animated GIFs (v0.9.1)** open with all their frames, through DeRes's own
  decoder (`gif-decode.ts`, no library; it composites frames exactly as
  browsers do). The worker shrinks each frame as it arrives so the whole
  animation fits the same memory as an exported one (never below 256 px on the
  long edge; past that, the first frames that fit are kept and the picture
  info says "first 256 of 300 frames"). The first frame is the picture every
  control works on, and the picture info reads "58 frames · 3.9 s".
  - **Play / Pause** under the preview, with a slider to any frame (back to
    the first in one move) and a frame counter ("12 / 58": always the same
    width, dimmed while the next frame is still being made). Each frame goes
    through the current settings, Signal and screen effect included, then it
    loops at the GIF's own speed until a setting changes. Paused, the frame on
    screen is the one the PNG, wallpaper and emulator downloads use, and
    Compare shows that frame.
  - **GIF frames** in the Animation choices (only while an animated GIF is
    open, and chosen then): the GIF or APNG download runs every frame through
    the pipeline and keeps the GIF's delays and loop count. The frames go into the
    file one at a time, so any number of them fit and only one frame's size is
    limited. A full-colour GIF always shares one palette across its frames, so
    still parts don't shimmer: past what the animation memory holds, each frame
    is made twice (once to read its colours, once to write it).
  - The Signal's noise moves at the GIF's own speed. The ASCII studio plays
    the GIF too (see below), and each preview opens on the frame the other
    was paused on.
- **Reset settings** (v0.9.1) at the foot of DeRes's and the ASCII studio's
  controls: one press asks "Reset everything?", a second within 4 seconds puts
  every setting back to its default (grabbed palettes and a share link in the
  address go too). The picture stays.
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
  Animations (below) hold every frame at once, so they stop at 1024×1024: past
  what fits, the GIF and APNG come out at the biggest Size that does, and a
  line by their buttons says so (a 32-frame signal loop on the NES: "GIF and
  APNG come out at 2× (512×480 px): 3× and up are too big for 32 frames.").
- **ASCII / ANSI Studio (v0.4.0):**
  - **Half-block color mode (`▀`):** doubles vertical resolution for authentic 24-bit RGB and 16-color ANSI BBS art scenes.
  - **Character ramps:** Standard (` .:-=+*#%@`), Detailed, Block shades (` ░▒▓█`), Katakana (half-width), Binary, and custom text inputs, with 2:1 cell aspect ratio correction.
  - **Colour profiles:** Vintage 16-color ANSI (CGA/PC text mode), Green CRT phosphor, Amber CRT phosphor, Monochrome, and RGB Truecolor.
  - **Clipboard copy:** one-click copy as raw text, GitHub Markdown, terminal ANSI escape codes, or formatted HTML `<pre>`.
  - **BBS `.ans` export:** native CP437 bytes with DOS ANSI escape sequences and 128-byte SAUCE metadata record (title, group `b0r3d.org`, date, dimensions; the author is left blank for the artist).
  - **Rendered PNG export:** crisp 1×, 2×, 4× image export rendered with the bundled CP437 font (pick the size, then download).
  - **Animated GIFs (v0.9.2):** a play bar under the art (Play / Pause, a frame slider,
    "12 / 58"), as in DeRes. The worker turns each frame into text art with the
    current settings and the page keeps them (14 bytes a cell), so after the
    first pass it loops at the GIF's own speed; only the rows that change are
    redrawn. Paused, the frame on screen is the one every copy and download
    uses, with "-frame12" in the file names past the first. The dial-up modem
    ("Dial up", "Redial") types out the frame on screen; it and the play bar
    never run at once.
  - **Animated exports (v0.9.2):** GIF and APNG of the rendered art, each frame the same
    pixels as its PNG, with the GIF's delays and loop count, through the
    streaming writers. When all the frames use 256 colours or fewer (ANSI 16,
    C64, Teletext, greys) the file is indexed with exactly those colours.
    Frames are capped at 1024×1024 like DeRes's animations: past that they come
    out at the biggest size that fits, and a line by the buttons says so. An
    **ANSImation** `.ans` holds every frame, each drawn over the last from
    cursor-home (no clears, so no flicker), with one SAUCE record; it plays as
    fast as the viewer sends it. `.seq`, `.prg` and Teletext `.txt` stay one
    frame.
- **EXIF Scrubber (v0.5.0):**
  - **Byte-level stripping (no canvas re-encoding):** pixel streams remain bit-identical with zero generational quality loss, and the colour profile is kept.
  - **JPEG stripping:** strips APP1 (Exif, XMP), APP13 (Photoshop IRB / IPTC), COM, and APP2 MPF while preserving JFIF, Adobe APP14, and decoding tables, including metadata tucked between a progressive JPEG's scans.
  - **Trailing data removal:** truncates data following JPEG `FF D9` (EOI), PNG `IEND` and a WebP's RIFF end, to eliminate Google Pixel Motion Photo MP4 videos, Samsung camera trailers, and gain maps.
  - **Orientation preservation:** writes back a clean, minimal 36-byte APP1 segment holding only the orientation tag (if orientation > 1), at the start of the file (after JFIF if there is one) where viewers look for it, so upright phone photos stay upright. WebP gets none: browsers ignore a WebP's orientation tag.
  - **PNG & WebP stripping:** drops PNG `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME` and `caBX` (Content Credentials); strips WebP `EXIF`, `XMP ` and `C2PA` chunks, clears VP8X flags, and updates RIFF lengths.
  - **GIF (v0.9.1):** the inspector shows the version, size, frames and loop, comments, plain text, XMP and other application blocks by name. "Remove everything" keeps the frames, colour tables, timing, loop and colour profile byte for byte and drops the rest; "Location only" drops just the XMP blocks that say where. Every frame decodes the same after a scrub. The EXIF Injector says plainly that GIFs can't hold EXIF.
  - **HEIC and AVIF:** inspect only (the metadata is shown even when the browser can't display the picture); convert to JPEG or WebP to scrub.
  - **Metadata inspector & narrative:** displays camera make/model, lens, timestamps, shutter speed, aperture, ISO, and a plain-English narrative summary.
  - **All Tags list:** every tag in the file (IFD0, Exif, GPS, Interop, the thumbnail's IFD1, XMP, PNG text, Content Credentials) with its full value: coordinates in degrees, minutes and seconds, versions, Windows XP text, UserComment, signed values, and a byte count for maker notes. A filter finds tags by name, number or value. (Shown in the EXIF Injector too.)
  - **AI markers:** says when a file declares it was made or edited with AI: the IPTC digital source type (in XMP, including a PNG's), Content Credentials that say so, Stable Diffusion / ComfyUI settings, Midjourney prompts, DALL-E's name. Content Credentials on their own are shown as a neutral note with the app or device that wrote them, since cameras, phones and editors add them too; their signature isn't checked. No marker never proves a person made a picture, and pixel watermarks like SynthID can't be read here.
  - **GPS coordinate callout:** displays coordinates as DMS and decimal with 1-click copy; loads zero external maps or tile APIs (zero phone-home rule). A location kept only in XMP counts too.
  - **Uncropped-thumbnail warning:** detects embedded IFD1 thumbnails, renders a preview, and warns that a thumbnail may show the uncropped original.
  - **Automated privacy self-check:** re-parses the scrubbed output buffer with the metadata inspector. The "Verified Clean" badge (and each batch row's "Cleaned") only shows when no GPS or camera metadata is left; otherwise it says what is.
- **EXIF Injector (v0.8.5):**
  - **Edits, doesn't replace:** the form starts with what the photo has; only the fields you change are written, an emptied field removes its tag, and every other tag (exposure details, serial numbers, the maker's own data, the thumbnail) stays as it was, in the photo's own byte order. A maker note stays at the same place in the block when it can, since some makers point inside it from the block's start.
  - **Fields:** camera make and model, lens, artist, copyright, software, orientation, aperture, shutter speed, ISO, focal length, date and time, description, and GPS latitude, longitude and altitude, with presets (b0r3d Defaults, three places) and a Now button.
  - **Device presets (v0.9.2.1):** make a picture look like it came from a phone, a camera or a handheld: iPhone 15 Pro, Pixel 8 Pro, Galaxy S23 Ultra, iPhone 4, Canon EOS 5D Mark II, Canon PowerShot SD1000, Kodak EasyShare C613, Nikon Coolpix 990, Nintendo 3DS, and a Game Boy Camera for DeRes's Game Boy pictures (the real one never wrote EXIF). A preset fills in the make, model, lens, software and a typical exposure the way that device writes them (`device-presets.ts`; strings from real files where we found one, and left empty where the device writes nothing). Injecting then also writes its lens maker and 35 mm focal length, and drops what named the old camera: the maker's own data, serial numbers, owner name and lens range. The date, place, creator and orientation stay as they were. Focal lengths keep thousandths now (phones write 6.765 mm).
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
- **Signal: the real analog video signal (v0.9.0).** The finished picture goes out the
  way the machine sent it to a TV and comes back as the TV decoded it: colour
  bleed, fringes, dot crawl, ringing and noise. This is the real thing, the
  [ntsc-rs](https://github.com/valadaptive/ntsc-rs) engine (MIT) built to
  WebAssembly, not a look-alike filter. The engine (about 90 KB gzipped)
  loads only when the signal is turned on.
  - **Connections:** Machine's own, RF (aerial socket), composite, and VHS
    tape at SP, LP and EP. A **wear** slider runs from a clean signal to a
    worn-out one; **Advanced** has colour, sharpening, and the TV's decoder
    (simple, or a comb filter that cleans up the colour fringes).
  - **Each machine on the wire:** every pixel lasts as long as it did on the
    real machine (the NES's 5.37 MHz pixels, the Genesis's 6.71 MHz, the CGA's
    7.16 and 14.3 MHz, the Atari 2600's one pixel per colour cycle…), so dither
    patterns blend or turn into rainbows as they did. Machines that ran 228
    colour cycles a line (CGA, Apple II, Atari 2600, Genesis, Master System,
    MSX) keep their colour fringes still instead of crawling. "Machine's own"
    picks how each one usually reached the TV (RF for the NES, Spectrum, 2600
    and ST; a VCR for the VHS look and the early CCD camera; composite for the
    rest).
  - **Real CGA artifact colour:** with the signal on, CGA Composite sends each
    colour as its 4-dot black-and-white pattern in the 640-pixel mode, and the
    colours come out of the signal itself. The picture is dithered to the
    colours the signal really makes from those patterns (measured through the
    engine for the current settings), so it aims at what the TV shows.
  - **Moving noise in the loops:** every frame of an animation gets its own
    signal frame, so the noise, snow and tape tracking really move. The Screen
    FX loop can be 16, 32 or 48 frames at 15 or 30 fps (15 fps steps the
    engine two frames at a time, so motion keeps real NTSC speed). Longer
    loops have to fit in the same memory as 16 frames at 1024×1024 (48 frames
    fit up to about 640×480).
  - The PNG and wallpaper downloads keep the signal (in full colour), the file
    name says which connection (`…-4x-rf.png`), and share links carry it.
- Settings are remembered on your device. The picture never is.

## Planned

- **Tactile sound & retro polish** (version picked when it ships): Web Audio tactile click/switch sounds, floppy disk drive head stepping feedback, and UI polish.

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
pnpm build:signal      # rebuild the signal engine (needs Rust, see below)
```

`test:e2e` and `verify:site` need Playwright's browsers
(`pnpm exec playwright install`).

**The signal engine** is Rust: `signal/` is a small wrapper around the
[ntsc-rs](https://github.com/valadaptive/ntsc-rs) engine crate (`crates/ntscrs`
only, pinned to one commit in `signal/Cargo.toml`; never its GPL desktop app).
The built WebAssembly is committed in `src/signal/wasm/`, so `pnpm build` (and
the hosting build) never needs Rust. Rebuild it only after changing `signal/`
or moving to a newer engine commit:

- Rust with the `wasm32-unknown-unknown` target
  (`rustup target add wasm32-unknown-unknown`);
- `wasm-bindgen-cli` at exactly the version `signal/Cargo.toml` pins, on the
  PATH or named by the `WASM_BINDGEN` environment variable;
- then `pnpm build:signal`. It builds with SIMD (every supported browser has
  it; the "relaxed SIMD" build would be faster in Chromium, but Safari can't
  load it) and writes `src/signal/wasm/manifest.json`, which the unit tests
  check the committed `.wasm` against.

On Windows without the Visual Studio build tools, use Rust's `-gnu` toolchain
(`RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu`), with that toolchain's
`lib/rustlib/x86_64-pc-windows-gnu/bin/self-contained` folder on the PATH.

The licences of everything compiled into the `.wasm` are in
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), served next to the page.

How it fits together:

- `src/core/`: the image engine, as plain functions with unit tests next to
  them. Colour maths (`color.ts`), palette matching with its cache
  (`matcher.ts`), dithering (`dither.ts`, `bayer.ts`, `yliluoma.ts`), resizing
  (`resample.ts`), framing (`geometry.ts`), pre-filters (`adjust.ts`), screen
  effects (`fx.ts`), PNG (`png.ts`, no library: the browser's own
  CompressionStream), the machines (`profiles.ts`) and the pipeline that ties
  them together (`pipeline.ts`, `export.ts`). GIFs: decoding (`gif-decode.ts`),
  opening an animation within the memory budget (`gif-frames.ts`) and encoding
  (`gif.ts`, `apng.ts`, written a frame at a time). `signal.ts` decides what goes to
  the signal engine: each machine's pixel clock, line timing and usual
  connection, the engine settings for each connection, and how the result is
  shown at the export size.
- `src/signal/`: loading the signal engine (`load.ts`, a dynamic import, so
  nothing loads until the signal is on) and its built files (`wasm/`).
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
| CGA Composite | 16 NTSC composite artifact colours from color burst crosstalk. With the Signal on: the colours the signal itself makes from each 4-dot pattern, measured through the engine |
| Custom | User-defined palette file or quantized from picture |

## Credits

All the code here is written for this project, with two things bundled from
elsewhere: the ASCII studio's font (below, CC BY-SA 4.0), and the Signal step's
engine, [ntsc-rs](https://github.com/valadaptive/ntsc-rs) by valadaptive (MIT),
compiled to WebAssembly with a few small libraries (all MIT; see
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)). The methods come from:

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
feature release, the third for fixes and small changes (`0.1.1`), and a
fourth now and then for a small addition between them (`0.9.2.1`). The version
lives in `package.json` and is bumped for every release that goes live, with a
row added below. The footer shows the version, the build (the commit it was
built from) and a link to this repository.

| Version | Date | Notes |
|---------|------|-------|
| 0.9.2.1 | 2026-10-10 | More samples: two pictures (Chainsaw Squirrel's crystal forest, a cat nap) and four GIFs (a Chainsaw Squirrel yeti fight; a crystal waking up, a neon cube and a cat at a 90s desk from b0r3d.org's music clips), listed as "Try a picture" and "Try a GIF". EXIF Injector device presets: ten phones, cameras and handhelds, filled in the way each device writes its EXIF; injecting one also writes its lens maker and 35 mm focal length and drops the old camera's maker data and serial numbers. Focal lengths keep thousandths. Every visit starts with only the Image section open. |
| 0.9.2 | 2026-10-10 | Animated GIFs in the ASCII / ANSI studio: Play/Pause and a frame slider under the art, each frame through the current settings, looping from memory after the first pass; the paused frame is the one every copy and download uses ("-frame12" in the names), and DeRes and the studio open on each other's paused frame. New downloads: GIF and APNG of the rendered art (each frame the same pixels as its PNG, with the GIF's delays and loop count, dropping to the biggest size that fits an animation) and an ANSImation .ans (every frame drawn over the last, one SAUCE record). The modem's buttons are "Dial up", "Hang up" and "Redial", and it never types while the GIF plays. The studio's PNG size is picked first, then downloaded. Also includes what went live unversioned since 0.9.1: a slider to any frame in DeRes's play bar; GIF and APNG drop to the biggest Size that fits and say so; "GIF frames" takes any number of frames (past the memory budget a full-colour GIF is made in two passes, one shared palette); a steady play bar (the counter keeps its width and dims instead of saying "Rendering"), every frame kept so loops stay smooth, and room for the play bar on screen; share links go on the clipboard and leave the address bar alone. |
| 0.9.1 | 2026-10-09 | GIFs across the tools, and Reset. Samples: Rukus, or a GIF of him breaking out of his hamster ball. Animated GIFs open with every frame (DeRes's own decoder, checked against the browser's pixel for pixel), held within the animation memory budget; Play/Pause in the preview, through every setting and the Signal (its noise at the GIF's own speed); "GIF frames" export to GIF or APNG with the GIF's delays and loop count, streamed frame by frame; the paused frame is the one the downloads use. EXIF tools: GIFs are inspected and scrubbed (frames kept byte for byte), and a location kept only in XMP is found in every format. "Reset settings" in DeRes and the ASCII studio. Saved ASCII settings are checked field by field; a change made just before leaving the page is still saved. |
| 0.9.0 | 2026-10-09 | Signal: the picture through a real analog TV signal (the ntsc-rs engine, built to WebAssembly and loaded only when it's on). RF, composite and VHS SP/LP/EP plus each machine's own connection, a wear slider, colour, sharpening and the TV's decoder. Every machine goes out at its real pixel clock and line timing, so dithers blend or turn to rainbows as they did and 228-cycle machines keep their fringes still. CGA Composite gets its colours from the signal itself, dithered to the colours the signal really makes. PNG, wallpaper and animation exports keep it; loops get real moving noise, and the Screen FX loop can be 16, 32 or 48 frames at 15 or 30 fps. GIF encoding about 40% faster with far less memory on noisy loops. |
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

The license covers the code, not the names: the b0r3d name and the b0r3d cup
logo are the site's own, so a copy you host should go by a name of its own
rather than present itself as b0r3d.org or b0r3d DeRes.
