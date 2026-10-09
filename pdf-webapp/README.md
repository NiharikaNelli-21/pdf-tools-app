# The Bindery — a local PDF workbench

A small Flask app with a browser UI that runs entirely on your own machine.
Nothing is uploaded anywhere else — files are processed in a temp folder and
deleted again once each response is sent.

## Tools included

- **Organize** — Merge PDFs, Split PDF (all pages or custom ranges), Delete pages, Rotate pages
- **Convert** — PDF → Images, Images → PDF, PDF → Word, Word → PDF, Extract text, Extract images
- **Protect** — Add password, Remove password
- **Optimize & inspect** — Compress PDF, Page info

## 1. Install

You need Python 3.9+ (3.11 or 3.12 recommended — very new releases like 3.14
may lack pre-built wheels for some dependencies).

Two system tools are used for specific conversions — everything else works without them:

- **Poppler** — needed only for **PDF → Images**
- **LibreOffice** — needed only for **Word → PDF**

```bash
# Windows (using Chocolatey)
choco install poppler
choco install libreoffice

# macOS
brew install poppler
brew install --cask libreoffice

# Debian/Ubuntu
sudo apt-get install poppler-utils libreoffice
```

LibreOffice can also be downloaded directly from [libreoffice.org](https://www.libreoffice.org/download/download/).

**PDF → Word** doesn't need either of these — it uses the `pdf2docx` Python
package instead, which installs with everything else in the next step.

Then, from this folder:

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

If you skip Poppler, every tool still works except **PDF → Images**.
If you skip LibreOffice, every tool still works except **Word → PDF**.

## 2. Run

```bash
python app.py
```

Your terminal will print something like:

```
The Bindery is running → http://127.0.0.1:5000
```

Open that address in your browser. To use a different port:

```bash
PORT=8000 python app.py        # Windows (PowerShell): $env:PORT=8000; python app.py
```

## 3. Use it

Pick a tool from the left rack, drop in your file(s), set any options, and
click the action button. The result downloads straight from your browser —
it's never written anywhere but your own Downloads folder.

## Notes

- Max upload size is 200 MB per request (edit `MAX_CONTENT_LENGTH` in `app.py` to change it).
- The dev server printed by `python app.py` is fine for personal, local use.
  It isn't meant to be exposed to the internet.

## Templates & Studio (new)

- **Templates** — a waterfall (masonry) gallery of page themes in different shapes
  (16:9, 4:3, A4 portrait, square). Click **+ New template** to design one, **Edit** to
  change any template's colours, fonts, decoration and format, or **Duplicate** to
  start from an existing one. Built-ins can be **reset to original**; your changes are
  stored in `data/templates.json`.
- **Studio** — build PowerPoint-style decks: add/duplicate/reorder slides, drag and
  resize text, shapes and images, switch template at any time, save/open decks as
  `.bindery.json`, and **Export PDF** (vector text via ReportLab). Decks autosave in
  your browser. PDF export uses the standard PDF fonts (sans/serif/mono, Latin text).
