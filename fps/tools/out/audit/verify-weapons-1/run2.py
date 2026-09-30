import sys, os, runpy
ROOT = r'C:\Users\caleb\Desktop\AiProject\fps'
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import serve
serve.ThreadingServer.request_queue_size = 512
sys.argv[0] = os.path.join(ROOT, 'tools', 'run.py')
runpy.run_path(sys.argv[0], run_name='__main__')
