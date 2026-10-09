"""
The Bindery — a local PDF workbench.

Run with:  python app.py
Then open the printed http://127.0.0.1:PORT address in your browser.

Every operation happens on your own machine. Files are processed in a
temporary folder and deleted again once the response has been sent.
"""

import io
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file
from pypdf import PdfReader, PdfWriter
from pypdf.errors import FileNotDecryptedError, PdfReadError
import pikepdf
from PIL import Image
import img2pdf
from pdf2image import convert_from_path

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200 MB per request

BASE_DIR = Path(__file__).parent

# Files are processed in the OS temp folder rather than inside the project
# directory. This matters on Windows: Poppler (used for PDF -> Images) is
# called as a subprocess and can fail to open files if any part of the path
# contains non-ASCII characters (e.g. a project folder living inside a
# OneDrive "Documents" folder with a non-English name). The system temp
# folder is reliably ASCII-safe.
WORK_DIR = Path(tempfile.gettempdir()) / "the-bindery-pdf-toolkit"
WORK_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

class ToolError(Exception):
    """Raised for any expected, user-facing failure."""


def safe_name(name: str) -> str:
    name = os.path.basename(name or "file.pdf")
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name)
    return name or "file.pdf"


def require_pdf(file_storage):
    if file_storage is None or file_storage.filename == "":
        raise ToolError("No file was uploaded.")
    if not file_storage.filename.lower().endswith(".pdf"):
        raise ToolError(f'"{file_storage.filename}" is not a PDF.')
    return file_storage


def open_reader(path, password=None):
    try:
        reader = PdfReader(path)
        if reader.is_encrypted:
            if password:
                result = reader.decrypt(password)
                if result == 0:
                    raise ToolError("That password didn't unlock the file.")
            else:
                raise ToolError(
                    "This PDF is password protected. Use Unlock PDF first, "
                    "or enter its password."
                )
        return reader
    except FileNotDecryptedError:
        raise ToolError("This PDF is password protected and the password given was incorrect.")
    except PdfReadError as e:
        raise ToolError(f"Couldn't read that PDF: {e}")


def parse_page_ranges(spec: str, page_count: int):
    """Parse '1,3,5-7' (1-indexed, inclusive) into a sorted list of 0-indexed pages."""
    if not spec or not spec.strip():
        return list(range(page_count))

    chosen = set()
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            a, b = chunk.split("-", 1)
            a, b = a.strip(), b.strip()
            if not a.isdigit() or not b.isdigit():
                raise ToolError(f'Bad page range: "{chunk}"')
            start, end = int(a), int(b)
            if start > end:
                start, end = end, start
            for p in range(start, end + 1):
                if 1 <= p <= page_count:
                    chosen.add(p - 1)
                else:
                    raise ToolError(f"Page {p} is out of range (this PDF has {page_count} pages).")
        else:
            if not chunk.isdigit():
                raise ToolError(f'Bad page number: "{chunk}"')
            p = int(chunk)
            if not (1 <= p <= page_count):
                raise ToolError(f"Page {p} is out of range (this PDF has {page_count} pages).")
            chosen.add(p - 1)
    return sorted(chosen)


def send_bytes(data: bytes, download_name: str, mimetype: str):
    return send_file(
        io.BytesIO(data),
        as_attachment=True,
        download_name=download_name,
        mimetype=mimetype,
    )


