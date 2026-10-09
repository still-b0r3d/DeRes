//! The analog-signal step of b0r3d DeRes: the picture goes out over a composite
//! cable or a VHS tape and comes back as a TV would show it. The work is done by
//! the ntsc-rs engine (crates/ntscrs, MIT OR ISC OR Apache-2.0); this crate only
//! hands it frames and adds three things DeRes needs:
//!
//! - edge padding, so the engine's filters don't darken the picture's left edge;
//! - a colour (chroma) gain, since a machine's own palette shouldn't get louder;
//! - a locked line phase for machines that run 228 colour cycles per line (CGA,
//!   Apple II, Atari 2600, Genesis…), where broadcast NTSC (and the engine) runs
//!   227.5 and flips the colour carrier on every other line.

use std::cell::RefCell;

use ntsc_rs::{
    NtscEffect,
    ctx::Context,
    settings::{SettingsList, UseField},
    yiq_fielding::{BlitInfo, DeinterlaceMode, Rgbx, YiqView, pixel_bytes_for},
};
use wasm_bindgen::prelude::*;

/// Samples moved on a line whose carrier is flipped: half a colour cycle.
const HALF_CYCLE: usize = 2;

struct State {
    ctx: Context,
    list: SettingsList<NtscEffect>,
    /// Last settings seen, and what they parsed to (a loop sends the same ones every frame).
    json: String,
    effect: NtscEffect,
    /// YIQ planes + scratch, reused between frames of the same size.
    yiq: Vec<f32>,
    padded: Vec<u8>,
    out: Vec<u8>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn with_state<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|cell| {
        let mut slot = cell.borrow_mut();
        let state = slot.get_or_insert_with(|| State {
            ctx: Context::new(),
            list: SettingsList::new(),
            json: String::new(),
            effect: NtscEffect::default(),
            yiq: Vec::new(),
            padded: Vec::new(),
            out: Vec::new(),
        });
        f(state)
    })
}

/// Is this line's colour carrier flipped half a cycle? Mirrors the engine's own
/// rule for one field per frame (`(frame + 2 * line) & 2`).
fn carrier_flipped(frame: usize, line: usize) -> bool {
    (frame + 2 * line) & 2 != 0
}

/// One RGBA frame through the signal. Alpha is ignored and comes back as 255.
///
/// - `settings_json`: an ntsc-rs settings file (`{"version":1, …}`). Keys left
///   out fall back to the engine's *legacy* defaults, so send a full set (start
///   from `default_settings_json()`).
/// - `frame`: picks the noise; the same frame and settings give the same picture.
/// - `chroma`: colour gain after decoding (1 = as decoded).
/// - `line_locked`: keep the carrier phase the same on every line (228-cycle
///   machines). Only used with one field per frame (`use_field` Both).
/// - `pad`: pixels of edge-repeated picture added each side while the signal
///   runs, then cut off again.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn signal(
    rgba: &[u8],
    width: u32,
    height: u32,
    frame: u32,
    settings_json: &str,
    chroma: f32,
    line_locked: bool,
    pad: u32,
) -> Result<Vec<u8>, JsError> {
    let (w, h) = (width as usize, height as usize);
    if w == 0 || h == 0 || rgba.len() != w * h * 4 {
        return Err(JsError::new("rgba length must be width * height * 4"));
    }
    with_state(|s| {
        if s.json != settings_json {
            s.effect = s
                .list
                .from_json(settings_json)
                .map_err(|e| JsError::new(&format!("bad signal settings: {e:?}")))?;
            s.json.clear();
            s.json.push_str(settings_json);
        }
        let frame = frame as usize;
        let locked = line_locked && s.effect.use_field == UseField::Both;
        let pad = (pad as usize).max(if locked { HALF_CYCLE } else { 0 });
        let pw = w + 2 * pad;

        // Padded copy: edges repeated, flipped lines moved half a cycle right.
        s.padded.clear();
        s.padded.resize(pw * h * 4, 255);
        for y in 0..h {
            let shift = if locked && carrier_flipped(frame, y) { HALF_CYCLE } else { 0 };
            let src = &rgba[y * w * 4..(y + 1) * w * 4];
            let dst = &mut s.padded[y * pw * 4..(y + 1) * pw * 4];
            let start = pad + shift;
            dst[start * 4..(start + w) * 4].copy_from_slice(src);
            for x in 0..start {
                dst[x * 4..x * 4 + 3].copy_from_slice(&src[0..3]);
            }
            for x in start + w..pw {
                dst[x * 4..x * 4 + 3].copy_from_slice(&src[(w - 1) * 4..(w - 1) * 4 + 3]);
            }
        }

        let field = s.effect.use_field.to_yiq_field(frame);
        s.yiq.clear();
        s.yiq.resize(YiqView::buf_length_for((pw, h), field), 0.0);
        let row_bytes = pw * pixel_bytes_for::<Rgbx, u8>();
        let blit = BlitInfo::from_full_frame(pw, h, row_bytes);
        let mut yiq = YiqView::from_parts(&mut s.yiq, (pw, h), field);
        yiq.set_from_strided_buffer::<Rgbx, u8, _>(&s.ctx, &s.padded, blit, ());
        s.effect.apply_effect_to_yiq(&s.ctx, &mut yiq, frame, [1.0, 1.0]);
        if chroma != 1.0 {
            for v in yiq.i.iter_mut().chain(yiq.q.iter_mut()) {
                *v *= chroma;
            }
        }
        s.out.clear();
        s.out.resize(pw * h * 4, 0);
        yiq.write_to_strided_buffer::<Rgbx, u8, _>(&s.ctx, &mut s.out, blit, DeinterlaceMode::Bob, ());

        let mut cropped = vec![0u8; w * h * 4];
        for y in 0..h {
            let shift = if locked && carrier_flipped(frame, y) { HALF_CYCLE } else { 0 };
            let from = (y * pw + pad + shift) * 4;
            cropped[y * w * 4..(y + 1) * w * 4].copy_from_slice(&s.out[from..from + w * 4]);
        }
        Ok(cropped)
    })
}

/// The engine's current defaults as a full settings JSON string.
#[wasm_bindgen]
pub fn default_settings_json() -> String {
    with_state(|s| s.list.to_json_string(&NtscEffect::default()).unwrap_or_default())
}

/// Frees the buffers kept between frames (after a big export).
#[wasm_bindgen]
pub fn release_buffers() {
    with_state(|s| {
        s.yiq = Vec::new();
        s.padded = Vec::new();
        s.out = Vec::new();
    })
}
