"""Builds data.js from the Game Dev Tycoon wiki pages
"Game Development Based on Experience/1.4.3" and "Custom Game Engine".

Usage: python scripts/build_data.py   (downloads both pages)
"""
import re, json, sys, os, urllib.request

PAGE = 'Game_Development_Based_on_Experience/1.4.3'
FEATURES_PAGE = 'Custom_Game_Engine'
API = 'https://gamedevtycoon.fandom.com/api.php?action=parse&format=json&prop=wikitext&formatversion=2&page='
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data.js')

def wikitext(page):
    req = urllib.request.Request(API + page, headers={'User-Agent': 'gdt-helper-build/1.0'})
    return json.load(urllib.request.urlopen(req))['parse']['wikitext']

src = wikitext(PAGE)
COL = {'50,150,50':3,'60,120,60':2,'70,90,70':1,'80,80,80':0,'120,60,60':-2,'150,50,50':-3}
def tables(text):
    out=[]; cur=None
    for line in text.split('\n'):
        if line.startswith('{|'): cur={'rows':[],'row':[]}
        elif cur is None: continue
        elif not line.startswith(('|', '!')):
            # continuation of a multi-line cell
            if cur['row']: k,v=cur['row'][-1]; cur['row'][-1]=(k,v+' '+line)
        elif cur is None: continue
        elif line.startswith('|}'):
            if cur['row']: cur['rows'].append(cur['row'])
            out.append(cur['rows']); cur=None
        elif line.startswith('|-'):
            if cur['row']: cur['rows'].append(cur['row'])
            cur['row']=[]
        elif line.startswith('|+'): pass
        elif line.startswith('!'): cur['row'].append(('h',line[1:]))
        elif line.startswith('|'): cur['row'].append(('d',line[1:]))
    return out
def cell(raw):
    m=re.match(r'^(.*?[^|])\|([^|].*|)$', raw) if '=' in raw.split('|')[0] else None
    style,val=(m.group(1),m.group(2)) if m else ('',raw)
    if 'border: 0' in style or 'border:0' in style: return None
    val=val.strip()
    val=re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]',r'\1',val).replace('&nbsp;',' ').replace('<br />','').replace('&minus;','-')
    c=re.search(r'background-color:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)',style)
    col=','.join(c.groups()) if c else None
    return {'v':re.sub(r'\s+',' ',val).strip(),'r':COL.get(col)}
T=tables(src)
def data_rows(t):
    rows=[]
    for r in t:
        if any(k=='h' for k,_ in r): continue
        cs=[x for x in (cell(v) for _,v in r) if x is not None]
        if cs: rows.append(cs)
    return rows
G=['Action','Adventure','RPG','Simulation','Strategy','Casual']
A=['Y','E','M']
F=['Engine','Gameplay','Story/Quests','Dialogues','Level Design','AI','World Design','Graphics','Sound']
out={'source':'https://gamedevtycoon.fandom.com/wiki/'+PAGE,'genres':G,'audiences':A,'focus':F}
topics={}
for r in data_rows(T[0]):
    assert len(r)==10,(r)
    topics[r[0]['v'].rstrip('*')]={'genre':dict(zip(G,[c['r'] for c in r[1:7]])),'audience':dict(zip(A,[c['r'] for c in r[7:10]]))}
out['topics']=topics
plats={}
for r in data_rows(T[1]):
    assert len(r)==10,(r)
    plats[r[0]['v']]={'genre':dict(zip(G,[c['r'] for c in r[1:7]])),'audience':dict(zip(A,[c['r'] for c in r[7:10]]))}
out['platforms']=plats
ratio={}
for r in data_rows(T[2]):
    ratio[r[0]['v']]=dict(zip(F,[int(c['v'].rstrip('%')) for c in r[1:]]))
out['devRatio']=ratio
def focus(t, pct=False):
    d={}
    for r in data_rows(t):
        assert len(r)==11,(r)
        name=r[0]['v'].replace(' / ','/').replace(' /','/')
        d[name]={'td':float(r[1]['v']),'f':dict(zip(F,[int(c['v']) if pct else c['r'] for c in r[2:]]))}
    return d
out['genreFocus']=focus(T[3]); out['multiFocus']=focus(T[4]); out['sliders']=focus(T[5],True)
out['specialization']={r[0]['v']:{'design':int(r[1]['v']),'tech':int(r[2]['v'])} for r in data_rows(T[6])}

# ---- engine features (Custom Game Engine page) ----
AREAS = {'Graphics':'Graphics','Sound':'Sound','Story/Quests':'Story/Quests','Engine':'Engine','Gameplay':'Gameplay',
         'Dialogue':'Dialogues','Level Design':'Level Design','World Design':'World Design','Artificial Intelligence':'AI'}
def fcell(raw):
    m=re.match(r'^\s*((?:[\w-]+="[^"]*"\s*)*)\|(?!\])(.*)$', raw)
    val=(m.group(2) if m else raw)
    val=re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]',r'\1',val).replace('&nbsp;',' ').replace('\xa0',' ').replace('<br />',' ')
    return re.sub(r'\s+',' ',val).strip()
def money(s):
    m=re.match(r'([\d.]+)\s*([KM]?)', s.replace(',',''))
    return round(float(m.group(1))*{'':1,'K':1e3,'M':1e6}[m.group(2)]) if m else 0
fsrc=wikitext(FEATURES_PAGE)
features=[]
for sec,body in re.findall(r'^===([^=]+)===\n(.*?)(?=^===|\Z)', fsrc, re.S|re.M):
    area=AREAS.get(sec.strip())
    if not area: continue
    t=tables(body)[0]
    head=[fcell(v) for k,v in t[0] if k=='h']
    for r in t[1:]:
        cs=dict(zip(head,[fcell(v) for k,v in r if k=='d']))
        name=cs.get('Name','').rstrip('*').strip()
        if not name: continue
        rp=re.search(r'(\d+)\s*RP',cs.get('Research cost',''))
        ben=re.match(r'\d+',cs.get('Benefit',''))
        group=cs.get('Group') or None
        if area=='Graphics': group=None if 'Stereoscopic' in name else 'Graphics'
        features.append({'name':name,'area':area,'group':group,'benefit':int(ben.group()) if ben else 0,
            'rp':int(rp.group(1)) if rp else 0,'engineCost':money(cs.get('Cost for incorporating in final engine','')),
            'devCost':cs.get('Cost for adding during game development',''),
            'after':re.sub(r'(\w)Level',r'\1 Level',cs.get('Researchable after','')).replace(' ,',',')})
out['features']=features
out['featuresSource']='https://gamedevtycoon.fandom.com/wiki/'+FEATURES_PAGE
for k,v in out.items(): print(k, len(v) if hasattr(v,'__len__') else v)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('// Generated by scripts/build_data.py - do not edit by hand.\n')
    f.write('window.GDT_DATA = ' + json.dumps(out, indent=1) + ';\n')
