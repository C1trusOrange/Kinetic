import sys,json,re
txt=sys.stdin.read()
# find json block after "custom"
i=txt.find('{')
j=json.loads(txt[i:txt.rfind('}')+1].split('\n[run]')[0]) if False else None
