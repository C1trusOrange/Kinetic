import json,sys
def load(path):
    txt=open(path,encoding='utf8').read()
    i=txt.index('[result] ')
    j=txt.find('\n[run] done')
    return json.loads(txt[i+9:j]), txt
