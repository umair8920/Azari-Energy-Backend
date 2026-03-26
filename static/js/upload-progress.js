(() => {
  const root = () => document.getElementById("upload-progress-root");
  const fab = () => document.getElementById("upload-progress-fab");
  const fabPct = () => document.getElementById("upload-progress-fab-pct");
  const panel = () => document.getElementById("upload-progress-panel");
  const bar = () => document.getElementById("upload-progress-bar");
  const statusEl = () => document.getElementById("upload-progress-status");
  const detailEl = () => document.getElementById("upload-progress-detail");
  const minimizeBtn = () => document.getElementById("upload-progress-minimize");

  let socket = null;
  let activeJobId = null;
  let minimized = false;
  let boundHandlers = null;

  const showRoot = () => {
    const r = root();
    if (r) r.classList.remove("hidden");
  };

  const hideRoot = () => {
    const r = root();
    if (r) r.classList.add("hidden");
  };

  const setMinimized = (next) => {
    minimized = next;
    const p = panel();
    const f = fab();
    if (!p || !f) return;
    if (minimized) {
      p.classList.add("translate-x-full");
      f.classList.remove("hidden");
    } else {
      p.classList.remove("translate-x-full");
      f.classList.add("hidden");
    }
  };

  const updateProgress = (payload) => {
    const b = bar();
    const s = statusEl();
    const d = detailEl();
    const fp = fabPct();
    const pct = typeof payload.percent === "number" ? payload.percent : 0;
    if (b) {
      b.value = pct;
    }
    if (s) {
      s.textContent = `Processing ${payload.completed ?? 0} of ${payload.total ?? "—"} files`;
    }
    if (d && payload.filename) {
      d.textContent = `Last saved: ${payload.filename}`;
    }
    if (fp) {
      fp.textContent = `${pct}%`;
    }
  };

  const teardownSocket = () => {
    if (boundHandlers && socket) {
      socket.off("upload_progress", boundHandlers.onProgress);
      socket.off("upload_complete", boundHandlers.onComplete);
    }
    boundHandlers = null;
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    activeJobId = null;
  };

  const finishUploadUi = () => {
    setMinimized(false);
    hideRoot();
    const b = bar();
    const s = statusEl();
    const d = detailEl();
    const fp = fabPct();
    if (b) b.value = 0;
    if (s) s.textContent = "";
    if (d) d.textContent = "";
    if (fp) fp.textContent = "0%";
    teardownSocket();
  };

  const getSocket = () => {
    if (typeof io === "undefined") {
      throw new Error("Socket.IO client not loaded");
    }
    if (!socket || !socket.connected) {
      socket = io({ path: "/socket.io/", transports: ["websocket", "polling"] });
    }
    return socket;
  };

  const bindJob = (jobId) => {
    const s = getSocket();
    if (boundHandlers) {
      s.off("upload_progress", boundHandlers.onProgress);
      s.off("upload_complete", boundHandlers.onComplete);
    }
    const onProgress = (payload) => {
      if (!payload || payload.job_id !== jobId) return;
      updateProgress(payload);
    };
    const onComplete = (payload) => {
      if (!payload || payload.job_id !== jobId) return;
      const st = statusEl();
      if (st) st.textContent = "Upload complete.";
      finishUploadUi();
    };
    boundHandlers = { onProgress, onComplete };
    s.on("upload_progress", onProgress);
    s.on("upload_complete", onComplete);
    s.emit("subscribe_job", { job_id: jobId });
  };

  const postFiles = async (jobId, files) => {
    for (const file of files) {
      const body = new FormData();
      body.append("job_id", jobId);
      body.append("file", file, file.name);
      const res = await fetch("/api/uploads/file", {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || res.statusText || "Upload failed");
      }
    }
  };

  const getFilesForUpload = (inputId) => {
    const fromPreview = window.__azariUploadQueues?.[inputId];
    if (Array.isArray(fromPreview) && fromPreview.length > 0) {
      return fromPreview.slice();
    }
    const input = document.getElementById(inputId);
    if (input?.files?.length) {
      return Array.from(input.files);
    }
    return [];
  };

  const startBatchUpload = async (inputId, category) => {
    const files = getFilesForUpload(inputId);
    if (files.length === 0) {
      window.alert("Choose one or more files first.");
      return;
    }
    const detConf = document.getElementById("det-conf");
    const detSlice = document.getElementById("det-slice");
    const detOverlap = document.getElementById("det-overlap");
    const detParams = {
      det_confidence: detConf ? parseInt(detConf.value, 10) / 100 : 0.25,
      det_slice_size: detSlice ? parseInt(detSlice.value, 10) : 640,
      det_overlap: detOverlap ? parseInt(detOverlap.value, 10) / 100 : 0.2,
    };

    const startRes = await fetch("/api/uploads/batch/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total: files.length, category, ...detParams }),
    });
    if (!startRes.ok) {
      const err = await startRes.json().catch(() => ({}));
      throw new Error(err.detail || startRes.statusText || "Could not start batch");
    }
    const { job_id: jobId } = await startRes.json();
    activeJobId = jobId;
    window.dispatchEvent(new CustomEvent("azari:batch-started", { detail: { jobId, category } }));
    showRoot();
    setMinimized(false);
    const st = statusEl();
    if (st) st.textContent = "Uploading…";
    updateProgress({ job_id: jobId, completed: 0, total: files.length, percent: 0, filename: "" });
    bindJob(jobId);
    await postFiles(jobId, files);
    const st2 = statusEl();
    if (st2) st2.textContent = "Waiting for server queue…";
  };

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-upload-start]");
    if (!btn) return;
    const inputId = btn.getAttribute("data-upload-input");
    const category = btn.getAttribute("data-upload-category");
    if (!inputId || !category) return;
    btn.disabled = true;
    try {
      await startBatchUpload(inputId, category);
    } catch (err) {
      console.error(err);
      window.alert(err.message || "Upload failed");
      finishUploadUi();
    } finally {
      btn.disabled = false;
    }
  });

  minimizeBtn()?.addEventListener("click", () => {
    if (!activeJobId) return;
    setMinimized(true);
  });

  fab()?.addEventListener("click", () => {
    if (!activeJobId) return;
    setMinimized(false);
  });
})();
