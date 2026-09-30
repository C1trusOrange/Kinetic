#!/usr/bin/env python3
"""Static cross-module checks for KINETIC (fast, no browser).

  * every relative import resolves to an existing file
  * every named import exists as an export of the target module (default imports need `export default`)
  * every `THREE.Xxx` member used exists in the vendored three.module.js
  * every `three/addons/...` import exists

    python tools/lint_imports.py            # whole src/
    python tools/lint_imports.py src/ai     # subset (still resolves targets anywhere)
Exit code 1 if problems were found.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THREE_MODULE = os.path.join(ROOT, 'vendor', 'three', 'build', 'three.module.js')
ADDONS = os.path.join(ROOT, 'vendor', 'three', 'examples', 'jsm')

RE_COMMENT_BLOCK = re.compile(r'/\*.*?\*/', re.S)
RE_COMMENT_LINE = re.compile(r'(^|[^:\'"\\])//.*?$', re.M)
RE_IMPORT = re.compile(r'''^\s*import\s+(?P<what>[^'";]*?)\s+from\s+['"](?P<src>[^'"]+)['"]''', re.M | re.S)
RE_IMPORT_BARE = re.compile(r'''^\s*import\s+['"](?P<src>[^'"]+)['"]''', re.M)
RE_DYN_IMPORT = re.compile(r'''import\(\s*['"](?P<src>[^'"$`]+)['"]\s*\)''')
RE_EXPORT_DECL = re.compile(r'^\s*export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)', re.M)
RE_EXPORT_LIST = re.compile(r'^\s*export\s*\{([^}]*)\}(?:\s*from\s*[\'"]([^\'"]+)[\'"])?', re.M | re.S)
RE_EXPORT_STAR = re.compile(r'''^\s*export\s*\*\s*from\s*['"]([^'"]+)['"]''', re.M)
RE_EXPORT_DEFAULT = re.compile(r'^\s*export\s+default\b', re.M)
RE_THREE_MEMBER = re.compile(r'\bTHREE\.([A-Za-z_][\w]*)')


def strip_comments(src):
    src = RE_COMMENT_BLOCK.sub('', src)
    return RE_COMMENT_LINE.sub(lambda m: m.group(1), src)


_export_cache = {}


def exports_of(path, seen=None):
    path = os.path.normpath(path)
    if path in _export_cache:
        return _export_cache[path]
    seen = seen or set()
    if path in seen or not os.path.exists(path):
        return set()
    seen.add(path)
    src = strip_comments(open(path, encoding='utf-8', errors='replace').read())
    names = set(RE_EXPORT_DECL.findall(src))
    for body, _frm in RE_EXPORT_LIST.findall(src):
        for part in body.split(','):
            part = part.strip()
            if not part:
                continue
            names.add(part.split(' as ')[-1].strip())
    if RE_EXPORT_DEFAULT.search(src):
        names.add('default')
    for frm in RE_EXPORT_STAR.findall(src):
        names |= exports_of(os.path.join(os.path.dirname(path), frm), seen) - {'default'}
    _export_cache[path] = names
    return names


def three_exports():
    src = open(THREE_MODULE, encoding='utf-8').read()
    m = list(re.finditer(r'export\s*\{([^}]*)\}', src))
    names = set()
    for mm in m:
        for part in mm.group(1).split(','):
            part = part.strip()
            if part:
                names.add(part.split(' as ')[-1].strip())
    return names


def resolve(from_file, spec):
    if spec == 'three':
        return 'THREE'
    if spec.startswith('three/addons/'):
        return os.path.join(ADDONS, spec[len('three/addons/'):])
    if spec.startswith('/'):
        return os.path.join(ROOT, spec.lstrip('/'))
    if spec.startswith('.'):
        return os.path.normpath(os.path.join(os.path.dirname(from_file), spec))
    return None


def parse_named(what):
    """Returns (default_name or None, [named imports], namespace?)"""
    what = what.strip()
    default, named, ns = None, [], False
    brace = re.search(r'\{([^}]*)\}', what, re.S)
    if brace:
        for part in brace.group(1).split(','):
            part = part.strip()
            if part:
                named.append(part.split(' as ')[0].strip())
        what = (what[:brace.start()] + what[brace.end():]).strip().strip(',').strip()
    if what.startswith('* as'):
        ns = True
    elif what:
        default = what.split(',')[0].strip()
    return default, named, ns


def main():
    targets = sys.argv[1:] or ['src']
    files = []
    for t in targets:
        t = os.path.join(ROOT, t) if not os.path.isabs(t) else t
        if os.path.isfile(t):
            files.append(t)
        else:
            for dp, _dn, fn in os.walk(t):
                files += [os.path.join(dp, f) for f in fn if f.endswith('.js')]
    three = three_exports()
    problems = []
    for f in sorted(files):
        rel = os.path.relpath(f, ROOT)
        raw = open(f, encoding='utf-8', errors='replace').read()
        src = strip_comments(raw)
        for m in RE_IMPORT.finditer(src):
            spec, what = m.group('src'), m.group('what')
            target = resolve(f, spec)
            line = src[:m.start()].count('\n') + 1
            if target is None:
                problems.append(f'{rel}:{line}: bare import "{spec}" (not in import map)')
                continue
            default, named, ns = parse_named(what)
            if target == 'THREE':
                for n in named:
                    if n not in three:
                        problems.append(f'{rel}:{line}: "{n}" is not exported by three')
                continue
            if not os.path.exists(target):
                problems.append(f'{rel}:{line}: import target not found: {spec}')
                continue
            exp = exports_of(target)
            if default and 'default' not in exp:
                problems.append(f'{rel}:{line}: default import "{default}" but {spec} has no default export')
            for n in named:
                if n not in exp:
                    problems.append(f'{rel}:{line}: "{n}" is not exported by {spec} (exports: {", ".join(sorted(exp)) or "none"})')
        for m in RE_IMPORT_BARE.finditer(src):
            target = resolve(f, m.group('src'))
            if target and target != 'THREE' and not os.path.exists(target):
                problems.append(f'{rel}: side-effect import target not found: {m.group("src")}')
        for m in RE_DYN_IMPORT.finditer(src):
            target = resolve(f, m.group('src'))
            if target and target != 'THREE' and not os.path.exists(target):
                problems.append(f'{rel}: dynamic import target not found: {m.group("src")}')
        if re.search(r'''import\s+\*\s+as\s+THREE\s+from\s+['"]three['"]''', src):
            for mm in set(RE_THREE_MEMBER.findall(src)):
                if mm not in three:
                    problems.append(f'{rel}: THREE.{mm} does not exist in three r169')
    if problems:
        print('\n'.join(problems))
        print(f'\n{len(problems)} problem(s) in {len(files)} file(s)')
        sys.exit(1)
    print(f'OK - {len(files)} file(s) checked')


if __name__ == '__main__':
    main()
