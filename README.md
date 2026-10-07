# b0r3d DeRes (`img.b0r3d.org`)

A 100% client-side retro image laboratory and utility suite for [b0r3d.org](https://b0r3d.org).

b0r3d DeRes turns modern images into authentic vintage hardware assets, generates BBS-era ASCII/ANSI terminal art, and scrubs privacy-compromising EXIF metadata entirely in-memory.

Nothing phones home. No tracking, no external APIs, and no server processing. What you drag into the browser stays in your browser.

---

## Features

### 1. DeRes & Hardware Quantization Engine
- **Hardware Palettes Across Eras:**
  - *Pre-Crash / Early 8-Bit:* Atari 2600, Apple II, ZX Spectrum, Commodore 64, IBM CGA (Mode 1).
  - *8-Bit Consoles & Handhelds:* NES / Famicom, Sega Master System, Game Boy (DMG-01 & Pocket).
  - *16-Bit Golden Age:* Sega Genesis / Mega Drive (9-bit 64-color), SNES (256-color), NEC PC-9801, PICO-8.
  - *32-Bit / 64-Bit Constraints:* PlayStation 1 (15-bit color + hardware dithering), Nintendo 64 (TMEM crunch + 16-bit texture mode).
  - *Custom:* Direct hex color entry and Lospec `.hex` palette file loader.
- **Mathematical Dithering:** None (hard cel/posterize), Bayer Ordered Dithering (2×2, 4×4, 8×8), Floyd–Steinberg error diffusion, and Atkinson dithering.
- **Pre-Filters:** Contrast, brightness, and saturation adjustments to optimize dynamic range for low-color palettes.
- **Display FX:** CRT scanlines and phosphor glow toggle.
- **Integer Scaling Export:** Clean $1\times$, $2\times$, $4\times$, $8\times$, and $16\times$ nearest-neighbor scaling so exported pixel art never blurs when posted to social feeds.

### 2. ASCII & ANSI Terminal Studio
- **Character Ramps:** Standard ASCII density (` .:-=+*#%@`), Blocks (` ░▒▓█`), and custom character string input.
- **Color Profiles:** Monochrome Green CRT phosphor, Amber CRT, ANSI 16-color, and full RGB.
- **Instant Export:** Copy raw text to clipboard, copy as Markdown code blocks, or save high-resolution PNG snapshots.

### 3. EXIF & Metadata Scrubber
- **Inspector:** Instant breakdown of embedded metadata (GPS coordinates, camera model, shutter/lens info, timestamps).
- **1-Click Sanitizer:** Export clean, sanitized original images with 0 bytes of residual metadata.

---

## Development

```bash
pnpm install
pnpm dev
pnpm build
```

---

## Deployment

Hosted on Cloudflare Pages connected to `main` at [img.b0r3d.org](https://img.b0r3d.org).
