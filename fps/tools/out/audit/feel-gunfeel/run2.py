#!/usr/bin/env python3
"""Scratch wrapper around tools/run.py that raises the listen backlog of the static server.
(tools/serve.py uses socketserver's default backlog of 5, which refuses connections when Chrome
fetches ~100 modules at once on a busy machine.) Does not modify any project file."""
import os
import sys

TOOLS = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
sys.path.insert(0, TOOLS)
import serve  # noqa: E402

serve.ThreadingServer.request_queue_size = 512

import run  # noqa: E402

if __name__ == '__main__':
    run.main()
