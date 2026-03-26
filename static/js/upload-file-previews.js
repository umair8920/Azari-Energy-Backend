(() => {
  "use strict";

  /**
   * Per-widget file list with previews. Syncs <input type="file"> via DataTransfer and
   * mirrors the queue on window.__azariUploadQueues[inputId] for upload-progress.js.
   * Never set input.value = "" after assigning files — that clears input.files in most browsers.
   */

  window.__azariUploadQueues = window.__azariUploadQueues || {};

  const parseAccept = (acceptAttr) => {
    if (!acceptAttr || !acceptAttr.trim()) return () => true;
    const parts = acceptAttr.split(",").map((s) => s.trim()).filter(Boolean);
    return (file) => {
      for (const p of parts) {
        if (p.startsWith(".")) {
          if (file.name.toLowerCase().endsWith(p.toLowerCase())) return true;
        } else if (p.includes("/")) {
          if (p.endsWith("/*")) {
            const main = p.slice(0, -2);
            if (file.type.startsWith(`${main}/`)) return true;
          } else if (file.type === p) return true;
        }
      }
      return false;
    };
  };

  const fileKey = (f) => `${f.name}|${f.size}|${f.lastModified}`;

  const syncInputAndRegistry = (input, items) => {
    const dt = new DataTransfer();
    items.forEach(({ file }) => dt.items.add(file));
    input.files = dt.files;
    if (items.length === 0) {
      delete window.__azariUploadQueues[input.id];
    } else {
      window.__azariUploadQueues[input.id] = items.map((i) => i.file);
    }
  };

  const createItem = (file) => {
    let url = null;
    if (file.type.startsWith("image/")) {
      url = URL.createObjectURL(file);
    } else if (file.type.startsWith("video/")) {
      url = URL.createObjectURL(file);
    }
    return { file, url };
  };

  const disposeItem = (item) => {
    if (item.url) URL.revokeObjectURL(item.url);
  };

  const mergeIncoming = (items, incomingFiles, acceptFilter) => {
    const seen = new Set(items.map((i) => fileKey(i.file)));
    for (const file of incomingFiles) {
      if (!acceptFilter(file)) continue;
      const k = fileKey(file);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(createItem(file));
    }
  };

  const render = (widget, state) => {
    const grid = widget.querySelector("[data-upload-preview-grid]");
    const emptyZone = widget.querySelector("[data-upload-empty-zone]");
    const hasFilesEl = widget.querySelector("[data-upload-has-files]");
    const input = widget.querySelector('input[type="file"]');
    if (!grid || !emptyZone || !hasFilesEl || !input) return;

    const has = state.items.length > 0;
    emptyZone.classList.toggle("hidden", has);
    hasFilesEl.classList.toggle("hidden", !has);
    grid.innerHTML = "";

    state.items.forEach((item, index) => {
      const { file, url } = item;
      const card = document.createElement("div");
      card.className =
        "group relative aspect-square overflow-hidden rounded-xl border border-base-300 bg-base-200/40 shadow-sm dark:border-base-content/15";

      const mediaWrap = document.createElement("div");
      mediaWrap.className = "flex h-full w-full items-center justify-center bg-base-300/30 dark:bg-base-content/5";

      if (url && file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.className = "h-full w-full object-cover";
        mediaWrap.appendChild(img);
      } else if (url && file.type.startsWith("video/")) {
        const v = document.createElement("video");
        v.src = url;
        v.muted = true;
        v.playsInline = true;
        v.setAttribute("playsinline", "");
        v.setAttribute("webkit-playsinline", "");
        v.className = "h-full w-full object-cover";
        v.setAttribute("preload", "metadata");
        mediaWrap.appendChild(v);
      } else {
        const icon = document.createElement("span");
        icon.className = "mdi mdi-file-document-outline text-4xl text-base-content/40";
        icon.setAttribute("aria-hidden", "true");
        mediaWrap.appendChild(icon);
      }

      const nameEl = document.createElement("p");
      nameEl.className =
        "absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 via-black/40 to-transparent px-2 pb-2 pt-8 text-[10px] font-medium text-white drop-shadow-sm";
      nameEl.textContent = file.name;
      nameEl.title = file.name;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className =
        "btn btn-circle btn-ghost btn-xs absolute right-1 top-1 z-10 h-8 w-8 min-h-0 border-0 bg-base-100/90 text-base-content shadow-md hover:bg-error hover:text-error-content";
      removeBtn.setAttribute("aria-label", `Remove ${file.name}`);
      removeBtn.innerHTML =
        '<span class="mdi mdi-close text-lg leading-none" aria-hidden="true"></span>';
      removeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        disposeItem(state.items[index]);
        state.items.splice(index, 1);
        render(widget, state);
      });

      card.appendChild(mediaWrap);
      card.appendChild(nameEl);
      card.appendChild(removeBtn);
      grid.appendChild(card);
    });

    syncInputAndRegistry(input, state.items);
  };

  const bindWidget = (widget) => {
    const input = widget.querySelector('input[type="file"]');
    if (!input || !input.multiple) return;

    const acceptFilter = parseAccept(input.getAttribute("accept") || "");
    const state = { items: [] };

    const onFilesChosen = (fileList) => {
      const incoming = Array.from(fileList || []);
      if (incoming.length === 0) return;
      mergeIncoming(state.items, incoming, acceptFilter);
      render(widget, state);
    };

    input.addEventListener("change", () => {
      onFilesChosen(input.files);
      // Do not set input.value = "" here — it clears programmatically assigned input.files
      // (DataTransfer) in Chrome, Edge, Safari, etc.
    });

    widget.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      widget.classList.add("ring-2", "ring-primary/50", "ring-offset-2", "ring-offset-base-100");
    });
    widget.addEventListener("dragleave", (e) => {
      if (!widget.contains(e.relatedTarget)) {
        widget.classList.remove("ring-2", "ring-primary/50", "ring-offset-2", "ring-offset-base-100");
      }
    });
    widget.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      widget.classList.remove("ring-2", "ring-primary/50", "ring-offset-2", "ring-offset-base-100");
      onFilesChosen(e.dataTransfer?.files);
    });
  };

  document.querySelectorAll("[data-upload-widget]").forEach(bindWidget);
})();
