/* tslint:disable */
/* eslint-disable */

/**
 * The engine's current defaults as a full settings JSON string.
 */
export function default_settings_json(): string;

/**
 * Frees the buffers kept between frames (after a big export).
 */
export function release_buffers(): void;

/**
 * One RGBA frame through the signal. Alpha is ignored and comes back as 255.
 *
 * - `settings_json`: an ntsc-rs settings file (`{"version":1, …}`). Keys left
 *   out fall back to the engine's *legacy* defaults, so send a full set (start
 *   from `default_settings_json()`).
 * - `frame`: picks the noise; the same frame and settings give the same picture.
 * - `chroma`: colour gain after decoding (1 = as decoded).
 * - `line_locked`: keep the carrier phase the same on every line (228-cycle
 *   machines). Only used with one field per frame (`use_field` Both).
 * - `pad`: pixels of edge-repeated picture added each side while the signal
 *   runs, then cut off again.
 */
export function signal(rgba: Uint8Array, width: number, height: number, frame: number, settings_json: string, chroma: number, line_locked: boolean, pad: number): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly default_settings_json: (a: number) => void;
    readonly release_buffers: () => void;
    readonly signal: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
