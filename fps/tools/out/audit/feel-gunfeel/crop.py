#!/usr/bin/env python3
"""crop.py in.png out.png x y w h [scale]  -- stdlib-only PNG crop + nearest-neighbour upscale (scratch tool)."""
import struct
import sys
import zlib


def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n'
    pos = 8
    idat = b''
    while pos < len(d):
        ln, typ = struct.unpack('>I4s', d[pos:pos + 8])
        body = d[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b'IHDR':
            w, h, bd, ct, _, _, il = struct.unpack('>IIBBBBB', body)
        elif typ == b'IDAT':
            idat += body
    assert bd == 8 and il == 0 and ct in (2, 6), (bd, ct, il)
    bpp = 3 if ct == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows = []
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        f = raw[p]
        line = bytearray(raw[p + 1:p + 1 + stride])
        p += 1 + stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        rows.append(line)
        prev = line
    return w, h, bpp, rows


def write_png(path, w, h, rows):
    def chunk(t, b):
        c = struct.pack('>I', len(b)) + t + b
        return c + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def main():
    src, dst = sys.argv[1], sys.argv[2]
    x, y, cw, ch = (int(v) for v in sys.argv[3:7])
    sc = int(sys.argv[7]) if len(sys.argv) > 7 else 3
    w, h, bpp, rows = read_png(src)
    out = []
    for yy in range(y, min(h, y + ch)):
        line = rows[yy]
        row = bytearray()
        for xx in range(x, min(w, x + cw)):
            px = bytes(line[xx * bpp:xx * bpp + 3])
            row += px * sc
        for _ in range(sc):
            out.append(row)
    write_png(dst, len(out[0]) // 3, len(out), out)


if __name__ == '__main__':
    main()
