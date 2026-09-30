# Like run2.py but launches Chrome with --js-flags=--expose-gc so scenarios can call window.gc().
import os, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, TOOLS)
import serve
serve.ThreadingServer.request_queue_size = 512
import run
_orig = subprocess.Popen
def patched(args, *a, **k):
    if isinstance(args, list) and args and 'chrome' in str(args[0]).lower():
        args = args + ['--js-flags=--expose-gc', '--enable-precise-memory-info']
    return _orig(args, *a, **k)
run.subprocess.Popen = patched
run.main()
