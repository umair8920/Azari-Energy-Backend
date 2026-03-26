(() => {
  "use strict";

  let socket = null;
  let jobId = null;
  let pollTimer = null;
  const files = new Map();
  const cfg = { confidence: 0.25, sliceSize: 640, overlap: 0.2 };
  const STORAGE_KEY = "azari-det-job";
  const POLL_MS = 2000;

  const $ = (s, ctx) => (ctx || document).querySelector(s);

  /* ── build UI skeleton ─────────────────────────────────────── */
  const buildUI = (root) => {
    root.innerHTML = [
      '<div class="space-y-4 mt-4">',

      '<div id="det-controls" class="rounded-box border border-base-300 bg-base-200/30 p-4">',
        '<div class="flex flex-wrap items-end gap-x-6 gap-y-3">',
          '<div class="form-control">',
            '<label class="label py-0"><span class="label-text text-xs font-medium">Confidence</span></label>',
            '<div class="flex items-center gap-2">',
              '<input type="range" id="det-conf" min="5" max="100" value="25" class="range range-primary range-xs w-28" step="5">',
              '<span id="det-conf-val" class="text-xs font-mono w-8">0.25</span>',
            '</div>',
          '</div>',
          '<div class="form-control">',
            '<label class="label py-0"><span class="label-text text-xs font-medium">SAHI Slice</span></label>',
            '<select id="det-slice" class="select select-bordered select-xs w-24">',
              '<option value="256">256px</option>',
              '<option value="512">512px</option>',
              '<option value="640" selected>640px</option>',
              '<option value="1024">1024px</option>',
            '</select>',
          '</div>',
          '<div class="form-control">',
            '<label class="label py-0"><span class="label-text text-xs font-medium">Overlap</span></label>',
            '<div class="flex items-center gap-2">',
              '<input type="range" id="det-overlap" min="10" max="50" value="20" class="range range-secondary range-xs w-28" step="5">',
              '<span id="det-overlap-val" class="text-xs font-mono w-8">0.20</span>',
            '</div>',
          '</div>',
        '</div>',
      '</div>',

      '<div id="det-progress" class="hidden rounded-box border border-base-300 bg-base-200/30 p-4">',
        '<div class="flex items-center justify-between mb-2">',
          '<span id="det-progress-text" class="text-sm font-medium">Detecting defects…</span>',
          '<span id="det-progress-pct" class="text-sm font-mono">0%</span>',
        '</div>',
        '<progress id="det-progress-bar" class="progress progress-primary w-full" value="0" max="100"></progress>',
      '</div>',

      '<div id="det-grid" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"></div>',

      '<div id="det-empty" class="rounded-box border border-base-300 bg-base-200/30 p-8 text-center text-sm text-base-content/70">',
        'Upload files above to start defect detection. Results appear here in real time.',
      '</div>',

      '</div>',
    ].join("");
    bindControls();
  };

  const bindControls = () => {
    const confR = $("#det-conf");
    const confV = $("#det-conf-val");
    if (confR) confR.addEventListener("input", () => {
      cfg.confidence = parseInt(confR.value, 10) / 100;
      confV.textContent = cfg.confidence.toFixed(2);
      refilterAll();
    });
    const sliceS = $("#det-slice");
    if (sliceS) sliceS.addEventListener("change", () => { cfg.sliceSize = parseInt(sliceS.value, 10); });
    const overR = $("#det-overlap");
    const overV = $("#det-overlap-val");
    if (overR) overR.addEventListener("input", () => {
      cfg.overlap = parseInt(overR.value, 10) / 100;
      overV.textContent = cfg.overlap.toFixed(2);
    });
  };

  /* ── card rendering ────────────────────────────────────────── */
  const ensureCard = (fid, fname, ftype) => {
    let card = $(`#det-card-${fid}`);
    if (card) return card;

    const empty = $("#det-empty");
    if (empty) empty.classList.add("hidden");
    const grid = $("#det-grid");
    if (!grid) return null;

    card = document.createElement("div");
    card.id = `det-card-${fid}`;
    card.className = "card card-compact bg-base-100 shadow-sm border border-base-300 overflow-hidden transition-all hover:shadow-md";
    card.dataset.fileId = fid;
    card.dataset.status = "queued";
    card.innerHTML = [
      '<figure class="relative aspect-video bg-base-200 overflow-hidden">',
        '<div class="det-ph absolute inset-0 flex flex-col items-center justify-center gap-1">',
          '<span class="loading loading-spinner loading-sm text-primary"></span>',
          '<span class="det-lbl text-[10px] text-base-content/60">Queued</span>',
          '<progress class="det-bar progress progress-primary w-3/4 h-1" value="0" max="100"></progress>',
        '</div>',
        '<img class="det-thumb hidden object-cover w-full h-full" loading="lazy" alt="' + fname + '">',
        '<div class="absolute top-1 left-1"><span class="badge badge-xs badge-neutral">' + (ftype === "video" ? "VID" : "IMG") + '</span></div>',
        '<div class="det-cnt absolute top-1 right-1 hidden"><span class="badge badge-xs badge-error font-bold">0</span></div>',
      '</figure>',
      '<div class="card-body !p-2 !gap-1">',
        '<p class="text-[11px] truncate font-medium" title="' + fname + '">' + fname + '</p>',
        '<div class="det-cbar hidden flex items-center gap-1">',
          '<progress class="det-cbar-p progress h-1.5 flex-1" value="0" max="100"></progress>',
          '<span class="det-cbar-t text-[10px] font-mono">—</span>',
        '</div>',
      '</div>',
    ].join("");
    grid.appendChild(card);
    return card;
  };

  const setCardProcessing = (fid) => {
    const card = $(`#det-card-${fid}`);
    if (!card) return;
    card.dataset.status = "processing";
    const lbl = $(".det-lbl", card);
    if (lbl) lbl.textContent = "Detecting…";
  };

  const setCardProgress = (fid, cur, total, pct) => {
    const card = $(`#det-card-${fid}`);
    if (!card) return;
    const lbl = $(".det-lbl", card);
    const bar = $(".det-bar", card);
    if (lbl) lbl.textContent = `SAHI ${cur}/${total}`;
    if (bar) bar.value = pct;
  };

  const setCardComplete = (fid, data) => {
    const card = $(`#det-card-${fid}`);
    if (!card || card.dataset.status === "complete") return;
    card.dataset.status = "complete";
    card.classList.add("cursor-pointer");
    card.onclick = () => openDetail(fid);

    const ph = $(".det-ph", card);
    if (ph) ph.classList.add("hidden");

    const img = $(".det-thumb", card);
    if (img && data.thumb_url) {
      img.src = data.thumb_url;
      img.classList.remove("hidden");
    }
    applyStats(fid, data);
  };

  const setCardError = (fid, msg) => {
    const card = $(`#det-card-${fid}`);
    if (!card) return;
    card.dataset.status = "error";
    const ph = $(".det-ph", card);
    if (ph) ph.innerHTML = '<span class="text-error text-xs text-center px-2">' + (msg || "Error") + '</span>';
  };

  const applyStats = (fid, data) => {
    const card = $(`#det-card-${fid}`);
    if (!card) return;
    const dets = (data.detections || []).filter(d => d.confidence >= cfg.confidence);
    const cnt = $(".det-cnt", card);
    if (cnt) {
      cnt.classList.remove("hidden");
      const b = $(".badge", cnt);
      if (b) {
        b.textContent = String(dets.length);
        b.className = dets.length > 0
          ? "badge badge-xs badge-error font-bold"
          : "badge badge-xs badge-success font-bold";
      }
    }
    const cbar = $(".det-cbar", card);
    if (cbar && dets.length > 0) {
      cbar.classList.remove("hidden");
      const avg = dets.reduce((s, d) => s + d.confidence, 0) / dets.length;
      const pEl = $(".det-cbar-p", card);
      const tEl = $(".det-cbar-t", card);
      if (pEl) {
        pEl.value = Math.round(avg * 100);
        pEl.className = "det-cbar-p progress h-1.5 flex-1 " +
          (avg >= 0.7 ? "progress-success" : avg >= 0.4 ? "progress-warning" : "progress-error");
      }
      if (tEl) tEl.textContent = Math.round(avg * 100) + "%";
    } else if (cbar) {
      cbar.classList.add("hidden");
    }
  };

  const refilterAll = () => {
    files.forEach((data, fid) => {
      if (data.status === "complete") applyStats(fid, data);
    });
  };

  /* ── batch progress bar ────────────────────────────────────── */
  const updateBatchBar = (completed, total) => {
    const wrap = $("#det-progress");
    const txt = $("#det-progress-text");
    const pctEl = $("#det-progress-pct");
    const bar = $("#det-progress-bar");
    if (wrap) wrap.classList.remove("hidden");
    const pct = total > 0 ? Math.round(100 * completed / total) : 0;
    if (txt) txt.textContent = completed >= total
      ? `Complete — ${total} files processed`
      : `Detecting ${completed} / ${total} files`;
    if (pctEl) pctEl.textContent = pct + "%";
    if (bar) bar.value = pct;
  };

  /* ── socket event handlers ─────────────────────────────────── */
  const onQueued = (d) => {
    if (d.job_id !== jobId) return;
    if (!files.has(d.file_id)) {
      files.set(d.file_id, { filename: d.filename, file_type: d.file_type, status: "queued", detections: [] });
    }
    ensureCard(d.file_id, d.filename, d.file_type);
  };

  const onStart = (d) => {
    if (d.job_id !== jobId) return;
    const f = files.get(d.file_id);
    if (f) f.status = "processing";
    ensureCard(d.file_id, d.filename || "", d.file_type || "image");
    setCardProcessing(d.file_id);
  };

  const onProgress = (d) => {
    if (d.job_id !== jobId) return;
    setCardProgress(d.file_id, d.current, d.total_steps, d.percent);
  };

  const onResult = (d) => {
    if (d.job_id !== jobId) return;
    ensureCard(d.file_id, d.filename, d.file_type || "image");
    if (d.error) {
      files.set(d.file_id, { ...(files.get(d.file_id) || {}), status: "error" });
      setCardError(d.file_id, d.error);
    } else {
      const f = {
        filename: d.filename, file_type: d.file_type,
        status: "complete", thumb_url: d.thumb_url,
        annotated_url: d.annotated_url, stats: d.stats,
        detections: d.detections || [],
      };
      files.set(d.file_id, f);
      setCardComplete(d.file_id, f);
    }
    updateBatchBar(d.completed, d.total);
  };

  const onBatchComplete = (d) => {
    if (d.job_id !== jobId) return;
    updateBatchBar(d.total_files, d.total_files);
    stopPoll();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId, category: getCategory() }));
  };

  /* ── socket connection ─────────────────────────────────────── */
  const connectSocket = (id) => {
    if (typeof io === "undefined") return;
    if (socket) { try { socket.disconnect(); } catch (_) {} }

    socket = io({ path: "/socket.io/", transports: ["websocket", "polling"] });

    socket.on("detection_queued", onQueued);
    socket.on("detection_start", onStart);
    socket.on("detection_progress", onProgress);
    socket.on("detection_result", onResult);
    socket.on("detection_batch_complete", onBatchComplete);

    socket.on("connect", () => {
      socket.emit("subscribe_job", { job_id: id });
      syncFromApi(id);
    });
  };

  /* ── API polling (catches missed socket events) ────────────── */
  const syncFromApi = async (id) => {
    try {
      const res = await fetch("/api/detection/results/" + id);
      if (!res.ok) return;
      const body = await res.json();

      body.results.forEach((r) => {
        const existing = files.get(r.file_id);
        if (existing && existing.status === "complete") return;

        const f = {
          filename: r.filename, file_type: r.file_type,
          status: "complete", thumb_url: r.thumb_url,
          annotated_url: r.annotated_url, stats: r.stats,
          detections: r.detections || [],
        };
        files.set(r.file_id, f);
        ensureCard(r.file_id, r.filename, r.file_type);
        setCardComplete(r.file_id, f);
      });

      const total = body.total || body.results.length;
      const completed = body.completed || body.results.length;
      updateBatchBar(completed, total);

      if (body.status === "complete" || completed >= total) {
        stopPoll();
      }
    } catch (_) { /* network hiccup, retry on next poll */ }
  };

  const startPoll = (id) => {
    stopPoll();
    pollTimer = setInterval(() => syncFromApi(id), POLL_MS);
  };

  const stopPoll = () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  };

  /* ── detail window ─────────────────────────────────────────── */
  const openDetail = (fid) => {
    if (!jobId) return;
    window.open("/detection/detail?job_id=" + jobId + "&file_id=" + fid, "_blank");
  };

  const getCategory = () => {
    const c = $("#detection-container");
    return c ? c.dataset.category : "";
  };

  /* ── load persisted results on page load ────────────────────── */
  const loadExisting = async (id) => {
    try {
      const res = await fetch("/api/detection/results/" + id);
      if (!res.ok) return;
      const body = await res.json();

      body.results.forEach((r) => {
        const f = {
          filename: r.filename, file_type: r.file_type,
          status: "complete", thumb_url: r.thumb_url,
          annotated_url: r.annotated_url, stats: r.stats,
          detections: r.detections || [],
        };
        files.set(r.file_id, f);
        ensureCard(r.file_id, r.filename, r.file_type);
        setCardComplete(r.file_id, f);
      });

      const total = body.total || body.results.length;
      const completed = body.completed || body.results.length;
      updateBatchBar(completed, total);

      if (body.status === "processing") {
        connectSocket(id);
        startPoll(id);
      }
    } catch (_) {}
  };

  /* ── init ──────────────────────────────────────────────────── */
  const init = () => {
    const root = $("#detection-container");
    if (!root) return;
    buildUI(root);

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && saved.category === getCategory() && saved.jobId) {
      jobId = saved.jobId;
      loadExisting(jobId);
    }
  };

  /* ── listen for new upload batches ─────────────────────────── */
  window.addEventListener("azari:batch-started", (e) => {
    const { jobId: id, category } = e.detail;
    if (category !== getCategory()) return;

    jobId = id;
    files.clear();
    stopPoll();
    const grid = $("#det-grid");
    if (grid) grid.innerHTML = "";
    const empty = $("#det-empty");
    if (empty) empty.classList.add("hidden");

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId: id, category }));

    connectSocket(id);
    startPoll(id);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
