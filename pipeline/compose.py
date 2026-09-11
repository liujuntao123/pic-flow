#!/usr/bin/env python3
"""Layout engine v3: handwriting fonts + 3 semantic emphasis styles.

Element types
  asset: {"type":"asset","file":"x.png","x":cx,"y":cy,"height":H | "width":W,
          "anchor":"cc|ct|cb|lc|rc","rotate":deg,"flip":true,"opacity":1.0}
         Elements paint in array order (later = on top). Oversized/offset
         assets bleed past the canvas edge and are clipped.
  text : {"type":"text","content":"..【kw】..『quote』〖warn〗..","x":..,"y":top,
          "size":40,"bold":false,"font":"body|title|brush","color":"#333",
          "align":"center|left|right","max_width":900,"line_height":1.5,
          "rotate":deg,"stroke_width":n,"stroke_fill":"#fff",
          "hl_color":"#E8842B","quote_color":"#2E7CB8","warn_color":"#D4483B",
          "box":{"bg":"#F6A83C","pad":24,"radius":18,"color":"#4A2800"}}
  rule : {"type":"rule","x1":..,"x2":..,"y":..,"thickness":4,"color":"#222222"}

Emphasis styles inside content
  【关键词】  orange  + bold body font   — key terms / names / stratagems
  『引语』    blue    + bold body font   — quoted speech / wording
  〖强信息〗  red     + brush font (+8%) — numbers / outcome / casualty

--debug renders grid + element bboxes instead of text glyphs.
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

try:
    from roots import find_root
except ImportError:  # 脚本被单独复制进 <项目>/scripts/ 时，roots.py 就在同目录
    from pathlib import Path as _P
    import sys as _s
    _s.path.insert(0, str(_P(__file__).resolve().parent))
    from roots import find_root

# 项目根从「本次要渲染的 layout 文件」推断，无需把脚本复制进项目。
# 显式覆盖：环境变量 PICFLOW_ROOT。
ROOT = find_root(sys.argv[1] if len(sys.argv) > 1 else None)
FONT_DIR = ROOT / "fonts"
FONT_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
SC = 2

FAMILIES = {
    "body":  (FONT_DIR / "LXGWWenKai-Regular.ttf", FONT_DIR / "LXGWWenKai-Medium.ttf"),
    "title": (FONT_DIR / "ZCOOLKuaiLe-Regular.ttf", FONT_DIR / "ZCOOLKuaiLe-Regular.ttf"),
    "brush": (FONT_DIR / "MaShanZheng-Regular.ttf", FONT_DIR / "MaShanZheng-Regular.ttf"),
    "noto":  (Path(FONT_REG), Path(FONT_BOLD)),
}

_fonts = {}

THEME = {}


def apply_theme(theme):
    """Merge style-pack: text colors, bubble defaults, font family overrides."""
    THEME.clear()
    THEME.update(theme or {})
    for fam, pair in (THEME.get("fonts") or {}).items():
        reg, bold = pair if isinstance(pair, (list, tuple)) else (pair, pair)
        reg, bold = Path(reg), Path(bold)
        if not reg.is_absolute():
            reg, bold = ROOT / reg, ROOT / bold
        FAMILIES[fam] = (reg, bold)


def el_box(el):
    """Element box with theme-level defaults merged in."""
    return {**(THEME.get("bubble") or {}), **(el.get("box") or {})}


def font(size, bold, family="body"):
    reg, bold_path = FAMILIES.get(family, FAMILIES["body"])
    path = (bold_path if bold_path.exists() else reg) if bold else reg
    if not path.exists():
        path, bold = Path(FONT_REG), False
    key = (str(path), size)
    if key not in _fonts:
        kw = {"index": SC} if str(path).endswith(".ttc") else {}
        _fonts[key] = ImageFont.truetype(str(path), size, **kw)
    return _fonts[key]


MARKERS = {"【": ("】", "hl"), "『": ("』", "quote"), "〖": ("〗", "warn")}


def parse_content(s):
    """Strip marker pairs; return list of (char, style|None)."""
    out, style, close = [], None, None
    for ch in s:
        if style is None:
            if ch in MARKERS:
                close, style = MARKERS[ch]
            else:
                out.append((ch, None))
        elif ch == close:
            style, close = None, None
        else:
            out.append((ch, style))
    return out


def char_metrics(base_family, base_bold, base_size, st):
    """-> (family, bold, size) for a char with style st (or None)."""
    if st == "hl" or st == "quote":
        return base_family, True, base_size
    if st == "warn":
        return "brush", True, round(base_size * 1.08)
    return base_family, base_bold, base_size


def char_color(el, st):
    if st == "hl":
        return el.get("hl_color", THEME.get("hl_color", "#E8842B"))
    if st == "quote":
        return el.get("quote_color", THEME.get("quote_color", "#2E7CB8"))
    if st == "warn":
        return el.get("warn_color", THEME.get("warn_color", "#D4483B"))
    box_color = el_box(el).get("color")
    return el.get("color", box_color or THEME.get("text", "#333333"))


def char_w(draw, ch, size, bold, family="body"):
    return draw.textlength(ch, font=font(size, bold, family))


KINSOKU = "，。！？；：、）】》%”…—』〗"


def wrap_lines(draw, chars, size, bold, max_w, family="body"):
    """Greedy char wrap with kinsoku + ASCII-run handling. -> list[lines]."""
    lines, cur, cur_w = [], [], 0

    def cw(ch, st):
        fam, b, sz = char_metrics(family, bold, size, st)
        return char_w(draw, ch, sz, b, fam)

    i = 0
    while i < len(chars):
        ch, st = chars[i]
        if ch == "\n":
            lines.append(cur)
            cur, cur_w = [], 0
            i += 1
            continue
        w = cw(ch, st)
        if cur and cur_w + w > max_w and ch not in KINSOKU:
            if ch.isascii() and ch.isalnum():
                j = len(cur)
                while j > 0 and cur[j - 1][0].isascii() and cur[j - 1][0].isalnum():
                    j -= 1
                if j < len(cur):
                    moved = cur[j:]
                    lines.append(cur[:j])
                    cur_w = sum(cw(c, s) for c, s in moved)
                    cur = moved[:]
                    cur.append((ch, st))
                    cur_w += w
                    i += 1
                    continue
            lines.append(cur)
            cur, cur_w = [], 0
        cur.append((ch, st))
        cur_w += w
        i += 1
    if cur or not lines:
        lines.append(cur)
    return lines


def block_geom(draw, el, W):
    chars = parse_content(el["content"])
    size = el.get("size", 40)
    bold = el.get("bold", False)
    family = el.get("font", "body")
    lines = wrap_lines(draw, chars, size, bold, el.get("max_width", 940), family)
    lh = size * el.get("line_height", 1.5)
    widths = []
    for ln in lines:
        w = 0
        for c, st in ln:
            fam, b, sz = char_metrics(family, bold, size, st)
            w += char_w(draw, c, sz, b, fam)
        widths.append(w)
    w = max(widths) if widths else 0
    x = el.get("x", W // 2)
    align = el.get("align", "center")
    left = x - w / 2 if align == "center" else (x if align == "left" else x - w)
    pad = el_box(el).get("pad", 0)
    px, py = (pad, pad) if isinstance(pad, (int, float)) else pad
    return {"lines": lines, "lh": lh, "w": w, "size": size, "bold": bold,
            "family": family, "left": left, "top": el.get("y", 0), "px": px, "py": py}


def _paint(d, geo, el):
    sw = el.get("stroke_width", 0)
    sf = el.get("stroke_fill", "#FFFFFF")
    align = el.get("align", "center")
    ascent, _ = font(geo["size"], geo["bold"], geo["family"]).getmetrics()
    for i, ln in enumerate(geo["lines"]):
        lw = 0
        for c, st in ln:
            fam, b, sz = char_metrics(geo["family"], geo["bold"], geo["size"], st)
            lw += char_w(d, c, sz, b, fam)
        if align == "center":
            cx = geo["left"] + (geo["w"] - lw) / 2
        elif align == "left":
            cx = geo["left"]
        else:
            cx = geo["left"] + geo["w"] - lw
        base = geo["top"] + i * geo["lh"] + ascent
        for ch, st in ln:
            fam, b, sz = char_metrics(geo["family"], geo["bold"], geo["size"], st)
            d.text((cx, base), ch, font=font(sz, b, fam), fill=char_color(el, st),
                   anchor="ls", stroke_width=sw, stroke_fill=sf)
            cx += char_w(d, ch, sz, b, fam)


def _paste_clipped(canvas, img, px, py):
    W, H = canvas.size
    x0, y0 = max(px, 0), max(py, 0)
    x1, y1 = min(px + img.width, W), min(py + img.height, H)
    if x1 <= x0 or y1 <= y0:
        return
    canvas.alpha_composite(img.crop((x0 - px, y0 - py, x1 - px, y1 - py)), (x0, y0))


def load_asset(el):
    path = ROOT / "assets" / el["file"]
    if not path.exists():
        # 素材尚未生成（常见于刚脚手架出的项目：布局骨架引用 icon_a/char_a，
        # 而 assets.json 里是另一批占位名）。此处不抛异常，改为画一个占位框，
        # 让 debug 画布与识图环节能直接看出"这个素材还没生成"，
        # 而不是抛 FileNotFoundError 中断整块渲染。
        print(f"[compose][warn] 素材缺失，已用占位框代替：assets/{el['file']}"
              "（先跑 gen_all.py 生图，或把 layout 里的 file 改成 assets.json 中的名字）",
              file=sys.stderr)
        return None
    img = Image.open(path).convert("RGBA")
    if "height" in el:
        s = el["height"] / img.height
    elif "width" in el:
        s = el["width"] / img.width
    else:
        s = 1.0
    img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    if el.get("flip"):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    if el.get("opacity", 1.0) < 1.0:
        a = img.getchannel("A").point(lambda v: int(v * el["opacity"]))
        img.putalpha(a)
    if el.get("rotate"):
        img = img.rotate(el["rotate"], expand=True, resample=Image.BICUBIC)
    return img


def _missing_placeholder(canvas, el):
    """素材缺失时画一个虚线框 + 文件名，坐标口径与真实素材一致。"""
    w = int(el.get("width") or 360)
    h = int(el.get("height") or 360)
    anchor = el.get("anchor", "cc")
    x, y = el["x"], el["y"]
    px = x - w // 2 if anchor[0] == "c" else (x - w if anchor[0] == "r" else x)
    py = y - h // 2 if anchor[1] == "c" else (y if anchor[1] == "t" else y - h)
    d = ImageDraw.Draw(canvas, "RGBA")
    for i in range(px, px + w, 18):  # 上/下虚线
        d.line([(i, py), (min(i + 9, px + w), py)], fill=(220, 60, 60, 170), width=2)
        d.line([(i, py + h), (min(i + 9, px + w), py + h)], fill=(220, 60, 60, 170), width=2)
    for j in range(py, py + h, 18):  # 左/右虚线
        d.line([(px, j), (px, min(j + 9, py + h))], fill=(220, 60, 60, 170), width=2)
        d.line([(px + w, j), (px + w, min(j + 9, py + h))], fill=(220, 60, 60, 170), width=2)
    label = f"[缺素材] {el['file']}"
    f = font(26, True, "body")
    tw = d.textlength(label, font=f)
    tx, ty = px + max(0, (w - tw) / 2), py + max(0, (h - 30) / 2)
    d.rectangle([tx - 8, ty - 4, tx + tw + 8, ty + 32], fill=(255, 255, 255, 210))
    d.text((tx, ty), label, font=f, fill=(200, 40, 40, 255))
    return (px, py, px + w, py + h)


def draw_asset(canvas, el, allow_missing=False):
    img = load_asset(el)
    if img is None:
        if not allow_missing:
            raise FileNotFoundError(f"素材缺失：assets/{el['file']}（请先生成或替换 layout 中的 file）")
        return _missing_placeholder(canvas, el)
    anchor = el.get("anchor", "cc")
    x, y = el["x"], el["y"]
    px = x - img.width // 2 if anchor[0] == "c" else (x - img.width if anchor[0] == "r" else x)
    py = y - img.height // 2 if anchor[1] == "c" else (y if anchor[1] == "t" else y - img.height)
    _paste_clipped(canvas, img, round(px), round(py))
    return (px, py, px + img.width, py + img.height)


def paint_box(d, rect, el):
    """Bubble/tag background. box.style:
    fill | pill | outline | sketch | ink | stamp | burst | marker
    box.tail: bl|bc|br|tl|tc|tr — little pointer toward the speaker."""
    box = el_box(el)
    style = box.get("style", "fill")
    x0, y0, x1, y1 = rect
    bg = box.get("bg", "#F6A83C")
    bc = box.get("border_color", "#1A1A1A")
    border = box.get("border", 4)
    radius = box.get("radius", 16)
    if style == "pill":
        radius = (y1 - y0) // 2
    if style in ("fill", "pill", "marker", "ink"):
        d.rounded_rectangle(rect, radius=radius, fill=bg)
    elif style == "outline":
        d.rounded_rectangle(rect, radius=radius, fill=box.get("fill", "#FFFFFF"),
                            outline=bc, width=border)
    elif style == "sketch":
        d.rounded_rectangle(rect, radius=radius, fill="#FFFFFF", outline=bc, width=3)
        d.rounded_rectangle([x0 + 4, y0 + 4, x1 - 4, y1 - 4],
                            radius=max(4, radius - 6), outline=bc, width=2)
    elif style == "stamp":
        d.rounded_rectangle(rect, radius=max(8, radius // 2), outline=bc, width=5)
    elif style == "burst":
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        rx, ry = (x1 - x0) / 2 * 1.3, (y1 - y0) / 2 * 1.45
        n = 12
        pts = []
        for k in range(n * 2):
            ang = math.pi * k / n
            f = 1.0 if k % 2 == 0 else 0.73
            pts.append((cx + rx * f * math.cos(ang), cy + ry * f * math.sin(ang)))
        d.polygon(pts, fill=bg)
    tail = box.get("tail")
    if tail:
        th = box.get("tail_len", 26)
        cx = (x0 + x1) / 2
        solid = style in ("fill", "pill", "marker", "ink")
        if tail in ("bl", "bc", "br"):
            by, tip_y = y1 - 2, y1 + th
            if tail == "bl":
                p = [(x0 + 12, by), (x0 + 44, by), (x0 + 2, tip_y)]
            elif tail == "br":
                p = [(x1 - 12, by), (x1 - 44, by), (x1 - 2, tip_y)]
            else:
                p = [(cx - 16, by), (cx + 16, by), (cx, tip_y)]
        elif tail in ("tl", "tc", "tr"):
            by, tip_y = y0 + 2, y0 - th
            if tail == "tl":
                p = [(x0 + 12, by), (x0 + 44, by), (x0 + 2, tip_y)]
            elif tail == "tr":
                p = [(x1 - 12, by), (x1 - 44, by), (x1 - 2, tip_y)]
            else:
                p = [(cx - 16, by), (cx + 16, by), (cx, tip_y)]
        elif tail == "lc":
            bx, tip_x = x0 + 2, x0 - th
            cy = (y0 + y1) / 2
            p = [(bx, cy - 16), (bx, cy + 16), (tip_x, cy)]
        elif tail == "rc":
            bx, tip_x = x1 - 2, x1 + th
            cy = (y0 + y1) / 2
            p = [(bx, cy - 16), (bx, cy + 16), (tip_x, cy)]
        else:
            p = []
        if p:
            tail_fill = bg if solid else box.get("fill", "#FFFFFF")
            d.polygon(p, fill=tail_fill)
            if not solid:
                d.line(list(p) + [p[0]], fill=bc, width=3)
                if tail in ("lc", "rc"):
                    sy0, sy1 = sorted([p[0][1], p[1][1]])
                    d.rectangle([bx - 5, sy0 + 2, bx + 5, sy1 - 2], fill=tail_fill)
                else:
                    sx0, sx1 = sorted([p[0][0], p[1][0]])
                    d.rectangle([sx0 + 2, by - 5, sx1 - 2, by + 5], fill=tail_fill)
    return rect


def draw_text(canvas, layer_draw, el, W):
    geo = block_geom(layer_draw, el, W)
    bh = len(geo["lines"]) * geo["lh"]
    if el.get("rotate"):
        m = 100 if el_box(el).get("style") == "burst" else 60
        tw = int(geo["w"] + 2 * geo["px"] + 2 * m)
        th = int(bh + 2 * geo["py"] + 2 * m)
        layer = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        if el.get("box"):
            paint_box(ld, [m, m, tw - m, th - m], el)
        g2 = dict(geo, left=m + geo["px"], top=m + geo["py"])
        _paint(ld, g2, el)
        layer = layer.rotate(el["rotate"], expand=True, resample=Image.BICUBIC)
        cx = geo["left"] + geo["w"] / 2
        cy = geo["top"] + bh / 2
        _paste_clipped(canvas, layer, round(cx - layer.width / 2), round(cy - layer.height / 2))
        a = math.radians(el["rotate"])
        bb_w, bb_h = geo["w"] + 2 * geo["px"], bh + 2 * geo["py"]
        rw = abs(bb_w * math.cos(a)) + abs(bb_h * math.sin(a))
        rh = abs(bb_w * math.sin(a)) + abs(bb_h * math.cos(a))
        return (cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2)
    if el.get("box"):
        paint_box(layer_draw,
                  [geo["left"] - geo["px"], geo["top"] - geo["py"],
                   geo["left"] + geo["w"] + geo["px"], geo["top"] + bh + geo["py"]], el)
    _paint(layer_draw, geo, el)
    return (geo["left"] - geo["px"], geo["top"] - geo["py"],
            geo["left"] + geo["w"] + geo["px"], geo["top"] + bh + geo["py"])


def render(layout, out_path, debug=False):
    W, H = layout["width"], layout["height"]
    theme = layout.get("theme")
    if theme is None and (ROOT / "style.json").exists():
        try:
            theme = json.loads((ROOT / "style.json").read_text())
        except Exception:
            theme = {}
    apply_theme(theme)
    canvas = Image.new("RGBA", (W, H), layout.get("bg", THEME.get("bg", "#FFFFFF")))
    measure = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    draw = ImageDraw.Draw(canvas)
    boxes = []
    for el in layout.get("elements", []):
        t = el["type"]
        if t == "asset":
            boxes.append(("asset:" + el["file"], draw_asset(canvas, el, allow_missing=debug)))
        elif t == "card":
            x, y, w, h = el["x"], el["y"], el["width"], el["height"]
            border_c = el.get("border_color") or THEME.get("card_border")
            draw.rounded_rectangle([x, y, x + w, y + h], radius=el.get("radius", 16),
                                   fill=el.get("fill") or THEME.get("card_fill", "#FFFFFF"),
                                   outline=border_c,
                                   width=el.get("border", 1) if border_c else 0)
            boxes.append((f"card:{el.get('label', '')}", (x, y, x + w, y + h)))
        elif t == "barchart":
            x, y = el["x"], el["y"]
            bw = el["width"]
            bh = el.get("bar_height", 56)
            gap = el.get("gap", 36)
            lw = el.get("label_width", 200)
            mx = el.get("max") or max(i["value"] for i in el["items"])
            bar_c = el.get("bar_color", "#3182CE")
            track = el.get("track")
            lsz = el.get("label_size", 30)
            vsz = el.get("value_size", 30)
            f_l = font(lsz, True, el.get("font", "body"))
            boxes.append(("barchart", (x, y, x + bw, y + len(el["items"]) * (bh + gap))))
            for i, it in enumerate(el["items"]):
                ry = y + i * (bh + gap)
                draw.text((x + lw - 12, ry + bh / 2), it["label"],
                          font=f_l, fill=el.get("label_color", THEME.get("text", "#333333")),
                          anchor="rm")
                bx0, bx1 = x + lw, x + bw
                if track:
                    draw.rounded_rectangle([bx0, ry, bx1, ry + bh], radius=bh // 2, fill=track)
                frac = max(it["value"] / mx, 0.02)
                fill_w = max(int((bx1 - bx0) * frac), bh)
                draw.rounded_rectangle([bx0, ry, bx0 + fill_w, ry + bh],
                                       radius=bh // 2, fill=it.get("color", bar_c))
                vt = it.get("text", str(it["value"]))
                draw.text((bx0 + fill_w + 14, ry + bh / 2), vt, font=font(vsz, True),
                          fill=it.get("color", bar_c), anchor="lm")
        elif t == "piechart":
            cx, cy, r = el["cx"], el["cy"], el["r"]
            items = el["items"]
            total = sum(i["value"] for i in items) or 1
            start = -90.0
            for it in items:
                sweep = it["value"] / total * 360.0
                draw.pieslice([cx - r, cy - r, cx + r, cy + r], start, start + sweep,
                              fill=it.get("color", "#3182CE"))
                start += sweep
            hole = el.get("hole", 0)
            if hole:
                hc = el.get("hole_color", THEME.get("bg", "#FFFFFF"))
                draw.ellipse([cx - r * hole, cy - r * hole, cx + r * hole, cy + r * hole], fill=hc)
            lsz = el.get("label_size", 30)
            lx = cx + r + 40
            for i, it in enumerate(items):
                ly = cy - (len(items) - 1) * 24 + i * 48
                draw.rounded_rectangle([lx, ly - 10, lx + 26, ly + 16],
                                       radius=6, fill=it.get("color", "#3182CE"))
                draw.text((lx + 38, ly + 2), f"{it['label']}  {it.get('text', it['value'])}",
                          font=font(lsz, True, el.get("font", "body")),
                          fill=el.get("label_color", THEME.get("text", "#333333")), anchor="lm")
            boxes.append(("piechart", (cx - r, cy - r, cx + r + 40 + 420, cy + r)))
        elif t == "table":
            x, y = el["x"], el["y"]
            cw = el["col_widths"]
            rh = el.get("row_height", 72)
            size = el.get("size", 32)
            bc = el.get("border_color", "#E0DAD0")
            aligns = el.get("aligns")
            header = el.get("header")
            rows = ([header] if header else []) + el.get("rows", [])
            boxes.append(("table", (x, y, x + sum(cw), y + len(rows) * rh)))
            for ri, row in enumerate(rows):
                ry = y + ri * rh
                is_h = header is not None and ri == 0
                fill = (el.get("header_fill", "#2F2A26") if is_h
                        else (el.get("row_fill", "#FFFFFF") if ri % 2 else el.get("alt_fill", el.get("row_fill", "#FFFFFF"))))
                draw.rectangle([x, ry, x + sum(cw), ry + rh], fill=fill,
                               outline=bc, width=el.get("border", 1))
                cx_cell = x
                for ci, cell in enumerate(row):
                    ccol = (el.get("header_color", "#FFFFFF") if is_h
                            else el.get("cell_color", THEME.get("text", "#333333")))
                    al = (aligns[ci] if aligns else "center")
                    fam = "title" if is_h else "body"
                    if al == "center":
                        px_, anc = cx_cell + cw[ci] / 2, "mm"
                    else:
                        px_, anc = cx_cell + 18, "lm"
                    draw.text((px_, ry + rh / 2), str(cell), font=font(size, is_h, fam),
                              fill=ccol, anchor=anc)
                    cx_cell += cw[ci]
        elif t == "arrow":
            x, y, ln = el["x"], el["y"], el["length"]
            dr = el.get("direction", "down")
            c = el.get("color", "#3182CE")
            w_ = el.get("width", 8)
            head = el.get("head", w_ * 3.2)
            if dr == "down":
                seg, tip = [(x, y), (x, y + ln - head)], (x, y + ln)
            elif dr == "up":
                seg, tip = [(x, y + head), (x, y + ln)], (x, y)
            elif dr == "right":
                seg, tip = [(x, y), (x + ln - head, y)], (x + ln, y)
            else:
                seg, tip = [(x + head, y), (x + ln, y)], (x, y)
            draw.line(seg, fill=c, width=w_)
            if dr in ("down", "up"):
                base_y = tip[1] - head if dr == "down" else tip[1] + head
                draw.polygon([tip, (x - head * 0.9, base_y), (x + head * 0.9, base_y)], fill=c)
            else:
                base_x = tip[0] - head if dr == "right" else tip[0] + head
                draw.polygon([tip, (base_x, y - head * 0.9), (base_x, y + head * 0.9)], fill=c)
        elif t == "text":
            if debug:
                geo = block_geom(measure, el, W)
                bh = len(geo["lines"]) * geo["lh"]
                a = math.radians(el.get("rotate", 0))
                bb_w, bb_h = geo["w"] + 2 * geo["px"], bh + 2 * geo["py"]
                if a:
                    rw = abs(bb_w * math.cos(a)) + abs(bb_h * math.sin(a))
                    rh = abs(bb_w * math.sin(a)) + abs(bb_h * math.cos(a))
                else:
                    rw, rh = bb_w, bb_h
                cx = geo["left"] + geo["w"] / 2
                cy = geo["top"] + bh / 2
                label = el["content"].replace("【", "").replace("】", "")[:8]
                boxes.append(("text:" + label,
                              (cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2)))
            else:
                draw_text(canvas, draw, el, W)
        elif t == "rule":
            if el.get("vertical"):
                draw.line([el["x"], el["y1"], el["x"], el["y2"]],
                          fill=el.get("color", "#222222"), width=el.get("thickness", 4))
            else:
                draw.line([el["x1"], el["y"], el["x2"], el["y"]],
                          fill=el.get("color", "#222222"), width=el.get("thickness", 4))
        else:
            raise ValueError(f"unknown element type: {t}")

    if debug:
        dbg = Image.alpha_composite(canvas, Image.new("RGBA", (W, H), (0, 0, 0, 0)))
        d = ImageDraw.Draw(dbg, "RGBA")
        for gx in range(0, W, 100):
            d.line([gx, 0, gx, H], fill=(255, 0, 0, 46), width=1)
            if gx % 200 == 0:
                d.text((gx + 3, 3), str(gx), font=font(24, True), fill=(220, 0, 0, 235))
        for gy in range(0, H, 100):
            d.line([0, gy, W, gy], fill=(255, 0, 0, 46), width=1)
            if gy % 200 == 0:
                d.text((3, gy + 2), str(gy), font=font(24, True), fill=(220, 0, 0, 235))
        f = font(24, True)
        for label, (x0, y0, x1, y1) in boxes:
            d.rectangle([x0, y0, x1, y1], outline=(30, 80, 255, 200), width=3)
            d.text((x0 + 2, y0 + 2), label, font=f, fill=(255, 255, 255, 230),
                   stroke_width=3, stroke_fill=(200, 30, 30, 255))
        dbg.convert("RGB").save(out_path)
    else:
        canvas.convert("RGB").save(out_path)
    print(f"[compose] {out_path} ({'debug' if debug else 'final'}) {W}x{H}")


if __name__ == "__main__":
    args = sys.argv[1:]
    debug = "--debug" in args
    args = [a for a in args if a != "--debug"]
    layout = json.loads(Path(args[0]).read_text())
    out = args[args.index("-o") + 1] if "-o" in args else "blocks/out.png"
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    render(layout, out, debug)