def zip_bytes(files: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files:
            zf.writestr(name, data)
    buf.seek(0)
    return buf.getvalue()


@app.errorhandler(ToolError)
def handle_tool_error(err):
    return jsonify({"error": str(err)}), 400


@app.errorhandler(413)
def handle_too_large(err):
    return jsonify({"error": "That file is larger than the 200 MB limit."}), 413


@app.errorhandler(Exception)
def handle_any_error(err):
    if isinstance(err, ToolError):
        return handle_tool_error(err)
    from werkzeug.exceptions import HTTPException
    if isinstance(err, HTTPException):
        return jsonify({"error": err.description}), err.code
    app.logger.exception("Unexpected error")
    return jsonify({"error": f"Something went wrong: {err}"}), 500


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# --------------------------------------------------------------------------
# Merge
# --------------------------------------------------------------------------

@app.route("/api/merge", methods=["POST"])
def merge():
    files = request.files.getlist("files")
    if len(files) < 2:
        raise ToolError("Pick at least two PDFs to merge.")

    writer = PdfWriter()
    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        for f in files:
            require_pdf(f)
            path = Path(tmp) / safe_name(f.filename)
            f.save(path)
            reader = open_reader(path, request.form.get("password"))
            for page in reader.pages:
                writer.add_page(page)

        out = io.BytesIO()
        writer.write(out)
        return send_bytes(out.getvalue(), "merged.pdf", "application/pdf")


# --------------------------------------------------------------------------
# Split
# --------------------------------------------------------------------------

@app.route("/api/split", methods=["POST"])
def split():
    file = require_pdf(request.files.get("file"))
    mode = request.form.get("mode", "all")  # all | range
    ranges = request.form.get("ranges", "")

    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        path = Path(tmp) / safe_name(file.filename)
        file.save(path)
        reader = open_reader(path, request.form.get("password"))
        count = len(reader.pages)

        if mode == "range":
            groups = [g.strip() for g in ranges.split(";") if g.strip()]
            if not groups:
                raise ToolError("Enter at least one page range, e.g. 1-3 or 1-3;4-6.")
            outputs = []
            for i, g in enumerate(groups, start=1):
                pages = parse_page_ranges(g, count)
                writer = PdfWriter()
                for p in pages:
                    writer.add_page(reader.pages[p])
                buf = io.BytesIO()
                writer.write(buf)
                outputs.append((f"part_{i}_{g.replace(',', '-')}.pdf", buf.getvalue()))
            if len(outputs) == 1:
                return send_bytes(outputs[0][1], outputs[0][0], "application/pdf")
            return send_bytes(zip_bytes(outputs), "split_parts.zip", "application/zip")

        # one PDF per page
        outputs = []
        for i in range(count):
            writer = PdfWriter()
            writer.add_page(reader.pages[i])
            buf = io.BytesIO()
            writer.write(buf)
            outputs.append((f"page_{i + 1}.pdf", buf.getvalue()))
        return send_bytes(zip_bytes(outputs), "split_pages.zip", "application/zip")


# --------------------------------------------------------------------------
# Extract text
# --------------------------------------------------------------------------

@app.route("/api/extract-text", methods=["POST"])
def extract_text():
    file = require_pdf(request.files.get("file"))
    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        path = Path(tmp) / safe_name(file.filename)
        file.save(path)
        reader = open_reader(path, request.form.get("password"))

        parts = []
        for i, page in enumerate(reader.pages, start=1):
            parts.append(f"--- Page {i} ---\n{page.extract_text() or ''}".rstrip())
        text = "\n\n".join(parts) + "\n"
        out_name = safe_name(file.filename).rsplit(".", 1)[0] + ".txt"
        return send_bytes(text.encode("utf-8"), out_name, "text/plain")


# --------------------------------------------------------------------------
# Page count / info
# --------------------------------------------------------------------------

@app.route("/api/info", methods=["POST"])
def info():
    file = require_pdf(request.files.get("file"))
    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        path = Path(tmp) / safe_name(file.filename)
        file.save(path)
        size_kb = path.stat().st_size / 1024

        try:
            reader = open_reader(path, request.form.get("password"))
        except ToolError as e:
            if "protected" in str(e):
                return jsonify({
                    "encrypted": True,
                    "size_kb": round(size_kb, 1),
                })
            raise

        page = reader.pages[0] if len(reader.pages) else None
        dims = None
        if page is not None:
            dims = {
                "width_pt": round(float(page.mediabox.width), 1),
                "height_pt": round(float(page.mediabox.height), 1),
            }
        meta = reader.metadata or {}
        return jsonify({
            "encrypted": bool(reader.is_encrypted),
            "pages": len(reader.pages),
            "size_kb": round(size_kb, 1),
            "page_size": dims,
            "title": (meta.title if meta and meta.title else None),
            "author": (meta.author if meta and meta.author else None),
        })


# --------------------------------------------------------------------------
# Rotate
# --------------------------------------------------------------------------

@app.route("/api/rotate", methods=["POST"])
def rotate():
    file = require_pdf(request.files.get("file"))
    angle = int(request.form.get("angle", "90"))
    ranges = request.form.get("ranges", "")
    if angle % 90 != 0:
        raise ToolError("Rotation must be a multiple of 90 degrees.")

    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        path = Path(tmp) / safe_name(file.filename)
        file.save(path)
        reader = open_reader(path, request.form.get("password"))
        count = len(reader.pages)
        targets = set(parse_page_ranges(ranges, count))

        writer = PdfWriter()
        for i, page in enumerate(reader.pages):
            if i in targets:
                page.rotate(angle)
            writer.add_page(page)

        out = io.BytesIO()
        writer.write(out)
        out_name = safe_name(file.filename).rsplit(".", 1)[0] + "_rotated.pdf"
        return send_bytes(out.getvalue(), out_name, "application/pdf")


# --------------------------------------------------------------------------
# Delete pages
# --------------------------------------------------------------------------

@app.route("/api/delete-pages", methods=["POST"])
def delete_pages():
    file = require_pdf(request.files.get("file"))
    ranges = request.form.get("ranges", "")
    if not ranges.strip():
        raise ToolError("Enter the pages to remove, e.g. 2,4-5.")

    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        path = Path(tmp) / safe_name(file.filename)
        file.save(path)
        reader = open_reader(path, request.form.get("password"))
        count = len(reader.pages)
        remove = set(parse_page_ranges(ranges, count))
        keep = [i for i in range(count) if i not in remove]

        if not keep:
            raise ToolError("That would remove every page — nothing would be left.")

        writer = PdfWriter()
        for i in keep:
            writer.add_page(reader.pages[i])

        out = io.BytesIO()
        writer.write(out)
        out_name = safe_name(file.filename).rsplit(".", 1)[0] + "_edited.pdf"
        return send_bytes(out.getvalue(), out_name, "application/pdf")


# --------------------------------------------------------------------------
# Extract images
# --------------------------------------------------------------------------

@app.route("/api/extract-images", methods=["POST"])
def extract_images():
    file = require_pdf(request.files.get("file"))
    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        path = Path(tmp) / safe_name(file.filename)
        file.save(path)
        reader = open_reader(path, request.form.get("password"))

        outputs = []
        for pnum, page in enumerate(reader.pages, start=1):
            for inum, img in enumerate(page.images, start=1):
                ext = Path(img.name).suffix or ".png"
                outputs.append((f"page{pnum}_image{inum}{ext}", img.data))

        if not outputs:
            raise ToolError("No embedded images were found in this PDF.")

        return send_bytes(zip_bytes(outputs), "extracted_images.zip", "application/zip")


# --------------------------------------------------------------------------
# Compress
# --------------------------------------------------------------------------

@app.route("/api/compress", methods=["POST"])
def compress():
    file = require_pdf(request.files.get("file"))
    level = request.form.get("level", "medium")  # light | medium | strong
    quality = {"light": 80, "medium": 55, "strong": 35}.get(level, 55)
    max_dim = {"light": 2200, "medium": 1600, "strong": 1100}.get(level, 1600)

    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        path = Path(tmp) / safe_name(file.filename)
        file.save(path)
        original_size = path.stat().st_size

        password = request.form.get("password")
        try:
            pdf = pikepdf.open(path, password=password or "")
        except pikepdf.PasswordError:
            raise ToolError("This PDF is password protected. Enter its password to compress it.")

        _recompress_images(pdf, quality=quality, max_dim=max_dim)

        out_path = Path(tmp) / "compressed.pdf"
        pdf.save(
            out_path,
            compress_streams=True,
            recompress_flate=True,
            object_stream_mode=pikepdf.ObjectStreamMode.generate,
            linearize=True,
        )
        pdf.close()

        data = out_path.read_bytes()
        new_size = len(data)
        out_name = safe_name(file.filename).rsplit(".", 1)[0] + "_compressed.pdf"
        resp = send_bytes(data, out_name, "application/pdf")
        resp.headers["X-Original-Size"] = str(original_size)
        resp.headers["X-New-Size"] = str(new_size)
        return resp


def _iter_images(pdf):
    for page in pdf.pages:
        if "/Resources" in page and "/XObject" in page.Resources:
            for key, xobj in page.Resources.XObject.items():
                if xobj.get("/Subtype") == "/Image":
                    yield xobj


def _recompress_images(pdf, quality=55, max_dim=1600):
    for xobj in _iter_images(pdf):
        try:
            pil_img = pikepdf.PdfImage(xobj).as_pil_image()
        except Exception:
            continue

        w, h = pil_img.size
        if max(w, h) > max_dim:
            scale = max_dim / max(w, h)
            pil_img = pil_img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

        if pil_img.mode in ("RGBA", "P"):
            pil_img = pil_img.convert("RGB")

        buf = io.BytesIO()
        pil_img.save(buf, format="JPEG", quality=quality, optimize=True)

        # Rewrite the image stream in place as a fresh JPEG (DCTDecode).
        xobj.write(buf.getvalue(), filter=pikepdf.Name("/DCTDecode"))
        xobj.ColorSpace = pikepdf.Name("/DeviceRGB")
        xobj.Width = pil_img.width
        xobj.Height = pil_img.height
        xobj.BitsPerComponent = 8
        if "/SMask" in xobj:
            del xobj["/SMask"]
        if "/Decode" in xobj:
            del xobj["/Decode"]


# --------------------------------------------------------------------------
# Images -> PDF
# --------------------------------------------------------------------------

@app.route("/api/images-to-pdf", methods=["POST"])
def images_to_pdf():
    files = request.files.getlist("files")
    if not files:
        raise ToolError("Add at least one image.")

    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        paths = []
        for f in files:
            if f.filename == "":
                continue
            ext = Path(f.filename).suffix.lower()
            if ext not in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"):
                raise ToolError(f'"{f.filename}" is not a supported image type.')
            p = Path(tmp) / safe_name(f.filename)
            f.save(p)
            if ext in (".webp", ".bmp", ".tiff"):
                converted = p.with_suffix(".png")
                Image.open(p).convert("RGB").save(converted)
                p = converted
            paths.append(str(p))

        if not paths:
            raise ToolError("Add at least one image.")

        pdf_bytes = img2pdf.convert(paths)
        return send_bytes(pdf_bytes, "images.pdf", "application/pdf")


# --------------------------------------------------------------------------
# PDF -> images
# --------------------------------------------------------------------------

@app.route("/api/pdf-to-images", methods=["POST"])
def pdf_to_images():
    file = require_pdf(request.files.get("file"))
    fmt = request.form.get("format", "png").lower()
    dpi = int(request.form.get("dpi", "150"))
    if fmt not in ("png", "jpg"):
        raise ToolError("Format must be png or jpg.")
    dpi = max(72, min(dpi, 400))

    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        path = Path(tmp) / safe_name(file.filename)
        file.save(path)

        password = request.form.get("password")
        try:
            images = convert_from_path(str(path), dpi=dpi, userpw=password or None)
        except Exception as e:
            msg = str(e)
            if "password" in msg.lower() or "encrypt" in msg.lower():
                raise ToolError("This PDF is password protected. Enter its password to convert it.")
            raise ToolError(f"Couldn't render this PDF: {e}")

        outputs = []
        pil_format = "PNG" if fmt == "png" else "JPEG"
        for i, img in enumerate(images, start=1):
            buf = io.BytesIO()
            if pil_format == "JPEG" and img.mode != "RGB":
                img = img.convert("RGB")
            img.save(buf, format=pil_format)
            outputs.append((f"page_{i}.{fmt}", buf.getvalue()))

        return send_bytes(zip_bytes(outputs), f"pages_{fmt}.zip", "application/zip")


# --------------------------------------------------------------------------
# PDF -> Word
# --------------------------------------------------------------------------

@app.route("/api/pdf-to-word", methods=["POST"])
def pdf_to_word():
    file = require_pdf(request.files.get("file"))

    try:
        from pdf2docx import Converter
    except ImportError:
        raise ToolError(
            "The pdf2docx package isn't installed. Run: "
            "pip install -r requirements.txt"
        )

    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        in_path = Path(tmp) / safe_name(file.filename)
        file.save(in_path)

        password = request.form.get("password")
        if password:
            # pdf2docx can't take a password directly; decrypt to a temp
            # copy first using pypdf, then hand that to the converter.
            reader = open_reader(in_path, password)
            writer = PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            decrypted_path = Path(tmp) / "decrypted.pdf"
            with open(decrypted_path, "wb") as f:
                writer.write(f)
            in_path = decrypted_path
        else:
            # Still validate it opens and isn't locked before we hand it off.
            open_reader(in_path)

        out_path = Path(tmp) / "converted.docx"
        try:
            cv = Converter(str(in_path))
            cv.convert(str(out_path))
            cv.close()
        except Exception as e:
            raise ToolError(f"Couldn't convert this PDF to Word: {e}")

        if not out_path.exists():
            raise ToolError("Conversion finished but produced no file.")

        out_name = safe_name(file.filename).rsplit(".", 1)[0] + ".docx"
        return send_bytes(
            out_path.read_bytes(),
            out_name,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )


# --------------------------------------------------------------------------
# Word -> PDF
# --------------------------------------------------------------------------

def _find_soffice():
    # 1. Explicit override — set this if none of the automatic checks find it.
    override = os.environ.get("SOFFICE_PATH")
    if override and os.path.exists(override):
        return override

    # 2. On PATH already.
    for name in ("soffice", "libreoffice"):
        path = shutil.which(name)
        if path:
            return path

    # 3. Common install locations, including versioned/renamed folders
    #    (e.g. "LibreOffice 7.6", a custom install drive, per-user installs).
    import glob
    patterns = [
        r"C:\Program Files\LibreOffice*\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice*\program\soffice.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\LibreOffice*\program\soffice.exe"),
        "/usr/bin/soffice",
        "/usr/local/bin/soffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ]
    for pattern in patterns:
        matches = glob.glob(pattern)
        if matches:
            return matches[0]

    # 4. Windows registry, in case it's installed somewhere entirely custom.
    if os.name == "nt":
        try:
            import winreg
            for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                for key_path in (
                    r"SOFTWARE\LibreOffice",
                    r"SOFTWARE\WOW6432Node\LibreOffice",
                ):
                    try:
                        with winreg.OpenKey(hive, key_path) as key:
                            install_dir, _ = winreg.QueryValueEx(key, "InstallDir")
                            candidate = os.path.join(install_dir, "program", "soffice.exe")
                            if os.path.exists(candidate):
                                return candidate
                    except OSError:
                        continue
        except ImportError:
            pass

    return None


@app.route("/api/diagnostics")
def diagnostics():
    soffice = _find_soffice()
    return jsonify({
        "soffice_found": bool(soffice),
        "soffice_path": soffice,
        "soffice_path_env_set": bool(os.environ.get("SOFFICE_PATH")),
    })


@app.route("/api/word-to-pdf", methods=["POST"])
def word_to_pdf():
    file = request.files.get("file")
    if file is None or file.filename == "":
        raise ToolError("No file was uploaded.")
    if not file.filename.lower().endswith((".docx", ".doc")):
        raise ToolError(f'"{file.filename}" is not a Word document.')

    soffice = _find_soffice()
    if not soffice:
        raise ToolError(
            "Couldn't find LibreOffice on this machine, which Word → PDF "
            "needs. If you've already installed it, find its soffice.exe "
            "(usually inside the LibreOffice install folder, in a "
            "'program' subfolder) and set it before starting the app, e.g. "
            "in PowerShell: $env:SOFFICE_PATH=\"C:\\path\\to\\soffice.exe\"; "
            "python app.py. Otherwise install it from "
            "https://www.libreoffice.org/download/download/ and restart the app."
        )

    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        in_path = Path(tmp) / safe_name(file.filename)
        file.save(in_path)

        out_dir = Path(tmp) / "out"
        out_dir.mkdir()

        try:
            result = subprocess.run(
                [soffice, "--headless", "--norestore", "--convert-to", "pdf",
                 "--outdir", str(out_dir), str(in_path)],
                capture_output=True, text=True, timeout=120,
            )
        except subprocess.TimeoutExpired:
            raise ToolError("Conversion timed out.")
        except Exception as e:
            raise ToolError(f"Couldn't run LibreOffice: {e}")

        out_path = out_dir / (in_path.stem + ".pdf")
        if result.returncode != 0 or not out_path.exists():
            detail = (result.stderr or result.stdout or "").strip()
            raise ToolError(f"Conversion failed: {detail or 'unknown error'}")

        out_name = safe_name(file.filename).rsplit(".", 1)[0] + ".pdf"
        return send_bytes(out_path.read_bytes(), out_name, "application/pdf")



# --------------------------------------------------------------------------
# Protect / Unlock
# --------------------------------------------------------------------------

@app.route("/api/protect", methods=["POST"])
def protect():
    file = require_pdf(request.files.get("file"))
    password = request.form.get("password", "")
    if not password:
        raise ToolError("Enter a password to protect the PDF with.")

    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        path = Path(tmp) / safe_name(file.filename)
        file.save(path)
        reader = open_reader(path)  # source must not already be locked

        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        writer.encrypt(password)

        out = io.BytesIO()
        writer.write(out)
        out_name = safe_name(file.filename).rsplit(".", 1)[0] + "_protected.pdf"
        return send_bytes(out.getvalue(), out_name, "application/pdf")


@app.route("/api/unlock", methods=["POST"])
def unlock():
    file = require_pdf(request.files.get("file"))
    password = request.form.get("password", "")
    if not password:
        raise ToolError("Enter the PDF's current password.")

    with tempfile.TemporaryDirectory(dir=WORK_DIR) as tmp:
        path = Path(tmp) / safe_name(file.filename)
        file.save(path)
        reader = PdfReader(path)
        if reader.is_encrypted:
            if reader.decrypt(password) == 0:
                raise ToolError("That password didn't unlock the file.")

        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)

        out = io.BytesIO()
        writer.write(out)
        out_name = safe_name(file.filename).rsplit(".", 1)[0] + "_unlocked.pdf"
        return send_bytes(out.getvalue(), out_name, "application/pdf")


# --------------------------------------------------------------------------
# Entrypoint
# --------------------------------------------------------------------------

from studio import bp as studio_bp
app.register_blueprint(studio_bp)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  The Bindery is running → http://127.0.0.1:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False)
