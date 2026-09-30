#!/bin/bash
# usage: q.sh file.js   (file contains an async function body that returns a JSON-able value)
BODY=$(cat "$1")
WAIT="(()=>{ if(window.__R===undefined){ window.__R=null; (async()=>{ try { const v=await (async()=>{ $BODY })(); window.__R=JSON.stringify(v)||'null'; } catch(e){ window.__R='ERR '+e.message+' '+e.stack; } })(); } return window.__R; })()"
cd /c/Users/caleb/Desktop/AiProject/fps
python tools/run.py "tools/viewer.html?kind=test" --wait "$WAIT" --eval "window.__R" 2>&1 | grep -v "^\[run\]"
