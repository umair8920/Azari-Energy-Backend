const storageKey = "azari-theme";

const applyTheme = (theme) => {
  if (theme !== "light" && theme !== "dark") return;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(storageKey, theme);
};

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".theme-set");
  if (!btn) return;
  const value = btn.getAttribute("data-theme-value");
  applyTheme(value);
});
