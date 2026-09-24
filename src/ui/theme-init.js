/**
 * Theme flash fix — external script (no inline, CSP-safe).
 * Reads cached theme from localStorage and applies it before first paint.
 * Also ensures body.theme-loading is removed even if later modules fail.
 * @module ui/theme-init (classic, not ESM, runs early)
 */
(function () {
  try {
    let cached = null;
    try {
      cached = localStorage.getItem("ai-chess-companion-theme-cache");
    } catch (e) {
      void 0;
    }

    let data = null;
    try {
      data = cached ? JSON.parse(cached) : null;
    } catch (e) {
      data = null;
    }

    const theme = (data && data.theme) || "dark";
    const boardTheme = (data && data.boardTheme) || "classic";
    const fontScale = (data && data.fontScale) || "medium";
    const density = (data && data.density) || "comfortable";

    try {
      if (theme) {
        document.documentElement.setAttribute("data-theme-preload", theme);
      }
    } catch (e) {
      void 0;
    }

    let effective = theme;
    if (!effective || effective === "system") {
      try {
        effective = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      } catch (e) {
        effective = "dark";
      }
    }

    try {
      document.documentElement.style.background = effective === "light" ? "#eef1f6" : "#0e1218";
    } catch (e) {
      void 0;
    }

    const applyToBody = function () {
      try {
        const body = document.body;
        if (!body) return false;
        let resolved = theme;
        if (theme === "system") {
          try {
            resolved = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
          } catch (e2) {
            resolved = "dark";
          }
        }
        body.setAttribute("data-theme", resolved);
        body.setAttribute("data-board-theme", boardTheme);
        body.setAttribute("data-font-scale", fontScale);
        body.setAttribute("data-density", density);
        body.classList.remove("theme-loading");
        document.documentElement.style.background = "";
        return true;
      } catch (e) {
        return false;
      }
    };

    if (!applyToBody()) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
          applyToBody();
          try {
            if (document.body) document.body.classList.remove("theme-loading");
          } catch (e) {
            void 0;
          }
        });
      } else {
        // body already parsed but apply failed, try again next tick
        setTimeout(applyToBody, 0);
      }
    }

    // Safety net: always unhide after 1s
    setTimeout(function () {
      try {
        if (document.body) document.body.classList.remove("theme-loading");
        document.documentElement.style.background = "";
      } catch (e) {
        void 0;
      }
    }, 1000);
  } catch (e) {
    try {
      if (document.body) document.body.classList.remove("theme-loading");
    } catch (err) {
      void 0;
    }
    try {
      document.documentElement.style.background = "";
    } catch (err2) {
      void 0;
    }
  }
})();
