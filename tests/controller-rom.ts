// Original diagnostic ROM assembled here for tests; no commercial game data.
// It copies the 16 serial bits from $4016/$4017 into CPU RAM $0300/$0320.
export function controllerRom(): Uint8Array {
  const image = new Uint8Array(16 + 16384);
  image.set([0x4e, 0x45, 0x53, 0x1a, 1, 0]);
  const code: number[] = [];
  const labels = new Map<string, number>();
  const patches: { at: number; name: string; relative: boolean }[] = [];
  const emit = (...bytes: number[]) => code.push(...bytes);
  const label = (name: string) => labels.set(name, code.length);
  const branch = (opcode: number, name: string) => { emit(opcode, 0); patches.push({ at: code.length - 1, name, relative: true }); };
  const jump = (name: string) => { emit(0x4c, 0, 0); patches.push({ at: code.length - 2, name, relative: false }); };
  emit(0x78, 0xd8, 0xa2, 0xff, 0x9a, 0xa9, 0x00, 0x8d, 0x00, 0x20, 0x8d, 0x01, 0x20); // reset, disable NMI/render
  emit(0xa2, 0); label('clear'); emit(0x9d, 0, 3, 0xe8); branch(0xd0, 'clear');
  label('frame'); emit(0x2c, 0x02, 0x20); branch(0x10, 'frame'); // wait for vblank
  emit(0xa9, 1, 0x8d, 0x16, 0x40, 0xa9, 0, 0x8d, 0x16, 0x40, 0xa2, 0);
  label('read');
  emit(0xad, 0x16, 0x40, 0x29, 1, 0x9d, 0x00, 0x03); // port1 bit -> $0300,X
  emit(0xad, 0x17, 0x40, 0x29, 1, 0x9d, 0x20, 0x03); // port2 bit -> $0320,X
  emit(0xbd, 0x00, 0x03, 0x1d, 0x40, 0x03, 0x9d, 0x40, 0x03); // latch port1 bits
  emit(0xbd, 0x20, 0x03, 0x1d, 0x60, 0x03, 0x9d, 0x60, 0x03); // latch port2 bits
  emit(0xe8, 0xe0, 16); branch(0xd0, 'read'); jump('frame');
  label('interrupt'); emit(0x40);
  for (const patch of patches) {
    const target = labels.get(patch.name)!;
    if (patch.relative) code[patch.at] = (target - patch.at - 1) & 255;
    else { code[patch.at] = target & 255; code[patch.at + 1] = (0x8000 + target) >>> 8; }
  }
  image.set(code, 16);
  for (const [offset, target] of [[0x3ffa, labels.get('interrupt')!], [0x3ffc, 0], [0x3ffe, labels.get('interrupt')!]]) {
    image[16 + offset] = target & 255; image[16 + offset + 1] = (0x8000 + target) >>> 8;
  }
  return image;
}

export function cpuRam(state: number[]) {
  const bytes = new Uint8Array(state), view = new DataView(bytes.buffer);
  // RASTATE chunk -> uncompressed FCEUmm state -> CPU state section -> RAM.
  if (new TextDecoder().decode(bytes.subarray(0, 7)) !== 'RASTATE') throw new Error('Unknown state container');
  for (let chunk = 8; chunk + 8 < bytes.length;) {
    const length = view.getUint32(chunk + 4, true), start = chunk + 8;
    if (String.fromCharCode(...bytes.subarray(start, start + 3)) === 'FCS') {
      for (let section = start + 16; section + 5 < start + length;) {
        const size = view.getUint32(section + 1, true), end = section + 5 + size;
        if (end > bytes.length) throw new Error('Invalid state section');
        if (bytes[section] === 1) for (let field = section + 5; field + 8 <= end;) {
          const name = String.fromCharCode(...bytes.subarray(field, field + 4));
          const size = view.getUint32(field + 4, true) & 0x7fffffff;
          if (name === 'RAM\0' && size === 2048) return bytes.slice(field + 8, field + 8 + size);
          field += 8 + size;
        }
        section = end;
      }
    }
    chunk = start + ((length + 7) & ~7);
  }
  throw new Error('CPU RAM not found');
}
