const storageKey = "azari-sidebar-collapsed";

const isLg = () => window.matchMedia("(min-width: 1024px)").matches;

const syncToggleAria = () => {
  const btn = document.getElementById("sidebar-collapse-toggle");
  if (!btn) return;
  const collapsed = document.documentElement.getAttribute("data-sidebar-collapsed") === "true";
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  btn.setAttribute("aria-label", label);
  btn.setAttribute("title", label);
};

const applyCollapsed = (collapsed) => {
  const root = document.documentElement;
  if (collapsed && isLg()) {
    root.setAttribute("data-sidebar-collapsed", "true");
    localStorage.setItem(storageKey, "1");
  } else {
    root.removeAttribute("data-sidebar-collapsed");
    localStorage.setItem(storageKey, "0");
  }
  syncToggleAria();
};

document.addEventListener("DOMContentLoaded", () => {
  syncToggleAria();
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("#sidebar-collapse-toggle");
  if (!btn) return;
  if (!isLg()) return;
  const cur = document.documentElement.getAttribute("data-sidebar-collapsed") === "true";
  applyCollapsed(!cur);
});

window.addEventListener("resize", () => {
  const root = document.documentElement;
  if (!isLg()) {
    root.removeAttribute("data-sidebar-collapsed");
  } else if (localStorage.getItem(storageKey) === "1") {
    root.setAttribute("data-sidebar-collapsed", "true");
  }
  syncToggleAria();
});
