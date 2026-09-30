# Wrapper around tools/run.py that enlarges the listen backlog (default 5 refuses connections under load).
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, TOOLS)
import serve
serve.ThreadingServer.request_queue_size = 512
import run
run.main()
