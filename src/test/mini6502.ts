// Test helper: just enough of a 6502 to run the PETSCII .prg's routine, with
// stand-ins for the two C64 KERNAL calls it makes. Not an emulator: any
// instruction the routine doesn't use stops the run with an error.

export interface C64Stubs {
  /** KERNAL GETIN ($FFE4): the key pressed, 0 for none. */
  getin(mem: Uint8Array): number
  /** KERNAL CHROUT ($FFD2): print one PETSCII character. */
  chrout(a: number, mem: Uint8Array): void
}

/** Loads a .prg (2-byte load address, then data) into a fresh 64 KB memory. */
export function loadPrg(prg: Uint8Array): { mem: Uint8Array; start: number } {
  const start = prg[0] | (prg[1] << 8)
  const mem = new Uint8Array(65536)
  mem.set(prg.subarray(2), start)
  return { mem, start }
}

/** The address a one-line "SYS nnnn" BASIC program at $0801 jumps to. */
export function sysAddress(mem: Uint8Array): number {
  const next = mem[0x0801] | (mem[0x0802] << 8)
  if (mem[0x0805] !== 0x9e) throw new Error('no SYS on the first BASIC line')
  let digits = ''
  for (let p = 0x0806; mem[p] !== 0; p++) digits += String.fromCharCode(mem[p])
  if (mem[next] !== 0 || mem[next + 1] !== 0) throw new Error('more than one BASIC line')
  return Number(digits.trim())
}

/** Runs from pc until the routine returns (RTS with nothing on the stack). */
export function run(mem: Uint8Array, pc: number, stubs: C64Stubs, maxSteps = 1_000_000): void {
  let a = 0
  let x = 0
  let z = false
  const stack: number[] = []
  const abs = () => mem[pc + 1] | (mem[pc + 2] << 8)
  for (let step = 0; step < maxSteps; step++) {
    const op = mem[pc]
    switch (op) {
      case 0xa9: // LDA #
        a = mem[pc + 1]
        z = a === 0
        pc += 2
        break
      case 0xbd: // LDA abs,X
        a = mem[(abs() + x) & 0xffff]
        z = a === 0
        pc += 3
        break
      case 0x8d: // STA abs
        mem[abs()] = a
        pc += 3
        break
      case 0x9d: // STA abs,X
        mem[(abs() + x) & 0xffff] = a
        pc += 3
        break
      case 0xa2: // LDX #
        x = mem[pc + 1]
        z = x === 0
        pc += 2
        break
      case 0xe8: // INX
        x = (x + 1) & 0xff
        z = x === 0
        pc += 1
        break
      case 0xe0: // CPX #
        z = x === mem[pc + 1]
        pc += 2
        break
      case 0xc9: // CMP #
        z = a === mem[pc + 1]
        pc += 2
        break
      case 0xd0: // BNE
      case 0xf0: {
        // BEQ
        const rel = mem[pc + 1] < 0x80 ? mem[pc + 1] : mem[pc + 1] - 0x100
        pc += 2
        if ((op === 0xd0) !== z) pc += rel
        break
      }
      case 0x20: {
        // JSR
        const target = abs()
        pc += 3
        if (target === 0xffe4) a = stubs.getin(mem)
        else if (target === 0xffd2) stubs.chrout(a, mem)
        else {
          stack.push(pc)
          pc = target
        }
        break
      }
      case 0x60: // RTS
        if (stack.length === 0) return
        pc = stack.pop()!
        break
      default:
        throw new Error(`opcode $${op.toString(16)} at $${pc.toString(16)} not handled`)
    }
  }
  throw new Error('still running after maxSteps')
}
