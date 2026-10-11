(() => {
  "use strict";
  if (location.origin !== "https://readnow.kobo.com" || window !== window.top) return;
  const preference = matchMedia("(prefers-color-scheme: dark)");
  const SETTINGS = '[data-test-id="reader-headerBar-readingSettings"][role="button"]';
  const CLOSE = '[data-test-id="reader-readingSettings-popUp-closeIcon"][role="button"]';
  const POPUP = '[data-test-id="reader-readingSettings-popUp"]';
  let pending = true;
  let active = false;
  let opened = false;
  let observer = null;
  let deadline = null;
  let clickedTheme = null;
  let priorFocus = null;
  let readyDelay = null;
  let canInteract = false;

  function engineReady() {
    const page = document.querySelector('[data-test-id="reader-footerBar-pageNumber"]');
    const chapter = document.querySelector('[data-test-id="reader-footerBar-chapterName-text"]');
    const frame = document.querySelector('.ReadingItem iframe[data-chapterurl][aria-hidden="false"]');
    if (!page?.textContent.trim() || !chapter?.textContent.trim() || !frame) return false;
    try {
      return frame.contentDocument?.readyState === "complete" &&
        frame.contentDocument.body?.childElementCount > 0;
    } catch { return false; }
  }

  function desiredTheme() {
    return preference.matches ? "theme-kobo-dark" : "theme-kobo-light";
  }

  function finish(success) {
    observer?.disconnect();
    observer = null;
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
    if (readyDelay !== null) clearTimeout(readyDelay);
    readyDelay = null;
    canInteract = false;
    document.removeEventListener("load", onFrameLoad, true);
    // Close only a settings panel that THIS script opened.
    if (opened) {
      const popup = document.querySelector(POPUP);
      popup?.querySelector(CLOSE)?.click();
      if (priorFocus?.isConnected &&
          (document.activeElement === document.body ||
           popup?.contains(document.activeElement))) {
        priorFocus.focus?.({preventScroll: true});
      }
    }
    active = false;
    opened = false;
    clickedTheme = null;
    priorFocus = null;
    pending = !success;
  }

  function advance() {
    if (!active) return;
    if (document.visibilityState !== "visible") { finish(false); return; }
    const theme = desiredTheme();
    if (document.body?.classList.contains(theme)) { finish(true); return; }
    // Header controls can mount before the reading engine's theme subscriber.
    // Never click them during that initialization window.
    if (!engineReady()) return;
    if (!canInteract) {
      if (readyDelay === null) readyDelay = setTimeout(() => {
        readyDelay = null;
        if (!active) return;
        canInteract = true;
        advance();
      }, 250);
      return;
    }
    const popup = document.querySelector(POPUP);
    if (popup) {
      const radio = popup.querySelector(
        '[data-test-id="reader-readingSettings-backgroundModeTheme-kobo-' +
        (preference.matches ? 'dark' : 'light') + '"][role="radio"]:not([aria-hidden="true"])'
      );
      if (radio && clickedTheme !== theme) {
        clickedTheme = theme;
        radio.click();
      }
      return;
    }
    // Do not interfere with errors or unrelated dialogs.
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
      finish(false);
      return;
    }
    const trigger = document.querySelector(SETTINGS);
    if (trigger && !opened) {
      opened = true;
      priorFocus = document.activeElement;
      trigger.click();
    }
  }

  function start() {
    if (!pending || active || document.visibilityState !== "visible" || !document.body) return;
    // No observer is created when the native theme already matches.
    if (document.body.classList.contains(desiredTheme())) { pending = false; return; }
    active = true;
    observer = new MutationObserver(advance);
    const root = document.getElementById("root");
    observer.observe(root || document.body, {childList: true, subtree: true, characterData: true});
    // Native appearance is reflected on body, not the chapter DOM.
    observer.observe(document.body, {attributes: true, attributeFilter: ["class"]});
    document.addEventListener("load", onFrameLoad, true);
    // One-shot deadline, NOT polling. Bounds observation if Kobo changes its UI.
    deadline = setTimeout(() => finish(false), 10000);
    advance();
  }

  function onFrameLoad(event) {
    if (event.target?.matches?.(".ReadingItem iframe[data-chapterurl]")) advance();
  }

  preference.addEventListener("change", () => {
    pending = true;
    if (active) advance();
    else start();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") start();
    else if (active) finish(false);
  });
  window.addEventListener("pageshow", start);
  start();
})();
