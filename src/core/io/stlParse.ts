/**
 * STL parsing (binary and ASCII). Produces a triangle soup: 9 floats per triangle.
 * Use `weldSoup` (core/mesh/weld) to convert to an indexed mesh.
 */

export interface StlSoup {
  /** 9 floats per triangle (v0, v1, v2). */
  soup: Float32Array;
  format: 'binary' | 'ascii';
  /** Header text (binary) or solid name (ASCII). */
  name: string;
}

export function isBinaryStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  if (84 + count * 50 === buffer.byteLength) return true;
  // Not an exact binary size: treat as ASCII if it starts with "solid".
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength)));
  if (/^\s*solid/i.test(head) && /facet|endsolid/i.test(decodeHead(buffer, 2048))) return false;
  // Some exporters pad binary files; accept if large enough.
  return 84 + count * 50 <= buffer.byteLength;
}

function decodeHead(buffer: ArrayBuffer, n: number): string {
  return new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(n, buffer.byteLength)));
}

export function parseStl(buffer: ArrayBuffer): StlSoup {
  return isBinaryStl(buffer) ? parseBinaryStl(buffer) : parseAsciiStl(buffer);
}

export function parseBinaryStl(buffer: ArrayBuffer): StlSoup {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const soup = new Float32Array(count * 9);
  let offset = 84;
  for (let t = 0; t < count; t++) {
    offset += 12; // skip normal
    const base = t * 9;
    for (let k = 0; k < 9; k++) {
      soup[base + k] = view.getFloat32(offset + k * 4, true);
    }
    offset += 36 + 2; // vertices + attribute byte count
  }
  const name = decodeHead(buffer, 80).replace(/\0.*$/s, '').trim();
  return { soup, format: 'binary', name };
}

export function parseAsciiStl(buffer: ArrayBuffer): StlSoup {
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  const nameMatch = /^\s*solid[ \t]*([^\r\n]*)/i.exec(text);
  const values: number[] = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    values.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  if (values.length === 0 || values.length % 9 !== 0) {
    throw new Error('Invalid ASCII STL: vertex count is not a multiple of 3');
  }
  return { soup: new Float32Array(values), format: 'ascii', name: nameMatch?.[1]?.trim() ?? '' };
}
