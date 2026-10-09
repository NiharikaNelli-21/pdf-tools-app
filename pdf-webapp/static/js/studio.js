(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FONTS = { sans: "Inter, Helvetica, Arial, sans-serif", serif: "Georgia, 'Times New Roman', serif", mono: "'JetBrains Mono', Courier, monospace" };
  const RATIOS = { "16:9": [960, 540], "4:3": [800, 600], "A4 portrait": [595, 842], "Square": [700, 700] };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let templates = [], deck = null, cur = 0, selId = null, edit = null;

  const api = async (url, opt) => { const r = await fetch(url, opt); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Request failed"); return j; };
  const post = (u, b, m = "POST") => api(u, { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const persist = () => { try { localStorage.setItem("bindery-deck", JSON.stringify(deck)); } catch (_) {} };

  /* ---------- rendering shared by gallery, thumbnails and editor ---------- */
  function decoEls(t) {
    const W = t.w, H = t.h, b = Math.min(W, H) * 0.012, r = (x, y, w, h) => ({ id: "d", t: "rect", x, y, w, h, fill: t.ac });
    return ({ bar: [r(0, 0, W, H * 0.03)], side: [r(0, 0, W * 0.03, H)], band: [r(0, H * 0.94, W, H * 0.06)],
      frame: [r(18, 18, W - 36, b), r(18, H - 18 - b, W - 36, b), r(18, 18, b, H - 36), r(W - 18 - b, 18, b, H - 36)] })[t.deco] || [];
  }

  function layoutEls(kind, t) {
    const W = t.w, H = t.h, m = W * 0.08, u = Math.min(W, H) / 540;
    const mk = (role, x, y, w, h, text, size, align) => ({ id: uid(), t: "text", role, x, y, w, h, text, size: Math.round(size * u), align: align || "left",
      font: role === "h" ? t.hf : t.bf, color: role === "h" ? t.hc : t.tc, bold: role === "h", italic: false });
    const bul = "• First point\n• Second point\n• Third point";
    if (kind === "title") return [mk("h", m, H * 0.33, W - 2 * m, H * 0.2, "Presentation title", 48, "center"), mk("b", m, H * 0.56, W - 2 * m, H * 0.1, "Subtitle or author", 22, "center")];
    if (kind === "content") return [mk("h", m, H * 0.08, W - 2 * m, H * 0.14, "Slide title", 34), mk("b", m, H * 0.27, W - 2 * m, H * 0.6, bul, 22)];
    if (kind === "two") { const cw = (W - 3 * m) / 2; return [mk("h", m, H * 0.08, W - 2 * m, H * 0.14, "Slide title", 34), mk("b", m, H * 0.27, cw, H * 0.6, bul, 20), mk("b", 2 * m + cw, H * 0.27, cw, H * 0.6, bul, 20)]; }
    return [];
  }

  function elDom(e, s, inter) {
    const n = document.createElement("div");
    n.className = "el"; n.dataset.id = e.id;
    n.style.cssText = `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;`;
    if (e.t === "text") {
      Object.assign(n.style, { fontFamily: FONTS[e.font], fontSize: e.size + "px", color: e.color, fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? "italic" : "normal", textAlign: e.align });
      n.textContent = e.text;
    } else if (e.t === "img") n.innerHTML = `<img src="${e.src}" alt="">`;
    else { n.style.background = e.fill; if (e.t === "ellipse") n.style.borderRadius = "50%"; }
    if (inter) {
      n.classList.toggle("sel", e.id === selId);
      n.onpointerdown = (ev) => drag(ev, e, n, s, "move");
      if (e.id === selId) { const h = document.createElement("i"); h.className = "hd"; h.onpointerdown = (ev) => drag(ev, e, n, s, "size"); n.append(h); }
    }
    return n;
  }

  function scaled(t, els, s, inter) {
    const w = document.createElement("div"); w.className = "sw";
    w.style.width = t.w * s + "px"; w.style.height = t.h * s + "px";
    const d = document.createElement("div"); d.className = "slide";
    d.style.cssText = `width:${t.w}px;height:${t.h}px;transform:scale(${s});background:linear-gradient(180deg,${t.bg},${t.bg2 || t.bg})`;
    decoEls(t).forEach((e) => d.append(elDom(e, s, false)));
    els.forEach((e) => d.append(elDom(e, s, inter)));
    w.append(d); return w;
  }

  /* ---------- views ---------- */
  function view(v) {
    document.querySelector(".app-body").hidden = v !== "tools";
    $("#view-templates").hidden = v !== "templates"; $("#view-studio").hidden = v !== "studio";
    document.querySelectorAll(".views button").forEach((b) => b.classList.toggle("is-on", b.dataset.view === v));
    if (v === "templates") gallery(); if (v === "studio") studio();
  }

  /* ---------- Templates: waterfall gallery + editor ---------- */
  function gallery() {
    const w = $("#waterfall"); w.innerHTML = "";
    const add = document.createElement("article"); add.className = "tcard new"; add.textContent = "+ New template";
    add.onclick = () => openEdit({ ...templates[0], id: uid(), name: "New template", builtin: false }, true); w.append(add);
    templates.forEach((t) => {
      const c = document.createElement("article"); c.className = "tcard";
      const els = layoutEls("title", t); els[0].text = t.name;
      c.append(scaled(t, els, Math.min(216 / t.w, 260 / t.h)));
      const f = document.createElement("div"); f.className = "tfoot";
      f.innerHTML = `<b>${esc(t.name)}</b><span>${esc(t.ratio)}${t.builtin ? " · built-in" : ""}</span><button data-a="use">Use</button><button data-a="edit">Edit</button><button data-a="dup">Duplicate</button>`;
      f.onclick = (e) => { const a = e.target.dataset.a;
        if (a === "use") { applyTheme(t); view("studio"); }
        if (a === "edit") openEdit(t, false);
        if (a === "dup") openEdit({ ...t, id: uid(), name: t.name + " copy", builtin: false }, true); };
      c.append(f); w.append(c);
    });
  }

  function openEdit(t, isNew) {
    edit = { ...t }; const d = $("#tpl-dlg");
    const inp = (k, l, ty = "text") => `<label>${l}<input type="${ty}" data-k="${k}" value="${esc(edit[k])}"></label>`;
    const sel = (k, l, o) => `<label>${l}<select data-k="${k}">${o.map((x) => `<option ${edit[k] === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>`;
    d.innerHTML = `<div class="dlg"><h3>${isNew ? "New" : "Edit"} template</h3><div class="dlg-body"><div>
      ${inp("name", "Name")}${sel("ratio", "Page format", Object.keys(RATIOS))}${inp("bg", "Background (top)", "color")}${inp("bg2", "Background (bottom)", "color")}
      ${inp("hc", "Heading colour", "color")}${inp("tc", "Text colour", "color")}${inp("ac", "Accent colour", "color")}
      ${sel("hf", "Heading font", Object.keys(FONTS))}${sel("bf", "Body font", Object.keys(FONTS))}${sel("deco", "Decoration", ["none", "bar", "side", "band", "frame"])}
      </div><div class="dlg-prev" id="dprev"></div></div>
      <div class="dlg-act"><button id="d-save" class="btn">Save template</button>${isNew ? "" : `<button id="d-del">${t.builtin ? "Reset to original" : "Delete"}</button>`}<button id="d-x">Cancel</button></div></div>`;
    const prev = () => { const p = $("#dprev"); p.innerHTML = ""; p.append(scaled(edit, layoutEls("content", edit), Math.min(300 / edit.w, 320 / edit.h))); };
    d.oninput = (e) => { const k = e.target.dataset.k; if (!k) return; edit[k] = e.target.value; if (k === "ratio") [edit.w, edit.h] = RATIOS[edit.ratio]; prev(); };
    $("#d-x").onclick = () => d.close();
    $("#d-save").onclick = async () => { try { templates = await post("/api/templates", edit); d.close(); gallery(); } catch (e) { alert(e.message); } };
    if (!isNew) $("#d-del").onclick = async () => { try { templates = await api("/api/templates/" + edit.id, { method: "DELETE" }); d.close(); gallery(); } catch (e) { alert(e.message); } };
    prev(); d.showModal();
  }

  function applyTheme(t) {
    const o = deck.theme, sx = t.w / o.w, sy = t.h / o.h, u = Math.min(sx, sy);
    deck.slides.forEach((s) => s.els.forEach((e) => {
      e.x *= sx; e.w *= sx; e.y *= sy; e.h *= sy;
      if (e.t === "text") { e.size = Math.round(e.size * u); if (e.role) { e.font = e.role === "h" ? t.hf : t.bf; e.color = e.role === "h" ? t.hc : t.tc; } }
    }));
    deck.theme = { ...t }; persist();
  }

  /* ---------- Studio editor ---------- */
  const curEl = () => deck.slides[cur].els.find((e) => e.id === selId);
  const refresh = () => { persist(); thumbs(); canvas(); inspector(); };

  function studio() {
    $("#deck-tpl").innerHTML = templates.map((t) => `<option value="${esc(t.id)}" ${t.id === deck.theme.id ? "selected" : ""}>${esc(t.name)}</option>`).join("");
    $("#deck-title").value = deck.title; thumbs(); canvas(); inspector();
  }

  function thumbs() {
    const box = $("#thumbs"); box.innerHTML = ""; const s = 140 / deck.theme.w;
    deck.slides.forEach((sl, i) => {
      const d = document.createElement("div"); d.className = "thumb" + (i === cur ? " on" : "");
      d.append(scaled(deck.theme, sl.els, s)); d.insertAdjacentHTML("beforeend", `<span>${i + 1}</span>`);
      d.onclick = () => { cur = i; selId = null; thumbs(); canvas(); inspector(); }; box.append(d);
    });
  }

  function canvas() {
    const th = deck.theme, st = $("#stage"); st.innerHTML = "";
    const sc = Math.max(0.2, Math.min((st.clientWidth - 24) / th.w, (window.innerHeight - 230) / th.h, 1.4));
    st.append(scaled(th, deck.slides[cur].els, sc, true));
  }

  function drag(ev, e, n, s, mode) {
    ev.preventDefault(); ev.stopPropagation(); selId = e.id;
    const x0 = ev.clientX, y0 = ev.clientY, o = { x: e.x, y: e.y, w: e.w, h: e.h };
    const mv = (m) => { const dx = (m.clientX - x0) / s, dy = (m.clientY - y0) / s;
      if (mode === "move") { e.x = o.x + dx; e.y = o.y + dy; } else { e.w = Math.max(20, o.w + dx); e.h = Math.max(20, o.h + dy); }
      n.style.left = e.x + "px"; n.style.top = e.y + "px"; n.style.width = e.w + "px"; n.style.height = e.h + "px"; };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); refresh(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  function inspector() {
    const p = $("#inspector"), e = curEl();
    if (!e) { p.innerHTML = `<p class="muted">Select an element to edit it. Drag to move, pull the corner square to resize. Add shapes, text and images from the toolbar.</p>`; return; }
    const num = (k, l) => `<label>${l}<input type="number" data-k="${k}" value="${Math.round(e[k])}"></label>`;
    let h = `<h4>${e.t}</h4>`;
    if (e.t === "text") h += `<label>Text<textarea data-k="text" rows="5">${esc(e.text)}</textarea></label>
      <div class="row">${num("size", "Size")}<label>Colour<input type="color" data-k="color" value="${e.color}"></label></div>
      <label>Font<select data-k="font">${Object.keys(FONTS).map((f) => `<option ${e.font === f ? "selected" : ""}>${f}</option>`).join("")}</select></label>
      <div class="row"><button data-t="bold" class="${e.bold ? "on" : ""}"><b>B</b></button><button data-t="italic" class="${e.italic ? "on" : ""}"><i>I</i></button>
      ${["left", "center", "right"].map((a) => `<button data-al="${a}" class="${e.align === a ? "on" : ""}">${a[0].toUpperCase()}</button>`).join("")}</div><br>`;
    else if (e.t !== "img") h += `<label>Fill<input type="color" data-k="fill" value="${e.fill}"></label>`;
    h += `<div class="row">${num("x", "X")}${num("y", "Y")}</div><div class="row">${num("w", "W")}${num("h", "H")}</div>
      <div class="row"><button data-z="front">Front</button><button data-z="back">Back</button><button data-z="del" class="danger">Delete</button></div>`;
    p.innerHTML = h;
  }

  $("#inspector").addEventListener("input", (ev) => {
    const e = curEl(), k = ev.target.dataset.k; if (!e || !k) return;
    if (ev.target.type === "number") { const v = parseFloat(ev.target.value); if (isNaN(v)) return; e[k] = v; } else e[k] = ev.target.value;
    persist(); thumbs(); canvas();
  });
  $("#inspector").addEventListener("click", (ev) => {
    const e = curEl(), b = ev.target.closest("button"); if (!e || !b) return; const els = deck.slides[cur].els;
    if (b.dataset.t) e[b.dataset.t] = !e[b.dataset.t];
    if (b.dataset.al) e.align = b.dataset.al;
    if (b.dataset.z === "front") els.push(els.splice(els.indexOf(e), 1)[0]);
    if (b.dataset.z === "back") els.unshift(els.splice(els.indexOf(e), 1)[0]);
    if (b.dataset.z === "del") { els.splice(els.indexOf(e), 1); selId = null; }
    refresh();
  });
  $("#stage").addEventListener("pointerdown", (ev) => { if (!ev.target.closest(".el")) { selId = null; canvas(); inspector(); } });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Delete" && selId && !$("#view-studio").hidden && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const els = deck.slides[cur].els; els.splice(els.indexOf(curEl()), 1); selId = null; refresh(); }
  });
  addEventListener("resize", () => { if (!$("#view-studio").hidden) canvas(); });

  /* toolbar: add elements */
  function addEl(kind, extra) {
    const th = deck.theme, u = Math.min(th.w, th.h) / 540, base = { id: uid(), x: th.w * 0.3, y: th.h * 0.35, role: "" };
    const e = kind === "text" ? { ...base, t: "text", w: th.w * 0.4, h: th.h * 0.15, text: "New text", size: Math.round(24 * u), color: th.tc, font: th.bf, bold: false, italic: false, align: "left" }
      : kind === "img" ? { ...base, t: "img", ...extra } : { ...base, t: kind, w: 160 * u, h: 160 * u, fill: th.ac };
    deck.slides[cur].els.push(e); selId = e.id; refresh();
  }
  document.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => b.dataset.add === "img" ? $("#img-in").click() : addEl(b.dataset.add));
  $("#img-in").onchange = (ev) => {
    const f = ev.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = () => { const im = new Image(); im.onload = () => { const w = Math.min(deck.theme.w * 0.5, im.width); addEl("img", { src: r.result, w, h: w * im.height / im.width }); }; im.src = r.result; };
    r.readAsDataURL(f); ev.target.value = "";
  };

  /* toolbar: slides */
  document.querySelectorAll("[data-slide]").forEach((b) => b.onclick = () => {
    const a = b.dataset.slide, S = deck.slides;
    if (a === "add") S.splice(++cur, 0, { els: layoutEls($("#lay").value, deck.theme) });
    if (a === "dup") { const c = clone(S[cur]); c.els.forEach((e) => e.id = uid()); S.splice(cur + 1, 0, c); cur++; }
    if (a === "del" && S.length > 1) { S.splice(cur, 1); cur = Math.min(cur, S.length - 1); }
    if (a === "up" && cur > 0) { [S[cur - 1], S[cur]] = [S[cur], S[cur - 1]]; cur--; }
    if (a === "down" && cur < S.length - 1) { [S[cur + 1], S[cur]] = [S[cur], S[cur + 1]]; cur++; }
    selId = null; refresh();
  });
  $("#deck-title").oninput = (e) => { deck.title = e.target.value; persist(); };
  $("#deck-tpl").onchange = (e) => { applyTheme(templates.find((t) => t.id === e.target.value)); selId = null; refresh(); };

  /* save / open / export */
  const dl = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };
  $("#deck-save").onclick = () => dl(new Blob([JSON.stringify(deck)], { type: "application/json" }), (deck.title || "deck") + ".bindery.json");
  $("#deck-open").onclick = () => $("#deck-in").click();
  $("#deck-in").onchange = async (ev) => {
    try { const d = JSON.parse(await ev.target.files[0].text()); if (!d.slides || !d.theme) throw 0; deck = d; cur = 0; selId = null; studio(); } catch (_) { alert("That isn't a valid deck file."); }
    ev.target.value = "";
  };
  $("#deck-export").onclick = async () => {
    const b = $("#deck-export"), th = deck.theme; b.disabled = true; b.textContent = "Exporting…";
    try {
      const r = await fetch("/api/studio/export", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ w: th.w, h: th.h, bg: th.bg, bg2: th.bg2 || th.bg, title: deck.title, slides: deck.slides.map((s) => ({ els: [...decoEls(th), ...s.els] })) }) });
      if (!r.ok) throw new Error((await r.json()).error); dl(await r.blob(), (deck.title || "presentation") + ".pdf");
    } catch (e) { alert(e.message); } finally { b.disabled = false; b.textContent = "Export PDF"; }
  };

  /* init */
  document.querySelectorAll(".views button").forEach((b) => b.onclick = () => view(b.dataset.view));
  api("/api/templates").then((ts) => {
    templates = ts;
    try { const d = JSON.parse(localStorage.getItem("bindery-deck")); if (d && d.slides && d.slides.length && d.theme) deck = d; } catch (_) {}
    if (!deck) deck = { title: "Untitled deck", theme: { ...ts[0] }, slides: [{ els: layoutEls("title", ts[0]) }, { els: layoutEls("content", ts[0]) }] };
  });
})();
