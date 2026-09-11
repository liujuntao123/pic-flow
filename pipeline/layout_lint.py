#!/usr/bin/env python3
"""Static layout quality checks for pic-flow layouts.
Outputs human-readable warnings and exits non-zero on hard errors.
"""
import json, sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    Image = ImageDraw = ImageFont = None

try:
    from roots import find_root
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from roots import find_root

HARD = 0
WARN = 0

def box(el):
    t = el.get('type')
    if t == 'text':
        size = el.get('size', 40); lines = max(1, el.get('content','').count('\n') + 1)
        width = min(el.get('max_width', 940), max(size * 1.2, len(el.get('content','')) * size * .62))
        # PIL's glyph ink is shorter than the nominal line-height; use a conservative
        # ink estimate here and leave visual/debug review for intentional overlaps.
        height = lines * size * el.get('line_height', 1.05)
        pad = el.get('box', {}).get('pad', 0)
        if isinstance(pad, list): px, py = pad[1], pad[0]
        else: px = py = pad
        x = el.get('x', 0); y = el.get('y', 0)
        align = el.get('align','center')
        left = x-width/2 if align=='center' else (x if align=='left' else x-width)
        return (left-px, y-py, left+width+px, y+height+py)
    if t == 'asset':
        w, h = el.get('width'), el.get('height')
        path = ROOT / 'assets' / el.get('file', '')
        if path.is_file() and Image is not None:
            try:
                iw, ih = Image.open(path).size
                if h is not None:
                    w = iw * h / ih
                elif w is not None:
                    h = ih * w / iw
                else:
                    w, h = iw, ih
            except Exception:
                pass
        w, h = w or 360, h or 360
        x, y = el.get('x', 0), el.get('y', 0)
        anchor = el.get('anchor', 'cc')
        left = x - w / 2 if anchor[0] == 'c' else (x - w if anchor[0] == 'r' else x)
        top = y - h / 2 if anchor[1] == 'c' else (y - h if anchor[1] == 'b' else y)
        return (left, top, left + w, top + h)
    if t == 'card': return (el['x'],el['y'],el['x']+el['width'],el['y']+el['height'])
    if t in ('rule','arrow'):
        if t == 'rule':
            if el.get('vertical'): return (el['x']-3,el['y1'],el['x']+3,el['y2'])
            return (el['x1'],el['y']-3,el['x2'],el['y']+3)
        x,y,l=el['x'],el['y'],el['length']; d=el.get('direction','down')
        return (x-12,y-12,x+l+12,y+l+12) if d in ('down','right') else (x-l-12,y-l-12,x+12,y+12)
    if t in ('barchart','table'):
        x,y=el['x'],el['y']; w=sum(el.get('col_widths',[])) if t=='table' else el['width']
        n=(len(el.get('rows',[])) + (1 if el.get('header') else 0)) if t=='table' else len(el.get('items',[]))
        h=n*el.get('row_height',72) if t=='table' else n*(el.get('bar_height',56)+el.get('gap',36))
        return (x,y,x+w,y+h)
    if t=='piechart':
        r = el['r']; items = el.get('items', [])
        # Match compose.py: legend width is label-dependent, with a safe estimate.
        label_size = el.get('label_size', 30)
        legend_width = max([len(str(i.get('label', ''))) * label_size + 150 for i in items] or [0])
        return (el['cx']-r, el['cy']-r, el['cx']+r+40+legend_width, el['cy']+r)
    return None

def overlap(a,b): return max(0,min(a[2],b[2])-max(a[0],b[0])) * max(0,min(a[3],b[3])-max(a[1],b[1]))

def main(path):
    global HARD, WARN, ROOT
    HARD, WARN = 0, 0
    ROOT = find_root(path)
    data=json.loads(Path(path).read_text()); W,H=data['width'],data['height']; els=data.get('elements',[])
    boxes=[]
    for i,e in enumerate(els):
        b=box(e)
        if not b: continue
        boxes.append((i,e,b))
        if b[0] < -40 or b[1] < -40 or b[2] > W+40 or b[3] > H+40:
            print(f'WARN {path} [{i}] {e["type"]}: exceeds canvas boundary {tuple(round(v) for v in b)}'); WARN+=1
    for ai,(i,a,ba) in enumerate(boxes):
        for j,b,bb in boxes[ai+1:]:
            if a.get('type') in ('rule','arrow') or b.get('type') in ('rule','arrow'): continue
            area=overlap(ba,bb)
            if area <= 0: continue
            intentional = (a.get('type')=='asset' and b.get('type')=='asset') or (a.get('type')=='card' or b.get('type')=='card')
            # Illustrations commonly sit behind labels or bubbles; report these for
            # visual review without making existing, intentional compositions fail.
            asset_text = {a.get('type'), b.get('type')} == {'asset', 'text'}
            if intentional: continue
            ratio=area/max(1,min((ba[2]-ba[0])*(ba[3]-ba[1]),(bb[2]-bb[0])*(bb[3]-bb[1])))
            level='WARN' if asset_text or ratio < .12 else 'ERROR'
            print(f'{level} {path} [{i},{j}]: {a.get("type")} overlaps {b.get("type")} ({ratio:.0%})')
            if level=='ERROR': HARD+=1
            else: WARN+=1
    # composition repetition hints
    texts=[e for e in els if e.get('type')=='text']
    centered=sum(1 for e in texts if e.get('align','center')=='center')
    if texts and centered/len(texts) > .8:
        print(f'WARN {path}: {centered}/{len(texts)} text elements are centered; consider editorial alignment contrast'); WARN+=1
    print(f'[lint] {path}: {"FAIL" if HARD else "OK"}, hard={HARD}, warnings={WARN}')
    return 1 if HARD else 0

if __name__=='__main__':
    sys.exit(main(sys.argv[1]))
