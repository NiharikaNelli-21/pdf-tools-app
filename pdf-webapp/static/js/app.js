(() => {
  "use strict";

  const TOOLS = {
    merge: {
      group: "Organize", title: "Merge PDFs",
      desc: "Combine two or more PDFs into one file, in the order you drop them.",
      endpoint: "/api/merge", multiple: true, accept: ".pdf", minFiles: 2,
      dzHint: "Drop 2 or more PDFs — order matters",
      runLabel: "Merge files",
      options: [],
      resultKind: "file",
    },
    split: {
      group: "Organize", title: "Split PDF",
      desc: "Break a PDF into single pages, or pull out chosen page ranges.",
      endpoint: "/api/split", multiple: false, accept: ".pdf",
      dzHint: "Drop one PDF",
      runLabel: "Split PDF",
      options: [
        { type: "seg", key: "mode", label: "Split into", choices: [["all", "Every page"], ["range", "Custom ranges"]], default: "all" },
        { type: "text", key: "ranges", label: "Page ranges", placeholder: "e.g. 1-3;4-6", hint: "Separate parts with ; — each part can be a range like 1-3", showIf: { mode: "range" } },
      ],
      resultKind: "file",
    },
    delete: {
      group: "Organize", title: "Delete pages",
      desc: "Remove specific pages from a PDF.",
      endpoint: "/api/delete-pages", multiple: false, accept: ".pdf",
      dzHint: "Drop one PDF",
      runLabel: "Remove pages",
      options: [
        { type: "text", key: "ranges", label: "Pages to remove", placeholder: "e.g. 2,4-5", hint: "Comma-separate pages or ranges" },
      ],
      resultKind: "file",
    },
    rotate: {
      group: "Organize", title: "Rotate pages",
      desc: "Turn pages 90°, 180°, or 270°  — all pages or a chosen range.",
      endpoint: "/api/rotate", multiple: false, accept: ".pdf",
      dzHint: "Drop one PDF",
      runLabel: "Rotate pages",
      options: [
        { type: "seg", key: "angle", label: "Rotation", choices: [["90", "90°"], ["180", "180°"], ["270", "270°"]], default: "90" },
        { type: "text", key: "ranges", label: "Pages to rotate", placeholder: "leave blank for all pages", hint: "Comma-separate pages or ranges, e.g. 1,3-4" },
      ],
      resultKind: "file",
    },
    pdf2img: {
      group: "Convert", title: "PDF → Images",
      desc: "Render each page of a PDF as a PNG or JPG image.",
      endpoint: "/api/pdf-to-images", multiple: false, accept: ".pdf",
      dzHint: "Drop one PDF",
      runLabel: "Convert pages",
      options: [
        { type: "seg", key: "format", label: "Image format", choices: [["png", "PNG"], ["jpg", "JPG"]], default: "png" },
        { type: "range", key: "dpi", label: "Resolution", min: 72, max: 400, step: 1, default: 150, unit: " dpi" },
        { type: "password", key: "password", label: "PDF password", placeholder: "only if the PDF is locked", optional: true },
      ],
      resultKind: "file",
    },
    img2pdf: {
      group: "Convert", title: "Images → PDF",
      desc: "Stack JPGs, PNGs, or screenshots into a single PDF, in the order you drop them.",
      endpoint: "/api/images-to-pdf", multiple: true, accept: "image/*",
      dzHint: "Drop one or more images",
      runLabel: "Build PDF",
      options: [],
      resultKind: "file",
    },
    "extract-text": {
      group: "Convert", title: "Extract text",
      desc: "Pull the text content out of a PDF into a plain .txt file.",
      endpoint: "/api/extract-text", multiple: false, accept: ".pdf",
      dzHint: "Drop one PDF",
      runLabel: "Extract text",
      options: [
        { type: "password", key: "password", label: "PDF password", placeholder: "only if the PDF is locked", optional: true },
      ],
      resultKind: "file",
    },
    "extract-images": {
      group: "Convert", title: "Extract images",
      desc: "Pull the embedded images out of a PDF and download them as a zip.",
      endpoint: "/api/extract-images", multiple: false, accept: ".pdf",
      dzHint: "Drop one PDF",
      runLabel: "Extract images",
      options: [
        { type: "password", key: "password", label: "PDF password", placeholder: "only if the PDF is locked", optional: true },
      ],
      resultKind: "file",
    },
    "pdf2word": {
      group: "Convert", title: "PDF → Word",
      desc: "Convert a PDF into an editable .docx Word document.",
      endpoint: "/api/pdf-to-word", multiple: false, accept: ".pdf",
      dzHint: "Drop one PDF",
      runLabel: "Convert to Word",
      options: [
        { type: "password", key: "password", label: "PDF password", placeholder: "only if the PDF is locked", optional: true },
      ],
      resultKind: "file",
    },
    "word2pdf": {
      group: "Convert", title: "Word → PDF",
      desc: "Convert a .docx or .doc file into a PDF. Requires LibreOffice to be installed.",
      endpoint: "/api/word-to-pdf", multiple: false, accept: ".doc,.docx",
      dzHint: "Drop one Word document",
      runLabel: "Convert to PDF",
      options: [],
      resultKind: "file",
    },
    protect: {
      group: "Protect", title: "Add password",
      desc: "Lock a PDF with a password so it can't be opened without it.",
      endpoint: "/api/protect", multiple: false, accept: ".pdf",
      dzHint: "Drop one PDF",
      runLabel: "Protect PDF",
      options: [
        { type: "password", key: "password", label: "New password", placeholder: "set a password" },
      ],
      resultKind: "file",
    },
    unlock: {
      group: "Protect", title: "Remove password",
      desc: "Unlock a PDF you already know the password for.",
      endpoint: "/api/unlock", multiple: false, accept: ".pdf",
      dzHint: "Drop one locked PDF",
      runLabel: "Unlock PDF",
      options: [
        { type: "password", key: "password", label: "Current password", placeholder: "enter the PDF's password" },
      ],
      resultKind: "file",
    },
    compress: {
      group: "Optimize & inspect", title: "Compress PDF",
      desc: "Shrink file size by recompressing the images inside a PDF.",
      endpoint: "/api/compress", multiple: false, accept: ".pdf",
      dzHint: "Drop one PDF",
      runLabel: "Compress PDF",
      options: [
        { type: "seg", key: "level", label: "Compression", choices: [["light", "Light"], ["medium", "Medium"], ["strong", "Strong"]], default: "medium" },
        { type: "password", key: "password", label: "PDF password", placeholder: "only if the PDF is locked", optional: true },
      ],
      resultKind: "file-compare",
    },
    info: {
      group: "Optimize & inspect", title: "Page info",
      desc: "Check page count, file size, and document details.",
      endpoint: "/api/info", multiple: false, accept: ".pdf",
      dzHint: "Drop one PDF",
      runLabel: "Inspect PDF",
      options: [
        { type: "password", key: "password", label: "PDF password", placeholder: "only if the PDF is locked", optional: true },
      ],
      resultKind: "json",
    },
  };

  const $ = (id) => document.getElementById(id);
  const dropzone = $("dropzone"), fileInput = $("file-input"), fileListEl = $("file-list"),
        optionsEl = $("options"), runBtn = $("run-btn"), runStatus = $("run-status"),
        resultEl = $("result"), dzHint = $("dz-hint"), toolEyebrow = $("tool-eyebrow"),
        toolTitle = $("tool-title"), toolDesc = $("tool-desc");

  let currentTool = "merge";
  let files = [];
  let optionValues = {};

  document.getElementById("origin-note").textContent = window.location.origin;

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function selectTool(key) {
    currentTool = key;
    files = [];
    const t = TOOLS[key];
    optionValues = {};
    t.options.forEach(o => { if (o.default !== undefined) optionValues[o.key] = String(o.default); });

    document.querySelectorAll(".tool-btn").forEach(b => b.classList.toggle("is-active", b.dataset.tool === key));
    toolEyebrow.textContent = t.group;
    toolTitle.textContent = t.title;
    toolDesc.textContent = t.desc;
    dzHint.textContent = t.dzHint;
    fileInput.accept = t.accept;
    fileInput.multiple = !!t.multiple;
    runBtn.textContent = t.runLabel;
    resultEl.hidden = true;
    resultEl.innerHTML = "";
    runStatus.textContent = "";
    runStatus.className = "run-status";
    renderFileList();
    renderOptions();
  }

  function renderFileList() {
    fileListEl.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.className = "file-chip";
      li.innerHTML = `<span class="name">${i + 1}. ${escapeHtml(f.name)}</span>
                      <span class="size">${fmtSize(f.size)}</span>
                      <button class="remove" aria-label="Remove file" data-idx="${i}">✕</button>`;
      fileListEl.appendChild(li);
    });
    fileListEl.querySelectorAll(".remove").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        files.splice(idx, 1);
        renderFileList();
      });
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderOptions() {
    const t = TOOLS[currentTool];
    optionsEl.innerHTML = "";
    t.options.forEach((o) => {
      if (o.showIf) {
        const [depKey, depVal] = Object.entries(o.showIf)[0];
        if (optionValues[depKey] !== depVal) return;
      }
      const wrap = document.createElement("div");
      wrap.className = "field";

      if (o.type === "seg") {
        const label = document.createElement("label");
        label.textContent = o.label;
        wrap.appendChild(label);
        const seg = document.createElement("div");
        seg.className = "seg";
        o.choices.forEach(([val, text]) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = text;
          b.classList.toggle("is-on", optionValues[o.key] === val);
          b.addEventListener("click", () => {
            optionValues[o.key] = val;
            renderOptions();
          });
          seg.appendChild(b);
        });
        wrap.appendChild(seg);
      } else if (o.type === "range") {
        const label = document.createElement("label");
        label.textContent = o.label;
        wrap.appendChild(label);
        const row = document.createElement("div");
        row.className = "range-slider";
        const input = document.createElement("input");
        input.type = "range";
        input.min = o.min; input.max = o.max; input.step = o.step;
        input.value = optionValues[o.key] ?? o.default;
        const val = document.createElement("span");
        val.className = "val";
        val.textContent = input.value + (o.unit || "");
        input.addEventListener("input", () => {
          optionValues[o.key] = input.value;
          val.textContent = input.value + (o.unit || "");
        });
        row.appendChild(input); row.appendChild(val);
        wrap.appendChild(row);
      } else {
        const label = document.createElement("label");
        label.textContent = o.label;
        wrap.appendChild(label);
        const input = document.createElement("input");
        input.type = o.type === "password" ? "password" : "text";
        input.placeholder = o.placeholder || "";
        input.value = optionValues[o.key] ?? (o.default || "");
        input.addEventListener("input", () => { optionValues[o.key] = input.value; });
        wrap.appendChild(input);
        if (o.hint) {
          const hint = document.createElement("span");
          hint.className = "hint";
          hint.textContent = o.hint;
          wrap.appendChild(hint);
        }
      }
      optionsEl.appendChild(wrap);
    });
  }

  function addFiles(list) {
    const t = TOOLS[currentTool];
    const incoming = Array.from(list);
    if (!t.multiple) files = [];
    files.push(...incoming);
    renderFileList();
  }

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  fileInput.addEventListener("change", () => addFiles(fileInput.files));

  ["dragenter", "dragover"].forEach(ev =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("is-drag"); }));
  ["dragleave", "drop"].forEach(ev =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("is-drag"); }));
  dropzone.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

  document.querySelectorAll(".tool-btn").forEach(btn => {
    btn.addEventListener("click", () => selectTool(btn.dataset.tool));
  });

  function filenameFromDisposition(cd, fallback) {
    if (!cd) return fallback;
    const m = /filename="?([^"]+)"?/.exec(cd);
    return m ? m[1] : fallback;
  }

  async function run() {
    const t = TOOLS[currentTool];
    if (files.length === 0) {
      runStatus.textContent = "Add a file first.";
      runStatus.className = "run-status is-error";
      return;
    }
    if (t.minFiles && files.length < t.minFiles) {
      runStatus.textContent = `Add at least ${t.minFiles} files.`;
      runStatus.className = "run-status is-error";
      return;
    }

    const fd = new FormData();
    if (t.multiple) {
      files.forEach(f => fd.append("files", f));
    } else {
      fd.append("file", files[0]);
    }
    Object.entries(optionValues).forEach(([k, v]) => fd.append(k, v));

    runBtn.disabled = true;
    runStatus.textContent = "Working…";
    runStatus.className = "run-status";
    resultEl.hidden = true;

    try {
      const res = await fetch(t.endpoint, { method: "POST", body: fd });

      if (!res.ok) {
        let msg = "Something went wrong.";
        try { msg = (await res.json()).error || msg; } catch (_) {}
        runStatus.textContent = msg;
        runStatus.className = "run-status is-error";
        return;
      }

      runStatus.textContent = "Done.";

      if (t.resultKind === "json") {
        const data = await res.json();
        showInfoResult(data, files[0]);
      } else if (t.resultKind === "file-compare") {
        const origSize = Number(res.headers.get("X-Original-Size") || 0);
        const newSize = Number(res.headers.get("X-New-Size") || 0);
        const blob = await res.blob();
        const cd = res.headers.get("Content-Disposition");
        const name = filenameFromDisposition(cd, "compressed.pdf");
        showFileResult(blob, name, { origSize, newSize });
      } else {
        const blob = await res.blob();
        const cd = res.headers.get("Content-Disposition");
        const name = filenameFromDisposition(cd, "result");
        showFileResult(blob, name);
      }
    } catch (err) {
      runStatus.textContent = "Couldn't reach the server: " + err.message;
      runStatus.className = "run-status is-error";
    } finally {
      runBtn.disabled = false;
    }
  }

  function showFileResult(blob, filename, compare) {
    const url = URL.createObjectURL(blob);
    resultEl.hidden = false;
    let compareHtml = "";
    if (compare) {
      const pct = compare.origSize > 0 ? Math.round((1 - compare.newSize / compare.origSize) * 100) : 0;
      compareHtml = `<div class="size-compare">
        <span>${fmtSize(compare.origSize)}</span>
        <span class="arrow">→</span>
        <span class="new">${fmtSize(compare.newSize)}</span>
        ${pct > 0 ? `<span class="pct">−${pct}%</span>` : ""}
      </div>`;
    }
    resultEl.innerHTML = `<div class="result-card">
        <h3>Ready</h3>
        <p>${escapeHtml(filename)}</p>
        ${compareHtml}
        <a class="download-btn" href="${url}" download="${escapeHtml(filename)}">Download ${escapeHtml(filename)}</a>
      </div>`;
  }

  function showInfoResult(data, file) {
    resultEl.hidden = false;
    if (data.encrypted && data.pages === undefined) {
      resultEl.innerHTML = `<div class="result-card">
        <h3>Password protected</h3>
        <p>This PDF is locked. Its file size is ${fmtSize(data.size_kb * 1024)}. Enter its password above to see more.</p>
      </div>`;
      return;
    }
    resultEl.innerHTML = `<div class="result-card">
      <h3>${escapeHtml(file.name)}</h3>
      <dl class="info-grid">
        <div><dt>Pages</dt><dd>${data.pages}</dd></div>
        <div><dt>File size</dt><dd>${fmtSize(data.size_kb * 1024)}</dd></div>
        <div><dt>Page size</dt><dd>${data.page_size ? `${data.page_size.width_pt} × ${data.page_size.height_pt} pt` : "—"}</dd></div>
        <div><dt>Encrypted</dt><dd>${data.encrypted ? "Yes" : "No"}</dd></div>
        <div><dt>Title</dt><dd>${data.title ? escapeHtml(data.title) : "—"}</dd></div>
        <div><dt>Author</dt><dd>${data.author ? escapeHtml(data.author) : "—"}</dd></div>
      </dl>
    </div>`;
  }

  runBtn.addEventListener("click", run);

  selectTool("merge");
})();
