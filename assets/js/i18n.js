/* AION 2 Global Field Guide — bilingual (EN / 繁 / 简) content engine
 *
 *   <h2 data-en="Classes" data-zh="職業">Classes</h2>
 *
 * zh and cn share the same source string; cn runs it through the
 * Traditional → Simplified character map in assets/js/data/s2t.js.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "aion2fg:lang";
  var current = "en";

  function conv(s) {
    var map = window.AION2_S2T;
    if (!map || !s) return s;
    var out = "";
    for (var i = 0; i < s.length; i++) out += map[s[i]] || s[i];
    return out;
  }

  function stored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return v === "zh" || v === "cn" || v === "en" ? v : null;
    } catch (e) {
      return null;
    }
  }

  function detect() {
    var fromUrl = new URLSearchParams(location.search).get("lang");
    if (fromUrl === "zh" || fromUrl === "cn" || fromUrl === "en") return fromUrl;
    var s = stored();
    if (s) return s;
    return (navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
  }

  function swapAttrs(el, lang) {
    var prefix = "data-" + lang + "-";
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      if (attr.name.indexOf(prefix) !== 0) continue;
      var target = attr.name.slice(prefix.length);
      if (!target) continue;
      el.setAttribute(target, attr.value);
    }
  }

  function apply(lang, opts) {
    current = lang === "cn" ? "cn" : lang === "zh" ? "zh" : "en";
    var base = current === "en" ? "en" : "zh";
    var root = document.documentElement;

    root.lang = current === "en" ? "en" : current === "cn" ? "zh-Hans" : "zh-Hant";
    root.setAttribute("data-lang", current);

    var nodes = document.querySelectorAll("[data-en], [data-zh]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var value = el.getAttribute(base === "en" ? "data-en" : "data-zh");
      if (value === null) value = el.getAttribute("data-en");
      if (value !== null) el.innerHTML = current === "cn" ? conv(value) : value;
      swapAttrs(el, current === "cn" ? "zh" : current);
    }

    var body = document.querySelector("body");
    if (body) {
      var t = body.getAttribute("data-title-" + (current === "en" ? "en" : current === "cn" ? "zh" : "zh"));
      if (!t) t = body.getAttribute("data-title-en");
      if (t) document.title = current === "cn" ? conv(t) : t;
      var d = body.getAttribute("data-desc-" + (current === "en" ? "en" : "zh"));
      var meta = document.querySelector('meta[name="description"]');
      if (d && meta) meta.setAttribute("content", current === "cn" ? conv(d) : d);
    }

    var buttons = document.querySelectorAll("[data-lang-btn]");
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].setAttribute("aria-pressed", String(buttons[j].getAttribute("data-lang-btn") === current));
    }

    if (current === "cn") {
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        if (/[\u4e00-\u9fff]/.test(node.nodeValue)) node.nodeValue = conv(node.nodeValue);
      }
    }

    if (opts && opts.persist) {
      try {
        localStorage.setItem(STORAGE_KEY, current);
      } catch (e) {}
    }

    document.dispatchEvent(new CustomEvent("langchange", { detail: { lang: current } }));
    return current;
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-lang-btn]");
    if (!btn) return;
    apply(btn.getAttribute("data-lang-btn"), { persist: true });
  });

  window.AION2_I18N = {
    apply: apply,
    conv: conv,
    get lang() {
      return current;
    },
    get isZh() {
      return current !== "en";
    },
    get isCn() {
      return current === "cn";
    },
    /** Chinese string in the active variant (no-op in English mode) */
    t: function (s) {
      return current === "cn" ? conv(s) : s;
    },
    toggle: function () {
      apply(current === "en" ? "zh" : current === "zh" ? "cn" : "en", { persist: true });
    }
  };

  apply(detect(), { persist: false });
})();
