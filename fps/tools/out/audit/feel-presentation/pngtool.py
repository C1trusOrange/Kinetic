import zlib, struct, sys

def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n'
    pos = 8; idat = b''; w = h = 0; ct = 0; bd = 8
    while pos < len(d):
        n, t = struct.unpack('>I4s', d[pos:pos+8]); c = d[pos+8:pos+8+n]; pos += 12 + n
        if t == b'IHDR': w, h, bd, ct, _, _, il = struct.unpack('>IIBBBBB', c); assert bd == 8 and il == 0
        elif t == b'IDAT': idat += c
    bpp = {2: 3, 6: 4, 0: 1, 4: 2}[ct]
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows = []; prev = bytearray(stride); p = 0
    for y in range(h):
        f = raw[p]; line = bytearray(raw[p+1:p+1+stride]); p += 1 + stride
        if f == 1:
            for i in range(bpp, stride): line[i] = (line[i] + line[i-bpp]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0; b = prev[i]; c = prev[i-bpp] if i >= bpp else 0
                pa = abs(b - c); pb = abs(a - c); pc = abs(a + b - 2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        rows.append(line); prev = line
    return w, h, bpp, rows

def write_png(path, w, h, bpp, rows):
    ct = {3: 2, 4: 6, 1: 0}[bpp]
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    def chunk(t, c): return struct.pack('>I', len(c)) + t + c + struct.pack('>I', zlib.crc32(t + c) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ct, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))

def crop_scale(src, dst, x, y, cw, ch, k=4):
    w, h, bpp, rows = read_png(src)
    out = []
    for yy in range(y, y+ch):
        line = rows[yy]
        nl = bytearray()
        for xx in range(x, x+cw):
            px = line[xx*bpp:(xx+1)*bpp]
            nl += px * k
        for _ in range(k): out.append(nl)
    write_png(dst, cw*k, ch*k, bpp, out)

def stats(path, region=None):
    w, h, bpp, rows = read_png(path)
    x0, y0, x1, y1 = region or (0, 0, w, h)
    s = 0; n = 0; clip = 0; dark = 0
    for y in range(y0, y1, 2):
        line = rows[y]
        for x in range(x0, x1, 2):
            i = x*bpp
            l = 0.2126*line[i] + 0.7152*line[i+1] + 0.0722*line[i+2]
            s += l; n += 1
            if l > 245: clip += 1
            if l < 20: dark += 1
    return {'mean': round(s/n, 1), 'clip%': round(100*clip/n, 1), 'dark%': round(100*dark/n, 1)}

if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(p, stats(p))
