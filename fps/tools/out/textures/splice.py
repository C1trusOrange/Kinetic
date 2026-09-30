import sys
def splice(path, start_marker, end_marker, new_path):
    p = open(path).read()
    a = p.index(start_marker)
    b = p.index(end_marker, a)
    p = p[:a] + open(new_path).read() + p[b:]
    open(path, 'w').write(p)
if __name__ == '__main__':
    splice(*sys.argv[1:5])
