(() => {
  "use strict";
  if (location.origin !== "https://readnow.kobo.com" || window !== window.top) return;

  const DIALOG = '[role="dialog"][aria-label="Error"][aria-modal="true"]';
  const MODAL = ".ModalBlocker_blocker";
  const MESSAGE = "User has no active session";
  const STORAGE_KEY = "__kobo_reader_extension_v1_last_reload";
  const FALLBACK_KEY = "__kobo_reader_extension_v1_last_library";
  const LOCALE_KEY = "__kobo_reader_extension_v1_locale";
  const LIBRARY_PATH = "library/books";
  const LOCALE_RE = /^https:\/\/(?:www\.)?kobo\.com\/([a-z]{2}\/[a-z]{2})(?:[/?#]|$)/i;
  const COOLDOWN_MS = 5 * 60 * 1000;
  let root = null;
  let modal = null;
  let stopped = false;
  let queued = false;

  function stop() {
    stopped = true;
    bodyObserver.disconnect();
    rootObserver.disconnect();
    modalObserver.disconnect();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onPageShow);
  }

  // The reader origin carries no locale. The launch flow arrives from
  // www.kobo.com/<region>/<lang>/..., so take it from the referrer and
  // remember it for the tab; otherwise use Kobo's locale-less URL.
  function libraryUrl() {
    let locale = null;
    try {
      locale = LOCALE_RE.exec(document.referrer || "")?.[1]?.toLowerCase() || null;
      if (locale) sessionStorage.setItem(LOCALE_KEY, locale);
      else locale = sessionStorage.getItem(LOCALE_KEY);
    } catch {}
    const valid = locale && /^[a-z]{2}\/[a-z]{2}$/.test(locale);
    return "https://www.kobo.com/" + (valid ? locale + "/" : "") + LIBRARY_PATH;
  }

  function recover() {
    const now = Date.now();
    let action = "reload";
    try {
      const previous = Number(sessionStorage.getItem(STORAGE_KEY));
      const fallback = Number(sessionStorage.getItem(FALLBACK_KEY));
      // Do not send the reader back to the library repeatedly if reopening
      // the book still fails. Future timestamps also activate the guard.
      if (fallback > 0 && now - fallback < COOLDOWN_MS) {
        stop();
        return;
      }
      const reloadFailed = previous > 0 && now - previous < COOLDOWN_MS;
      action = reloadFailed ? "library" : "reload";
      const key = reloadFailed ? FALLBACK_KEY : STORAGE_KEY;
      // Fail closed if storage is blocked: reloading without a persisted guard
      // could otherwise loop across page loads.
      sessionStorage.setItem(key, String(now));
      if (sessionStorage.getItem(key) !== String(now)) {
        stop();
        return;
      }
    } catch {
      stop();
      return;
    }
    stop();
    if (action === "library") location.replace(libraryUrl());
    else location.reload();
  }

  function checkModal() {
    if (stopped || document.visibilityState !== "visible" || !modal?.isConnected) return;
    const dialog = modal.matches(DIALOG) ? modal : modal.querySelector(DIALOG);
    if (!dialog || dialog.hidden || dialog.closest('[hidden], [aria-hidden="true"]')) return;
    // Exact message, in the content container; never search the book's text.
    const content = dialog.querySelector('[class~="Dialog_contentContainer_b"], [class*="Dialog_contentContainer"]');
    if (!content) return;
    const found = Array.from(content.children).some(
      (el) => el.tagName === "SPAN" && el.textContent.trim() === MESSAGE
    );
    if (!found) return;
    // Layout work happens only AFTER an exact error match.
    if (!dialog.getClientRects().length) return;
    const style = getComputedStyle(dialog);
    if (style.visibility === "hidden" || style.visibility === "collapse") return;
    recover();
  }

  function scheduleCheck() {
    if (stopped || queued || document.visibilityState !== "visible") return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      checkModal();
    });
  }

  function bindModal() {
    if (stopped) return;
    // The supplied DOM places ModalBlocker directly under #root.
    // Iterate only immediate children, not the reader's descendants.
    const next = root && Array.from(root.children).find(
      (el) => el.matches(MODAL) || el.matches(DIALOG)
    ) || null;
    if (next !== modal) {
      modalObserver.disconnect();
      modal = next;
      if (modal) {
        modalObserver.observe(modal, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["role", "aria-label", "aria-modal", "hidden", "aria-hidden", "style", "class"]
        });
      }
    }
    scheduleCheck();
  }

  function bindRoot() {
    if (stopped) return;
    const next = document.getElementById("root");
    if (next !== root) {
      rootObserver.disconnect();
      root = next;
      if (root) rootObserver.observe(root, { childList: true });
    }
    bindModal();
  }

  function onVisible() {
    if (document.visibilityState === "visible") bindRoot();
  }
  function onPageShow() {
    if (!stopped) bindRoot();
  }

  // Neither observer follows changes inside the healthy reader.
  const bodyObserver = new MutationObserver(bindRoot);
  const rootObserver = new MutationObserver(bindModal);
  const modalObserver = new MutationObserver(scheduleCheck);
  if (!document.body) return;
  bodyObserver.observe(document.body, { childList: true });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onPageShow);
  bindRoot();
})();
