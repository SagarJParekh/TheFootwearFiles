import { describe, expect, it } from 'vitest';
import { box, icosphere } from '../fixtures/primitives';
import { analyzeMesh } from '../mesh/analyze';
import { unweld, weldSoup } from '../mesh/weld';
import { isBinaryStl, parseStl } from './stlParse';
import { writeAsciiStl, writeBinaryStl } from './stlWrite';

const toBuffer = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('STL IO', () => {
  it('round-trips binary STL', () => {
    const mesh = icosphere(25, 2);
    const buf = writeBinaryStl(mesh);
    expect(buf.byteLength).toBe(84 + 50 * (mesh.indices.length / 3));
    expect(isBinaryStl(buf)).toBe(true);
    const { soup, format } = parseStl(buf);
    expect(format).toBe('binary');
    expect(Array.from(soup)).toEqual(Array.from(unweld(mesh)));
  });

  it('round-trips ASCII STL', () => {
    const mesh = box([10, 20, 30]);
    const buf = toBuffer(writeAsciiStl(mesh, 'cube'));
    expect(isBinaryStl(buf)).toBe(false);
    const { soup, format, name } = parseStl(buf);
    expect(format).toBe('ascii');
    expect(name).toBe('cube');
    expect(soup.length).toBe(12 * 9);
    const welded = weldSoup(soup);
    expect(welded.positions.length / 3).toBe(8);
    expect(analyzeMesh(welded).watertight).toBe(true);
  });

  it('treats a binary file whose header starts with "solid" as binary', () => {
    const buf = writeBinaryStl(box(), 'solid but actually binary');
    expect(isBinaryStl(buf)).toBe(true);
    expect(parseStl(buf).soup.length).toBe(12 * 9);
  });

  it('parses ASCII with scientific notation and CRLF', () => {
    const text = [
      'solid t', 'facet normal 0 0 1', 'outer loop',
      'vertex 0 0 0', 'vertex 1.0e+01 0 0', 'vertex 0 1E1 -0.0', 'endloop', 'endfacet', 'endsolid t',
    ].join('\r\n');
    const { soup } = parseStl(toBuffer(text));
    expect(Array.from(soup)).toEqual([0, 0, 0, 10, 0, 0, 0, 10, -0]);
  });

  it('rejects malformed ASCII', () => {
    expect(() => parseStl(toBuffer('solid x\nvertex 1 2 3\nendsolid x'))).toThrow();
  });
});
