"""Studio backend: template storage (waterfall gallery) + slide-deck -> PDF export."""
import base64, io, json
from pathlib import Path
from flask import Blueprint, jsonify, request
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen import canvas

bp = Blueprint("studio", __name__)
DATA = Path(__file__).parent / "data" / "templates.json"
RATIOS = {"16:9": (960, 540), "4:3": (800, 600), "A4 portrait": (595, 842), "Square": (700, 700)}
KEYS = ("id", "name", "ratio", "w", "h", "bg", "bg2", "tc", "hc", "ac", "hf", "bf", "deco")


def T(id, name, ratio, bg, bg2, hc, tc, ac, hf, bf, deco):
    w, h = RATIOS[ratio]
    return dict(id=id, name=name, ratio=ratio, w=w, h=h, bg=bg, bg2=bg2, hc=hc, tc=tc, ac=ac, hf=hf, bf=bf, deco=deco)


SEED = [
    T("midnight", "Midnight Gold", "16:9", "#10141b", "#29323f", "#f1ede1", "#cdd3dc", "#c1903f", "serif", "sans", "bar"),
    T("paper", "Classic Paper", "4:3", "#ece6d6", "#ece6d6", "#2a2418", "#4a4231", "#b6503f", "serif", "serif", "side"),
    T("ocean", "Ocean Breeze", "16:9", "#0f4c5c", "#5a938c", "#ffffff", "#e6f4f1", "#f4d35e", "sans", "sans", "frame"),
    T("poster", "Bold Poster", "A4 portrait", "#ffffff", "#f3e9dc", "#10141b", "#333333", "#d06a56", "sans", "sans", "band"),
    T("social", "Square Social", "Square", "#74b0a8", "#5a938c", "#10141b", "#10141b", "#ffffff", "sans", "sans", "frame"),
    T("terminal", "Terminal", "16:9", "#0b1410", "#0b1410", "#7CFC9A", "#b8e8c4", "#7CFC9A", "mono", "mono", "side"),
]


def _load():
    try:
        return json.loads(DATA.read_text("utf-8"))
    except Exception:
        return [dict(t, builtin=True) for t in SEED]


def _save(ts):
    DATA.parent.mkdir(exist_ok=True)
    DATA.write_text(json.dumps(ts, indent=1), "utf-8")


@bp.get("/api/templates")
def list_templates():
    return jsonify(_load())


@bp.post("/api/templates")
def upsert_template():
    d = request.get_json(silent=True) or {}
    t = {k: d.get(k) for k in KEYS}
    if not t["id"] or not (t["name"] or "").strip():
        return jsonify(error="A template needs a name."), 400
    if t["ratio"] in RATIOS:
        t["w"], t["h"] = RATIOS[t["ratio"]]
    ts = _load()
    old = next((x for x in ts if x["id"] == t["id"]), None)
    t["builtin"] = bool(old and old.get("builtin"))
    ts = [t if x["id"] == t["id"] else x for x in ts] if old else ts + [t]
    _save(ts)
    return jsonify(ts)


@bp.delete("/api/templates/<tid>")
def delete_template(tid):
    ts, seed = _load(), next((s for s in SEED if s["id"] == tid), None)
    if seed:  # built-ins can't be removed, only reset to the original look
        ts = [dict(seed, builtin=True) if x["id"] == tid else x for x in ts]
    else:
        ts = [x for x in ts if x["id"] != tid]
    _save(ts)
    return jsonify(ts)


# ---------------------------------------------------------------- PDF export
FM = {"sans": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"),
      "serif": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
      "mono": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique")}


def hexc(h):
    try:
        return colors.HexColor(h)
    except Exception:
        return colors.black


def draw(c, e, H):
    x, w, h = float(e.get("x", 0)), float(e.get("w", 0)), float(e.get("h", 0))
    top = float(e.get("y", 0))
    y, t = H - top - h, e.get("t")
    if t in ("rect", "ellipse"):
        c.setFillColor(hexc(e.get("fill")))
        c.rect(x, y, w, h, stroke=0, fill=1) if t == "rect" else c.ellipse(x, y, x + w, y + h, stroke=0, fill=1)
    elif t == "img" and "," in e.get("src", ""):
        img = ImageReader(io.BytesIO(base64.b64decode(e["src"].split(",", 1)[1])))
        c.drawImage(img, x, y, w, h, mask="auto", preserveAspectRatio=True, anchor="c")
    elif t == "text":
        size = float(e.get("size", 24))
        fn = FM.get(e.get("font"), FM["sans"])[(1 if e.get("bold") else 0) + (2 if e.get("italic") else 0)]
        c.setFillColor(hexc(e.get("color")))
        c.setFont(fn, size)
        yy, al = H - top - size * 0.98, e.get("align", "left")
        for para in str(e.get("text", "")).split("\n"):
            for line in simpleSplit(para, fn, size, max(w, 1)) or [""]:
                if al == "center":
                    c.drawCentredString(x + w / 2, yy, line)
                elif al == "right":
                    c.drawRightString(x + w, yy, line)
                else:
                    c.drawString(x, yy, line)
                yy -= size * 1.25


@bp.post("/api/studio/export")
def export_deck():
    d = request.get_json(silent=True) or {}
    slides = d.get("slides") or []
    if not slides:
        return jsonify(error="The deck has no slides."), 400
    W, H = float(d.get("w", 960)), float(d.get("h", 540))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))
    c.setTitle(d.get("title") or "Presentation")
    for s in slides:
        c.linearGradient(0, H, 0, 0, (hexc(d.get("bg")), hexc(d.get("bg2"))))
        for e in s.get("els", []):
            draw(c, e, H)
        c.showPage()
    c.save()
    from app import send_bytes, safe_name
    name = safe_name((d.get("title") or "presentation")).replace(" ", "_") + ".pdf"
    return send_bytes(buf.getvalue(), name, "application/pdf")
