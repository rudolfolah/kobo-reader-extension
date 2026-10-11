// Dependency-free logic tests using an instrumented DOM/observer double.
// These are not a real-browser benchmark; see VALIDATION.md.
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = readFileSync(__dirname + "/../extension/content.js", "utf8");
const DIALOG = '[role="dialog"][aria-label="Error"][aria-modal="true"]';
function harness({ error = false, origin = "https://readnow.kobo.com",
  previous = null, fallback = null, blocked = false, visible = true,
  referrer = "https://www.kobo.com/ca/en/library/books" } = {}) {
  const observers = [], tasks = [], values = new Map();
  const listeners = new Map();
  let reloads = 0, redirects = [], queries = 0, layouts = 0, callbacks = 0, time = 1000000;
  if (previous !== null) values.set("__kobo_reader_extension_v1_last_reload", String(previous));
  if (fallback !== null) values.set("__kobo_reader_extension_v1_last_library", String(fallback));
  class El {
    constructor(kind, children = []) {
      this.kind = kind; this.children = children; this.isConnected = true;
      this.tagName = kind === "span" ? "SPAN" : "DIV";
      this.textContent = ""; this.hidden = false; this.rects = [1];
    }
    matches(s) { return (s === ".ModalBlocker_blocker" && this.kind === "modal") ||
      (s === DIALOG && this.kind === "dialog" && this.label !== "Other"); }
    querySelector(s) {
      queries++;
      const matches = (e) => s === DIALOG ? e.matches(s) :
        s.includes("Dialog_contentContainer") && e.kind === "content";
      const walk = (e) => {
        for (const child of e.children) {
          if (matches(child)) return child;
          const match = walk(child); if (match) return match;
        }
        return null;
      };
      return walk(this);
    }
    closest() { return this.hiddenAncestor ? this : null; }
    getClientRects() { layouts++; return this.rects; }
  }
  const span = new El("span"); span.textContent = "User has no active session";
  const content = new El("content", [span]);
  const dialog = new El("dialog", [content]);
  const modal = new El("modal", [dialog]);
  const reader = new El("reader");
  const root = new El("root", error ? [modal] : [reader]);
  const body = new El("body", [root]);
  const doc = {
    body, visibilityState: visible ? "visible" : "hidden", referrer,
    getElementById: () => root,
    addEventListener: (n, f) => listeners.set(n, f),
    removeEventListener: (n) => listeners.delete(n)
  };
  class Observer {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.target = null; }
  }
  const win = { addEventListener: (n,f) => listeners.set(n,f),
    removeEventListener: (n) => listeners.delete(n) };
  win.top = win;
  const store = {
    getItem(k) { if (blocked) throw Error("blocked"); return values.get(k) ?? null; },
    setItem(k,v) { if (blocked) throw Error("blocked"); values.set(k,v); }
  };
  const env = {
    document: doc, window: win,
    location: { origin, reload() { reloads++; }, replace(url) { redirects.push(url); } },
    sessionStorage: store, MutationObserver: Observer,
    queueMicrotask: (f) => tasks.push(f),
    getComputedStyle: () => ({visibility: "visible"}),
    Date: {now: () => time}
  };
  vm.runInNewContext(source, env);
  function flush() { while(tasks.length) tasks.shift()(); }
  function notify(target) {
    for (const o of observers) if (o.target === target) { callbacks++; o.cb([]); }
  }
  function deepMutation() {
    // Simulate a childList mutation whose target is a descendant of #root.
    // Shallow observers do not receive it.
    for (const o of observers) if (o.target === reader ||
      ((o.target === root || o.target === body) && o.options.subtree)) {
      callbacks++; o.cb([]);
    }
  }
  return {
    flush, root, modal, dialog, span, content, body, observers, values, notify,
    get stats() { return {reloads, redirects, queries, layouts, callbacks}; },
    deepMutation,
    show() { doc.visibilityState = "visible"; listeners.get("visibilitychange")?.(); },
    insert() { root.children = [modal]; notify(root); },
    mutate() { notify(modal); },
    get active() { return observers.filter(o => o.target).length; }
  };
}
const results = [];
function test(name, fn) { fn(); results.push(name); console.log("PASS " + name); }
test("Existing exact error reloads once and persists guard", () => {
  const h = harness({error:true}); h.flush();
  assert.equal(h.stats.reloads,1); assert.equal(h.active,0);
  assert.equal(h.values.size,1);
});
test("Dynamically inserted modal is detected", () => {
  const h = harness(); h.flush(); h.insert(); h.flush();
  assert.equal(h.stats.reloads,1);
});
test("Late message text update is detected", () => {
  const h = harness({error:true}); h.span.textContent="Loading"; h.flush();
  assert.equal(h.stats.reloads,0);
  h.span.textContent="User has no active session"; h.mutate(); h.flush();
  assert.equal(h.stats.reloads,1);
});
test("Other messages and other dialogs do not reload", () => {
  const h=harness({error:true}); h.span.textContent="Network error"; h.flush();
  assert.equal(h.stats.reloads,0);
  h.span.textContent="User has no active session"; h.dialog.label="Other";
  h.mutate(); h.flush(); assert.equal(h.stats.reloads,0);
});
test("Hidden dialog does not reload", () => {
  const h=harness({error:true}); h.dialog.rects=[]; h.flush();
  assert.equal(h.stats.reloads,0);
});
test("Hidden tab defers recovery until visible", () => {
  const h=harness({error:true,visible:false}); h.flush();
  assert.equal(h.stats.queries,0); h.show(); h.flush();
  assert.equal(h.stats.reloads,1);
});
test("Error surviving reload goes to library once; expiry allows reload", () => {
  for (const previous of [999999,1000001]) {
    const h=harness({error:true,previous}); h.flush();
    assert.equal(h.stats.reloads,0); assert.equal(h.active,0);
    assert.deepEqual(h.stats.redirects,["https://www.kobo.com/ca/en/library/books"]);
  }
  const h=harness({error:true,previous:699999}); h.flush();
  assert.equal(h.stats.reloads,1);
});
test("Library fallback follows the referrer locale", () => {
  for (const [referrer, want] of [
    ["https://www.kobo.com/fr/fr/ebook/x", "https://www.kobo.com/fr/fr/library/books"],
    ["https://www.kobo.com/gb/en", "https://www.kobo.com/gb/en/library/books"],
    ["", "https://www.kobo.com/library/books"],
    ["https://evil.example/ca/en/", "https://www.kobo.com/library/books"]]) {
    const h=harness({error:true,previous:999999,referrer}); h.flush();
    assert.deepEqual(h.stats.redirects,[want]);
  }
});
test("Repeated failure after library fallback stops without bouncing", () => {
  const h=harness({error:true,previous:999998,fallback:999999}); h.flush();
  assert.equal(h.stats.reloads,0); assert.deepEqual(h.stats.redirects,[]);
  assert.equal(h.active,0);
});
test("Full recovery chain persists both guards across documents", () => {
  const first=harness({error:true}); first.flush();
  const previous=Number(first.values.get("__kobo_reader_extension_v1_last_reload"));
  const second=harness({error:true,previous}); second.flush();
  assert.equal(second.stats.redirects.length,1);
  const fallback=Number(second.values.get("__kobo_reader_extension_v1_last_library"));
  const third=harness({error:true,previous,fallback}); third.flush();
  assert.equal(third.stats.reloads,0); assert.equal(third.stats.redirects.length,0);
});
test("Healthy reader after reload does not redirect", () => {
  const h=harness({previous:999999}); h.flush();
  assert.equal(h.stats.reloads,0); assert.equal(h.stats.redirects.length,0);
});
test("Blocked storage fails closed", () => {
  const h=harness({error:true,blocked:true}); h.flush();
  assert.equal(h.stats.reloads,0); assert.equal(h.active,0);
  assert.equal(h.stats.redirects.length,0);
});
test("Healthy deep reader updates invoke zero observers or queries", () => {
  const h=harness(); h.flush();
  const before=h.stats;
  for(let i=0;i<100000;i++) h.deepMutation();
  h.flush(); assert.deepEqual(h.stats,before);
  assert.equal(h.observers[0].options.subtree,undefined);
  assert.equal(h.observers[1].options.subtree,undefined);
});
test("Burst of modal updates produces one dialog check", () => {
  const h=harness({error:true}); h.span.textContent="Other"; h.flush();
  const before=h.stats.queries;
  for(let i=0;i<100;i++) h.mutate();
  h.flush(); assert.equal(h.stats.queries-before,2);
});
test("Unrelated origins install no observers", () => {
  const h=harness({origin:"https://www.kobo.com"}); h.flush();
  assert.equal(h.observers.length,0); assert.equal(h.stats.reloads,0);
});
const manifest=JSON.parse(readFileSync(__dirname + "/../extension/manifest.json","utf8"));
assert.deepEqual(manifest.content_scripts[0].matches,["https://readnow.kobo.com/*"]);
assert.equal(manifest.content_scripts[0].all_frames,false);
assert.equal(manifest.background,undefined);
assert.equal(manifest.permissions,undefined);
console.log(results.length + " logic tests passed; manifest scope checked.");
