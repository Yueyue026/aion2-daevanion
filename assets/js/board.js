/* Daevanion planner — click nodes to spend crystals.
 *
 * Rules mirrored from the game:
 *  - the start node in the middle is free and always owned;
 *  - a node can only be taken when it touches an owned node (up/down/left/right);
 *    clicking a far node takes the cheapest connecting path;
 *  - a node cannot be refunded while another owned node depends on it;
 *  - cost is 1 / 2 / 3 / 4 crystals for Common / Rare / Epic / Unique;
 *  - the four PvE boards share one 840-crystal pool, Azphel runs on its own 232.
 *
 * Data: assets/js/data/board-<class>.js (window.AION2_BOARDS).
 */
(function () {
  "use strict";

  var COST = { Common: 1, Rare: 2, Epic: 3, Unique: 4, Start: 0 };
  var CLASSES = [
    ["gladiator", "Gladiator", "劍星"],
    ["templar", "Templar", "守護星"],
    ["assassin", "Assassin", "殺星"],
    ["ranger", "Ranger", "弓星"],
    ["sorcerer", "Sorcerer", "魔道星"],
    ["spiritmaster", "Spiritmaster", "精靈星"],
    ["cleric", "Cleric", "治癒星"],
    ["chanter", "Chanter", "護法星"]
  ];
  var BOARDS = [
    ["nezekan", "Nezekan", "奈薩肯"],
    ["zikel", "Zikel", "吉凱爾"],
    ["vaizel", "Vaizel", "白傑爾"],
    ["triniel", "Triniel", "崔妮爾"],
    ["azphel", "Azphel", "阿斯佩爾"]
  ];
  var GRADES = [
    ["Common", "Common", "普通"],
    ["Rare", "Rare", "稀有"],
    ["Epic", "Epic", "史詩"],
    ["Unique", "Unique", "獨特"]
  ];

  var root = document.getElementById("explorer-root");
  if (!root) return;

  var gridEl = document.getElementById("board-grid");
  var clsRow = document.getElementById("cls-row");
  var boardRow = document.getElementById("board-row");
  var infoEl = document.getElementById("node-info");
  var sumEl = document.getElementById("board-summary");
  var legendEl = document.getElementById("grade-legend");
  var budgetInput = document.getElementById("budget");
  var budgetBar = document.getElementById("budget-bar");
  var budgetText = document.getElementById("budget-text");
  var budgetRange = document.getElementById("budget-range");
  var budgetHint = document.getElementById("budget-hint");
  var toastEl = document.getElementById("plan-toast");
  var modeBtns = document.querySelectorAll("[data-mode]");
  var resetBtn = document.getElementById("reset-board");
  var resetAllBtn = document.getElementById("reset-all");
  var shareBtn = document.getElementById("share-plan");
  var autoBoardBtn = document.getElementById("auto-board");
  var strictEl = document.getElementById("pri-strict");
  var autoPveBtn = document.getElementById("auto-pve");
  var reqListEls = {
    unique: document.getElementById("list-unique"),
    active: document.getElementById("list-active"),
    passive: document.getElementById("list-passive")
  };
  var cntEls = {
    unique: document.getElementById("cnt-unique"),
    active: document.getElementById("cnt-active"),
    passive: document.getElementById("cnt-passive")
  };
  var priListEl = document.getElementById("pri-list");

  var state = { cls: "gladiator", board: "nezekan", sel: null, mode: "plan" };
  var plans = {}; // cls -> { boardKey: [ "r-c", ... ] }
  var budget = { pve: 840, azphel: 232 };
  var toastTimer = null;

  /* ---------- helpers ---------- */

  function L() {
    return window.AION2_I18N ? window.AION2_I18N.lang : "en";
  }
  function isZh() {
    return !!(window.AION2_I18N && window.AION2_I18N.isZh);
  }
  function isCn() {
    return !!(window.AION2_I18N && window.AION2_I18N.isCn);
  }
  /* convert any Chinese text node inside a subtree to Simplified when needed */
  function convNode(el) {
    if (!el || !isCn()) return;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      if (/[\u4e00-\u9fff]/.test(n.nodeValue)) n.nodeValue = window.AION2_I18N.conv(n.nodeValue);
    }
  }
  function statZh(name) {
    var d = (window.AION2_NAMES || {}).stats || {};
    return d[name] || name;
  }
  function skillZh(name) {
    var d = ((window.AION2_NAMES || {}).skills || {})[state.cls] || {};
    return d[name] || name;
  }
  function zhDetail(detail) {
    return String(detail || "")
      .split(/,\s*/)
      .map(function (part) {
        var m = /^(.+?)\s*\+([\d.]+)(%?)$/.exec(part.trim());
        if (!m) return part;
        var key = m[1].replace(/\s*Bonus$/i, "").replace(/Multi-hit/, "Multi-Hit").trim();
        return statZh(key) + " +" + m[2] + (m[3] || "");
      })
      .join("、");
  }
  function pick(pair) {
    return isZh() ? pair[2] : pair[1];
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function keyOf(n) {
    return n.r + "-" + n.c;
  }
  function boardData() {
    var d = (window.AION2_BOARDS || {})[state.cls];
    return d ? d.boards[state.board] : null;
  }
  function poolOf(board) {
    return board === "azphel" ? "azphel" : "pve";
  }
  function planFor(cls) {
    if (!plans[cls]) plans[cls] = {};
    return plans[cls];
  }
  function targetMap() {
    var p = planFor(state.cls);
    if (!p.__targets) p.__targets = {};
    return p.__targets;
  }
  function targetSet() {
    return new Set(targetMap()[state.board] || []);
  }
  function ownedSet() {
    var p = planFor(state.cls);
    var set = new Set(p[state.board] || []);
    var b = boardData();
    if (b) {
      b.nodes.forEach(function (n) {
        if (n.t === "Start") set.add(keyOf(n));
      });
    }
    return set;
  }
  function savePlan(cls) {
    try {
      localStorage.setItem("aion2:plan:" + cls, JSON.stringify(planFor(cls)));
      localStorage.setItem("aion2:budget", JSON.stringify(budget));
    } catch (e) {}
  }
  function loadPlan(cls) {
    try {
      var raw = localStorage.getItem("aion2:plan:" + cls);
      if (raw) plans[cls] = JSON.parse(raw);
      var b = localStorage.getItem("aion2:budget");
      if (b) budget = JSON.parse(b);
    } catch (e) {}
  }

  function nodeMap(board) {
    var map = {};
    board.nodes.forEach(function (n) {
      map[keyOf(n)] = n;
    });
    return map;
  }

  function neighbors(map, n) {
    return [
      map[n.r + "-" + (n.c - 1)],
      map[n.r + "-" + (n.c + 1)],
      map[(n.r - 1) + "-" + n.c],
      map[(n.r + 1) + "-" + n.c]
    ].filter(Boolean);
  }

  function connected(map, owned, startKey) {
    if (!owned.has(startKey)) return false;
    var seen = new Set([startKey]);
    var queue = [startKey];
    while (queue.length) {
      var k = queue.shift();
      neighbors(map, map[k]).forEach(function (nb) {
        var nk = keyOf(nb);
        if (owned.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          queue.push(nk);
        }
      });
    }
    for (var k2 of owned) if (!seen.has(k2)) return false;
    return true;
  }

  /* cheapest path (by crystal cost) from the owned set to a node */
  function pathTo(map, owned, targetKey) {
    var dist = {};
    var prev = {};
    var seen = new Set();
    var queue = [];

    owned.forEach(function (k) {
      if (map[k]) {
        dist[k] = 0;
        queue.push(k);
        seen.add(k);
      }
    });

    while (queue.length) {
      queue.sort(function (a, b) {
        return dist[a] - dist[b];
      });
      var k = queue.shift();
      if (k === targetKey) break;
      neighbors(map, map[k]).forEach(function (nb) {
        var nk = keyOf(nb);
        if (seen.has(nk)) return;
        seen.add(nk);
        dist[nk] = dist[k] + (owned.has(nk) ? 0 : COST[nb.g] || 0);
        prev[nk] = k;
        queue.push(nk);
      });
    }

    if (!(targetKey in dist)) return null;
    var path = [];
    var cur = targetKey;
    while (cur && !owned.has(cur)) {
      path.push(cur);
      cur = prev[cur];
    }
    return path.reverse();
  }

  function spentFor(cls, pool) {
    var p = plans[cls] || {};
    var total = 0;
    var d = (window.AION2_BOARDS || {})[cls];
    if (!d) return 0;
    BOARDS.forEach(function (b) {
      if (poolOf(b[0]) !== pool) return;
      var board = d.boards[b[0]];
      var set = p[b[0]] || [];
      set.forEach(function (k) {
        var n = board.nodes.filter(function (x) {
          return keyOf(x) === k;
        })[0];
        if (n) total += COST[n.g] || 0;
      });
    });
    return total;
  }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    convNode(toastEl);
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("is-on");
    }, 2200);
  }

  /* ---------- data loading ---------- */

  function ensure(cls, done) {
    if ((window.AION2_BOARDS || {})[cls]) return done();
    var s = document.createElement("script");
    s.src = "assets/js/data/board-" + cls + ".js";
    s.onload = done;
    s.onerror = function () {
      if (infoEl) infoEl.innerHTML = '<p class="small muted">Could not load board data.</p>';
    };
    document.head.appendChild(s);
  }

  /* ---------- rendering ---------- */

  function chips(row, items, active, onPick) {
    row.innerHTML = "";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip chip--sm";
      b.setAttribute("aria-pressed", String(it[0] === active));
      b.textContent = it[1];
      b.addEventListener("click", function () {
        onPick(it[0]);
      });
      row.appendChild(b);
    });
  }

  function renderControls() {
    chips(
      clsRow,
      CLASSES.map(function (c) {
        return [c[0], pick(c)];
      }),
      state.cls,
      function (v) {
        if (v === state.cls) return;
        state.cls = v;
        state.sel = null;
        loadPlan(v);
        ensure(v, function () {
          renderControls();
          renderBoard();
        });
      }
    );

    var d = (window.AION2_BOARDS || {})[state.cls];
    chips(
      boardRow,
      BOARDS.map(function (b) {
        return [b[0], pick(b) + " · " + (d ? d.boards[b[0]].nodes.length : "")];
      }),
      state.board,
      function (v) {
        state.board = v;
        state.sel = null;
        renderControls();
        renderBoard();
      }
    );

    modeBtns.forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === state.mode));
    });
  }

  function renderLegend(board) {
    var owned = ownedSet();
    var map = nodeMap(board);
    var counts = {};
    owned.forEach(function (k) {
      var n = map[k];
      if (n) counts[n.g] = (counts[n.g] || 0) + 1;
    });
    legendEl.innerHTML = GRADES.map(function (g) {
      return (
        '<span class="legend-chip"><span class="dot dot--' +
        g[0].toLowerCase() +
        '"></span>' +
        pick(g) +
        " " +
        (counts[g[0]] || 0) +
        " / " +
        board.grades[g[0]] +
        "</span>"
      );
    }).join("");
  }

  function nodeCost(n) {
    return COST[n.g] || 0;
  }

  function renderGrid() {
    var board = boardData();
    var map = nodeMap(board);
    var owned = ownedSet();
    var start = board.nodes.filter(function (n) {
      return n.t === "Start";
    })[0];

    gridEl.style.gridTemplateColumns = "repeat(" + board.cols + ", minmax(0, 1fr))";
    gridEl.innerHTML = "";

    var avail = new Set();
    owned.forEach(function (k) {
      if (!map[k]) return;
      neighbors(map, map[k]).forEach(function (nb) {
        var nk = keyOf(nb);
        if (!owned.has(nk)) avail.add(nk);
      });
    });

    var frag = document.createDocumentFragment();
    var req = targetSet();
    board.nodes.forEach(function (n) {
      var k = keyOf(n);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "node node--" + n.g.toLowerCase();
      b.style.gridRow = n.r;
      b.style.gridColumn = n.c;
      b.dataset.k = k;
      b.setAttribute(
        "aria-label",
        n.n + " · " + n.g + " · " + (isZh() ? "花費 " : "cost ") + nodeCost(n)
      );
      if (owned.has(k)) b.classList.add("is-owned");
      else if (avail.has(k)) b.classList.add("is-avail");
      if (req.has(k)) b.classList.add("is-req");
      if (state.sel === k) b.classList.add("is-sel");

      b.addEventListener("mouseenter", function () {
        showNode(n);
      });
      b.addEventListener("focus", function () {
        showNode(n);
      });
      b.addEventListener("click", function () {
        state.sel = k;
        if (state.mode === "plan") allocate(n);
        else if (state.mode === "target") toggleTarget(n);
        else {
          markSelected();
          showNode(n);
        }
      });
      frag.appendChild(b);
    });
    gridEl.appendChild(frag);

    // start node tooltip
    if (start && !state.sel) {
      // nothing; keep default text
    }
  }

  function markSelected() {
    gridEl.querySelectorAll(".node").forEach(function (el) {
      el.classList.toggle("is-sel", el.dataset.k === state.sel);
    });
  }

  function toggleTarget(n) {
    if (n.t === "Start") {
      toast(isZh() ? "起始節點本來就會連通，不用標記" : "The start node is always connected — nothing to mark");
      return;
    }
    var tm = targetMap();
    var set = new Set(tm[state.board] || []);
    var k = keyOf(n);
    if (set.has(k)) set.delete(k);
    else set.add(k);
    tm[state.board] = Array.from(set);
    savePlan(state.cls);
    refreshBoardOnly();
    showNode(n);
    toast(
      isZh()
        ? (set.has(k) ? "已標記需求：" : "已移除需求：") + (isZh() ? (n.t === "SkillLevel" ? skillZh(n.n) : statZh(n.n)) : n.n)
        : (set.has(k) ? "Required: " : "Removed: ") + n.n
    );
  }

  /* cheapest connected set that contains the start node and every target */
  function solveBoard(board, req) {
    var map = nodeMap(board);
    var idx = new Map();
    board.nodes.forEach(function (n, i) {
      idx.set(keyOf(n), i);
    });
    var cost = board.nodes.map(function (n) {
      return COST[n.g] || 0;
    });
    var adj = board.nodes.map(function (n) {
      return neighbors(map, n).map(function (m) {
        return idx.get(keyOf(m));
      });
    });
    var terms = [];
    var startKey = null;
    board.nodes.forEach(function (n, i) {
      if (n.t === "Start") {
        startKey = keyOf(n);
        terms.push(i);
      }
    });
    req.forEach(function (k) {
      var i = idx.get(k);
      if (i != null && terms.indexOf(i) < 0) terms.push(i);
    });
    if (terms.length <= 1) return { keys: startKey ? [startKey] : [], cost: 0, exact: true };

    var res = window.AION2_SOLVE.steiner(board.nodes.length, adj, cost, terms);
    if (!res || !res.set.size) return null;
    return {
      keys: Array.from(res.set).map(function (i) {
        return keyOf(board.nodes[i]);
      }),
      cost: res.cost,
      exact: res.exact
    };
  }

  function allocate(n) {
    var board = boardData();
    var map = nodeMap(board);
    var owned = ownedSet();
    var k = keyOf(n);

    if (n.t === "Start") {
      showNode(n);
      toast(isZh() ? "起始節點不能退還" : "The start node cannot be refunded");
      return;
    }

    if (owned.has(k)) {
      refund(n, map, owned);
      return;
    }

    var pool = poolOf(state.board);
    var path = pathTo(map, owned, k);
    if (!path) {
      toast(isZh() ? "沒有連通路徑" : "No connected path");
      return;
    }
    var cost = path.reduce(function (sum, key) {
      return sum + (COST[map[key].g] || 0);
    }, 0);
    var left = budget[pool] - spentFor(state.cls, pool);
    if (cost > left) {
      toast(
        isZh()
          ? "結晶不足：這條路線要 " + cost + "，只剩 " + left
          : "Not enough crystals: path costs " + cost + ", " + left + " left"
      );
      return;
    }

    var p = planFor(state.cls);
    var set = new Set(p[state.board] || []);
    path.forEach(function (key) {
      set.add(key);
    });
    p[state.board] = Array.from(set);
    savePlan(state.cls);
    showNode(n);
    renderBoard();
  }

  function refund(n, map, owned) {
    var k = keyOf(n);
    if (n.t === "Start") {
      toast(isZh() ? "起始節點不能退還" : "The start node cannot be refunded");
      return;
    }
    var next = new Set(owned);
    next.delete(k);
    var startKey = null;
    boardData().nodes.some(function (x) {
      if (x.t === "Start") {
        startKey = keyOf(x);
        return true;
      }
      return false;
    });
    if (!connected(map, next, startKey)) {
      toast(
        isZh()
          ? "這個節點被其他節點依賴，先退外圍的"
          : "Other nodes depend on this one — refund the outer ones first"
      );
      return;
    }
    var p = planFor(state.cls);
    p[state.board] = Array.from(next);
    savePlan(state.cls);
    showNode(n);
    renderBoard();
  }

  function showNode(n) {
    var cost = nodeCost(n);
    var owned = ownedSet().has(keyOf(n));
    var gradeLabel =
      n.g === "Start"
        ? isZh()
          ? "起始節點"
          : "Starting node"
        : n.g + " · " + (isZh() ? "花費 " : "cost ") + cost + (isZh() ? " 結晶" : " crystals");
    var zhName = n.t === "SkillLevel" ? skillZh(n.n) : statZh(n.n);
    var name = isZh() ? zhName : n.n;

    infoEl.innerHTML =
      '<span class="node-grade node-grade--' +
      n.g.toLowerCase() +
      '">' +
      gradeLabel +
      (owned ? " · " + (isZh() ? "已取得" : "taken") : "") +
      "</span>" +
      '<h3 class="node-name">' +
      esc(name) +
      "</h3>" +
      (isZh() && zhName !== n.n ? '<p class="small muted mono">' + esc(n.n) + "</p>" : "") +
      (n.t === "SkillLevel"
        ? '<p class="small muted">' + (isZh() ? "主動技能 +1 級" : "Active skill +1 rank") + "</p>"
        : '<p class="small muted">' + esc(isZh() ? zhDetail(n.d) : n.d) + "</p>") +
      '<p class="small muted mono">r' +
      n.r +
      " c" +
      n.c +
      " · " +
      (state.mode === "plan"
        ? isZh()
          ? "點擊" + (owned ? "退還" : "取得")
          : "Click to " + (owned ? "refund" : "take")
        : isZh()
        ? "點擊標記需求"
        : "Click to mark as required") +
      "</p>";

    convNode(infoEl);
  }

  /* stat aggregation for owned nodes */
  function statTotals(board, owned) {
    var totals = {};
    board.nodes.forEach(function (n) {
      if (n.t !== "Stat" || !owned.has(keyOf(n))) return;
      String(n.d || "")
        .split(/,\s*/)
        .forEach(function (part) {
          var m = /^(.+?)\s*\+([\d.]+)(%?)$/.exec(part.trim());
          if (!m) return;
          var key = m[1].replace(/\s*Bonus$/i, "").replace(/Multi-hit/, "Multi-Hit").trim();
          totals[key] = totals[key] || { v: 0, pct: m[3] === "%" };
          totals[key].v = Math.round((totals[key].v + parseFloat(m[2])) * 100) / 100;
        });
    });
    return Object.keys(totals)
      .sort()
      .map(function (k) {
        return (isZh() ? statZh(k) : k) + " +" + totals[k].v + (totals[k].pct ? "%" : "");
      });
  }

  function skillRanks(board, owned) {
    var map = {};
    board.nodes.forEach(function (n) {
      if (n.t !== "SkillLevel" || !owned.has(keyOf(n))) return;
      var name = n.n.replace(/\s*\+\d+$/, "");
      map[name] = (map[name] || 0) + 1;
    });
    return Object.keys(map)
      .sort()
      .map(function (k) {
        return (isZh() ? skillZh(k) : k) + " +" + map[k];
      });
  }

  function renderSummary() {
    var board = boardData();
    var owned = ownedSet();
    var pool = poolOf(state.board);
    var spentAll = spentFor(state.cls, pool);
    var cap = budget[pool];
    var boardSpent = 0;
    owned.forEach(function (k) {
      var n = board.nodes.filter(function (x) {
        return keyOf(x) === k;
      })[0];
      if (n) boardSpent += COST[n.g] || 0;
    });

    if (budgetBar) budgetBar.style.width = Math.min(100, (spentAll / cap) * 100) + "%";
    if (budgetText) {
      budgetText.textContent =
        spentAll + " / " + cap + (isZh() ? " 顆結晶" : " crystals") + (pool === "azphel" ? (isZh() ? "（Azphel 獨立池）" : " (Azphel pool)") : "");
    }

    var stats = statTotals(board, owned);
    var skills = skillRanks(board, owned);

    sumEl.innerHTML =
      '<h3 class="small-caps">' + (isZh() ? "本盤配置" : "This board") + "</h3>" +
      '<p class="small muted">' +
      (isZh() ? "節點 " : "Nodes ") +
      owned.size +
      " · " +
      (isZh() ? "本盤 " : "board ") +
      boardSpent +
      (isZh() ? " 結晶 · 全池 " : " crystals · pool ") +
      spentAll +
      "/" +
      cap +
      "</p>" +
      '<div class="stat-chips">' +
      (stats.length
        ? stats
            .map(function (t) {
              return '<span class="stat-chip">' + esc(t) + "</span>";
            })
            .join("")
        : '<span class="small muted">' + (isZh() ? "尚未取得節點" : "No nodes taken yet") + "</span>") +
      "</div>" +
      (skills.length
        ? '<h3 class="small-caps" style="margin-top:16px">' +
          (isZh() ? "技能等級" : "Skill ranks") +
          "</h3><div class=\"stat-chips\">" +
          skills
            .map(function (t) {
              return '<span class="stat-chip">' + esc(t) + "</span>";
            })
            .join("") +
          "</div>"
        : "");
  }

  /* stats table: what is already taken vs what the full board(s) would give */
  function renderTotals() {
    var el = document.getElementById("total-summary");
    if (!el) return;
    var d = (window.AION2_BOARDS || {})[state.cls];
    if (!d) return;
    var p = planFor(state.cls);
    var scope = state.totalsScope || "board";
    var boards = scope === "all"
      ? BOARDS.map(function (b) {
          return b[0];
        })
      : [state.board];

    var stats = {};
    var skills = {};
    var spent = { pve: 0, azphel: 0 };

    boards.forEach(function (b) {
      var board = d.boards[b];
      if (!board) return;
      var owned = new Set(p[b] || []);
      board.nodes.forEach(function (n) {
        if (n.t === "Start") owned.add(keyOf(n));
      });
      var isOwned = owned.size > 1;
      var cost = 0;

      board.nodes.forEach(function (n) {
        var taken = owned.has(keyOf(n));
        if (taken) cost += COST[n.g] || 0;
        if (n.t === "Stat") {
          String(n.d || "")
            .split(/,\s*/)
            .forEach(function (part) {
              var m = /^(.+?)\s*\+([\d.]+)(%?)$/.exec(part.trim());
              if (!m) return;
              var key = m[1].replace(/\s*Bonus$/i, "").replace(/Multi-hit/, "Multi-Hit").trim();
              var row = (stats[key] = stats[key] || { took: 0, tookN: 0, full: 0, fullN: 0, pct: m[3] === "%" });
              row.full += parseFloat(m[2]);
              row.fullN += 1;
              if (taken) {
                row.took += parseFloat(m[2]);
                row.tookN += 1;
              }
            });
        } else if (n.t === "SkillLevel") {
          var name = n.n.replace(/\s*\+\d+$/, "");
          var s = (skills[name] = skills[name] || { took: 0, full: 0 });
          s.full += 1;
          if (taken) s.took += 1;
        }
      });
      if (isOwned) spent[poolOf(b)] += cost;
    });

    var fmt = function (v, pct) {
      var n = Math.round(v * 100) / 100;
      return "+" + n + (pct ? "%" : "");
    };

    var statRows = Object.keys(stats)
      .filter(function (k) {
        return stats[k].fullN > 0;
      })
      .sort()
      .map(function (k) {
        var r = stats[k];
        return (
          "<tr><td>" +
          esc(isZh() ? statZh(k) : k) +
          '</td><td><b>' +
          fmt(r.took, r.pct) +
          '</b> <span class="dim">(' +
          r.tookN +
          ")</span></td><td>" +
          fmt(r.full, r.pct) +
          ' <span class="dim">(' +
          r.fullN +
          ")</span></td></tr>"
        );
      })
      .join("");

    var skillRows = Object.keys(skills)
      .sort()
      .map(function (k) {
        var r = skills[k];
        return (
          "<tr><td>" +
          esc(isZh() ? skillZh(k) : k) +
          '</td><td><b>+' +
          r.took +
          '</b> <span class="dim">(' +
          r.took +
          ")</span></td><td>+" +
          r.full +
          ' <span class="dim">(' +
          r.full +
          ")</span></td></tr>"
        );
      })
      .join("");

    var pools =
      "PvE " + spent.pve + " / " + budget.pve + (spent.azphel ? " · Azphel " + spent.azphel + " / " + budget.azphel : "");

    el.innerHTML =
      '<div class="tot-head">' +
      '<div class="tot-tabs"><button type="button" data-scope="board" aria-pressed="' +
      (scope === "board") +
      '">' +
      (isZh() ? "本頁" : "This board") +
      '</button><button type="button" data-scope="all" aria-pressed="' +
      (scope === "all") +
      '">' +
      (isZh() ? "全盤合計" : "All boards") +
      "</button></div>" +
      '<span class="small muted">' +
      pools +
      "</span></div>" +
      '<table class="tot-table"><thead><tr><th>' +
      (isZh() ? "屬性" : "Stat") +
      "</th><th>" +
      (isZh() ? "已點（格）" : "Taken (nodes)") +
      "</th><th>" +
      (isZh() ? "滿盤（格）" : "Full board (nodes)") +
      "</th></tr></thead><tbody>" +
      statRows +
      "</tbody></table>" +
      (skillRows
        ? '<div class="tot-sub">' +
          (isZh() ? "技能節點" : "Skill nodes") +
          '</div><table class="tot-table"><tbody>' +
          skillRows +
          "</tbody></table>"
        : "");
    convNode(el);
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-scope]");
    if (!b || !e.target.closest("#total-summary")) return;
    state.totalsScope = b.getAttribute("data-scope");
    renderTotals();
  });

  function renderBoard() {
    if (!boardData()) return;
    renderLegend(boardData());
    renderGrid();
    renderSummary();
    renderReqLists();
    updateBudgetUI();
    renderTotals();
    if (state.sel) {
      var n = nodeMap(boardData())[state.sel];
      if (n) showNode(n);
    } else {
      infoEl.innerHTML =
        '<h3 class="node-name">' +
        pick(BOARDS.filter(function (b) { return b[0] === state.board; })[0]) +
        "</h3><p class=\"small muted\">" +
        (isZh()
          ? "點擊節點取得，點已取得的節點退還；遠的節點會自動走最省路線。"
          : "Click a node to take it, click again to refund. Distant nodes take the cheapest path.") +
        "</p>";
      convNode(infoEl);
    }

    convNode(root);
  }

  /* ---------- toolbar ---------- */

  modeBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      state.mode = b.getAttribute("data-mode");
      modeBtns.forEach(function (x) {
        x.setAttribute("aria-pressed", String(x === b));
      });
    });
  });

  /* ---------- crystal cap ---------- */

  var minCache = {};

  function targetsKey(pool) {
    var parts = [];
    BOARDS.forEach(function (b) {
      if (poolOf(b[0]) !== pool) return;
      var t = targetMap()[b[0]] || [];
      if (t.length) parts.push(b[0] + ":" + t.slice().sort().join(","));
    });
    return state.cls + "|" + pool + "|" + parts.join(";");
  }

  /* crystals the checked targets need, summed over every board in the pool */
  function poolMin(pool) {
    var key = targetsKey(pool);
    if (minCache[key] != null) return minCache[key];
    var total = 0;
    var d = (window.AION2_BOARDS || {})[state.cls];
    if (d) {
      BOARDS.forEach(function (b) {
        if (poolOf(b[0]) !== pool) return;
        var req = new Set(targetMap()[b[0]] || []);
        if (!req.size) return;
        var sol = solveBoard(d.boards[b[0]], req);
        if (sol) total += sol.cost;
      });
    }
    minCache[key] = total;
    return total;
  }

  function capMaxFor(pool) {
    return pool === "azphel" ? 232 : 840;
  }

  function setBudget(v, skipSave) {
    var pool = poolOf(state.board);
    v = parseInt(v, 10);
    if (isNaN(v)) v = 0;
    budget[pool] = Math.max(0, Math.min(capMaxFor(pool), v));
    if (!skipSave) savePlan(state.cls);
    renderSummary();
    updateBudgetUI();
  }

  function updateBudgetUI() {
    var pool = poolOf(state.board);
    var max = capMaxFor(pool);
    var cap = budget[pool];
    var min = Math.min(poolMin(pool), max);
    if (budgetRange) {
      budgetRange.min = min;
      budgetRange.max = max;
      budgetRange.value = Math.max(min, Math.min(cap, max));
    }
    if (budgetInput && document.activeElement !== budgetInput) {
      budgetInput.max = max;
      budgetInput.value = cap;
    }
    if (budgetHint) {
      budgetHint.textContent = isZh()
        ? "可設定 " + min + " – " + max + " 顆" + (min ? "（勾選的需求至少 " + min + " 顆）" : "")
        : "Range " + min + " – " + max + (min ? " (targets need at least " + min + ")" : "");
      convNode(budgetHint);
    }
  }

  if (budgetRange) {
    budgetRange.addEventListener("input", function () {
      setBudget(budgetRange.value);
      budgetRange.min = Math.min(poolMin(poolOf(state.board)), capMaxFor(poolOf(state.board)));
    });
  }
  if (budgetInput) {
    budgetInput.addEventListener("change", function () {
      setBudget(budgetInput.value);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      var p = planFor(state.cls);
      p[state.board] = [];
      savePlan(state.cls);
      state.sel = null;
      renderBoard();
      toast(isZh() ? "已重置本盤" : "Board reset");
    });
  }
  if (resetAllBtn) {
    resetAllBtn.addEventListener("click", function () {
      plans[state.cls] = {};
      savePlan(state.cls);
      state.sel = null;
      renderBoard();
      toast(isZh() ? "已清空這個職業" : "Class cleared");
    });
  }
  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      var p = planFor(state.cls);
      var payload = { c: state.cls, b: state.board };
      BOARDS.forEach(function (b) {
        if (p[b[0]] && p[b[0]].length) payload[b[0]] = p[b[0]];
      });
      var hash = "#plan=" + encodeURIComponent(JSON.stringify(payload));
      history.replaceState(null, "", hash);
      var url = location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () {
            toast(isZh() ? "連結已複製" : "Link copied");
          },
          function () {
            toast(isZh() ? "已更新網址" : "URL updated");
          }
        );
      } else {
        toast(isZh() ? "已更新網址" : "URL updated");
      }
    });
  }

  /* ---------- auto route ---------- */

  var DEFAULT_ORDER = ["Attack", "Critical Hit", "Defense", "Max HP", "Max MP", "Critical Hit Resist"];

  function orderFor(cls) {
    var p = planFor(cls);
    if (!Array.isArray(p.__order) || p.__order.length !== DEFAULT_ORDER.length) {
      p.__order = DEFAULT_ORDER.slice();
    }
    return p.__order;
  }

  /* checkbox lists: special / active / passive nodes of the current board */
  function renderReqLists() {
    var board = boardData();
    var chosen = targetSet();
    var groups = {
      unique: board.nodes.filter(function (n) { return n.g === "Unique"; }),
      active: board.nodes.filter(function (n) { return n.t === "SkillLevel" && n.g === "Epic"; }),
      passive: board.nodes.filter(function (n) { return n.t === "SkillLevel" && n.g === "Rare"; })
    };
    Object.keys(groups).forEach(function (key) {
      var list = groups[key];
      var el = reqListEls[key];
      if (!el) return;
      var picked = 0;
      el.innerHTML = list
        .map(function (n) {
          var k = keyOf(n);
          var on = chosen.has(k);
          if (on) picked++;
          var name = isZh() ? (n.t === "SkillLevel" ? skillZh(n.n) : statZh(n.n)) : n.n;
          var eff =
            n.t === "SkillLevel"
              ? isZh()
                ? "技能 +1"
                : "+1 rank"
              : isZh()
              ? zhDetail(n.d || "")
              : n.d || "";
          return (
            '<label class="req-row"><input type="checkbox" data-k="' +
            k +
            '"' +
            (on ? " checked" : "") +
            "><span class=\"req-name\">" +
            esc(name) +
            '</span><span class="req-eff">' +
            esc(eff) +
            "</span></label>"
          );
        })
        .join("");
      if (cntEls[key]) cntEls[key].textContent = picked + "/" + list.length;
      convNode(el);
    });
    renderPriority();
  }

  /* which stats the auto build is allowed to spend on */
  function isStrict() {
    return !!planFor(state.cls).__strict;
  }
  function setStrict(v) {
    planFor(state.cls).__strict = !!v;
    savePlan(state.cls);
    if (strictEl) strictEl.checked = !!v;
  }

  function enabledSet() {
    var p = planFor(state.cls);
    var off = p.__off || {};
    return new Set(
      orderFor(state.cls).filter(function (s) {
        return !off[s];
      })
    );
  }
  function isStatOn(stat) {
    var p = planFor(state.cls);
    return !(p.__off || {})[stat];
  }
  function toggleStat(stat, on) {
    var p = planFor(state.cls);
    p.__off = p.__off || {};
    if (on) delete p.__off[stat];
    else p.__off[stat] = true;
    savePlan(state.cls);
  }

  function renderPriority() {
    if (!priListEl) return;
    var order = orderFor(state.cls);
    priListEl.innerHTML = order
      .map(function (stat, i) {
        return (
          '<div class="pri-row' +
          (isStatOn(stat) ? "" : " is-off") +
          '"><label class="pri-check"><input type="checkbox" data-stat="' +
          stat +
          '"' +
          (isStatOn(stat) ? " checked" : "") +
          "></label>" +
          '<span class="pri-idx">' +
          (i + 1) +
          '</span><span class="pri-name">' +
          esc(isZh() ? statZh(stat) : stat) +
          '</span><span class="pri-btns"><button type="button" data-move="-1" data-i="' +
          i +
          '"' +
          (i === 0 ? " disabled" : "") +
          ">↑</button><button type=\"button\" data-move=\"1\" data-i=\"" +
          i +
          '"' +
          (i === order.length - 1 ? " disabled" : "") +
          ">↓</button></span></div>"
        );
      })
      .join("");
    convNode(priListEl);
    if (strictEl) strictEl.checked = isStrict();
  }

  if (strictEl) {
    strictEl.addEventListener("change", function () {
      setStrict(strictEl.checked);
    });
  }

  if (priListEl) {
    priListEl.addEventListener("change", function (e) {
      var cb = e.target.closest("input[data-stat]");
      if (!cb) return;
      toggleStat(cb.getAttribute("data-stat"), cb.checked);
      renderPriority();
    });
  }

  var presetRow = document.getElementById("pri-presets");
  if (presetRow) {
    presetRow.addEventListener("click", function (e) {
      var b = e.target.closest("[data-preset]");
      if (!b) return;
      var p = planFor(state.cls);
      p.__off = {};
      var isAtkCrit = b.getAttribute("data-preset") === "atkcrit";
      if (isAtkCrit) {
        orderFor(state.cls).forEach(function (s) {
          if (s !== "Attack" && s !== "Critical Hit") p.__off[s] = true;
        });
        p.__order = ["Attack", "Critical Hit"].concat(
          orderFor(state.cls).filter(function (s) {
            return s !== "Attack" && s !== "Critical Hit";
          })
        );
      }
      p.__strict = isAtkCrit;
      savePlan(state.cls);
      renderPriority();
      if (strictEl) strictEl.checked = isAtkCrit;
      toast(
        isZh()
          ? isAtkCrit
            ? "已設為只點攻擊＋暴擊"
            : "已勾選全部屬性"
          : "Priority updated"
      );
    });
  }

  function updateCounts() {
    var board = boardData();
    var chosen = targetSet();
    var groups = {
      unique: board.nodes.filter(function (n) { return n.g === "Unique"; }),
      active: board.nodes.filter(function (n) { return n.t === "SkillLevel" && n.g === "Epic"; }),
      passive: board.nodes.filter(function (n) { return n.t === "SkillLevel" && n.g === "Rare"; })
    };
    Object.keys(groups).forEach(function (k) {
      if (!cntEls[k]) return;
      var on = groups[k].filter(function (n) { return chosen.has(keyOf(n)); }).length;
      cntEls[k].textContent = on + "/" + groups[k].length;
    });
  }

  function syncTargetUI() {
    var chosen = targetSet();
    Object.keys(reqListEls).forEach(function (key) {
      var el = reqListEls[key];
      if (!el) return;
      el.querySelectorAll("input[data-k]").forEach(function (cb) {
        cb.checked = chosen.has(cb.getAttribute("data-k"));
      });
    });
    updateCounts();
  }

  /* light refresh: board + counts, without rebuilding the checkbox lists */
  function refreshBoardOnly() {
    renderGrid();
    renderSummary();
    syncTargetUI();
    updateBudgetUI();
  }

  Object.keys(reqListEls).forEach(function (key) {
    var el = reqListEls[key];
    if (!el) return;
    el.addEventListener("change", function (e) {
      var cb = e.target.closest("input[data-k]");
      if (!cb) return;
      var k = cb.getAttribute("data-k");
      var tm = targetMap();
      var set = new Set(tm[state.board] || []);
      if (cb.checked) set.add(k);
      else set.delete(k);
      tm[state.board] = Array.from(set);
      savePlan(state.cls);
      refreshBoardOnly();
    });
  });

  if (priListEl) {
    priListEl.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-move]");
      if (!b || b.disabled) return;
      var i = +b.getAttribute("data-i");
      var d = +b.getAttribute("data-move");
      var order = orderFor(state.cls).slice();
      var t = order[i];
      order[i] = order[i + d];
      order[i + d] = t;
      planFor(state.cls).__order = order;
      savePlan(state.cls);
      renderPriority();
    });
  }

  /* fill one board in priority order, each step along the cheapest path */
  function autoFill(board, startOwned, budgetLeft, order, enabled, strict) {
    var map = nodeMap(board);
    var set = new Set(startOwned);
    var spent = 0;

    function bestFor(pred) {
      var best = null;
      board.nodes.forEach(function (n) {
        var k = keyOf(n);
        if (set.has(k) || !pred(n)) return;
        var path = pathTo(map, set, k);
        if (!path) return;
        var cost = path.reduce(function (s, key) {
          return s + (COST[map[key].g] || 0);
        }, 0);
        if (spent + cost > budgetLeft) return;
        if (!best || cost < best.cost) best = { path: path, cost: cost };
      });
      return best;
    }

    function take(step) {
      step.path.forEach(function (k) {
        set.add(k);
      });
      spent += step.cost;
    }

    var step;
    order.forEach(function (stat) {
      if (!enabled.has(stat)) return;
      while ((step = bestFor(function (n) { return n.t === "Stat" && n.n === stat; }))) take(step);
    });
    /* strict: only the enabled stats may be taken; otherwise fill anything */
    while (
      (step = bestFor(
        strict
          ? function (n) {
              return n.t === "Stat" && enabled.has(n.n);
            }
          : function () {
              return true;
            }
      ))
    )
      take(step);

    return { owned: Array.from(set), spent: spent };
  }

  function applyAuto(boards) {
    var cls = state.cls;
    var pool = poolOf(boards[0]);
    var cap = budget[pool];
    var p = planFor(cls);
    var order = orderFor(cls).slice();
    var enabled = enabledSet();
    var strict = isStrict();

    if (!enabled.size) {
      toast(isZh() ? "先在「一般節點優先度」勾選至少一個屬性" : "Tick at least one stat in General priority first");
      return;
    }

    /* budget still available once the covered boards are freed up */
    var base = spentFor(cls, pool);
    boards.forEach(function (b) {
      var board = ((window.AION2_BOARDS || {})[cls] || {}).boards[b];
      if (!board) return;
      var map = nodeMap(board);
      (p[b] || []).forEach(function (k) {
        if (map[k]) base -= COST[map[k].g] || 0;
      });
    });
    var remain = Math.max(0, cap - base);
    if (remain <= 0) {
      toast(isZh() ? "結晶池已經滿了，先清空或調高上限" : "The crystal pool is already spent — reset or raise the cap");
      return;
    }

    /* phase 1: solve every board's targets before spending anything on fillers */
    var solved = {};
    var report = [];
    var targetCost = 0;
    var short = null;
    var budgetLeft = remain;

    boards.forEach(function (b) {
      var board = ((window.AION2_BOARDS || {})[cls] || {}).boards[b];
      if (!board) return;
      var req = new Set((targetMap()[b] || []));
      if (!req.size) return;
      var sol = solveBoard(board, req);
      if (!sol) return;
      if (sol.cost > budgetLeft) {
        short = { cost: sol.cost, left: budgetLeft, board: b };
        return;
      }
      solved[b] = sol.keys;
      budgetLeft -= sol.cost;
      targetCost += sol.cost;
      report.push({ b: b, cost: sol.cost });
    });

    if (short) {
      toast(
        isZh()
          ? "「" + pick(BOARDS.filter(function (x) { return x[0] === short.board; })[0]) + "」的需求最少要 " + short.cost + " 顆，這個池只剩 " + short.left + " 顆"
          : "Targets on that board need " + short.cost + " crystals; only " + short.left + " left"
      );
      return;
    }

    /* phase 2: apply the routes, then share whatever is left as filler */
    var fillRemain = remain - targetCost;
    var added = targetCost;
    var spend = [];
    boards.forEach(function (b) {
      var board = ((window.AION2_BOARDS || {})[cls] || {}).boards[b];
      if (!board) return;
      var map = nodeMap(board);
      var keys = solved[b] || [];
      var keysCost = keys.reduce(function (sum, k) {
        return sum + (map[k] ? COST[map[k].g] || 0 : 0);
      }, 0);
      p[b] = keys;
      var boardSpent = keysCost;

      if (fillRemain > 0) {
        var owned = new Set(keys);
        board.nodes.forEach(function (n) {
          if (n.t === "Start") owned.add(keyOf(n));
        });
        var fill = autoFill(board, owned, fillRemain, order, enabled, strict);
        p[b] = fill.owned;
        fillRemain -= fill.spent;
        added += fill.spent;
        boardSpent += fill.spent;
      }
      spend.push({ b: b, cost: boardSpent });
    });
    remain = fillRemain;

    savePlan(cls);
    state.sel = null;
    renderBoard();

    var label = function (b) {
      var row = BOARDS.filter(function (x) {
        return x[0] === b;
      })[0];
      return row ? pick(row) : b;
    };

    var names = report.map(function (r) {
      return label(r.b) + " " + r.cost;
    });
    var detail =
      names.length > 1
        ? (isZh() ? "需求最優：" : "Targets: ") + names.join(" + ") + " = " + targetCost + (isZh() ? " 顆" : "")
        : names.length === 1
        ? (isZh() ? "需求最優 " : "Targets ") + targetCost + (isZh() ? " 顆" : "")
        : "";

    var spread =
      spend.length > 1
        ? spend
            .filter(function (s) {
              return s.cost > 0;
            })
            .map(function (s) {
              return label(s.b) + " " + s.cost;
            })
            .join(" + ")
        : "";

    toast(
      isZh()
        ? (spread ? "四盤：" + spread + " = " + added + " 顆｜" : detail ? detail + "｜" : "") +
            "共配置 " + added + " 顆，剩餘 " + remain
        : (spread ? "Boards: " + spread + " = " + added + " | " : detail ? detail + " | " : "") +
            "spent " + added + ", " + remain + " left"
    );
  }

  if (autoBoardBtn) {
    autoBoardBtn.addEventListener("click", function () {
      applyAuto([state.board]);
    });
  }
  if (autoPveBtn) {
    autoPveBtn.addEventListener("click", function () {
      applyAuto(["nezekan", "zikel", "vaizel", "triniel"]);
      if (state.board === "azphel") {
        state.board = "nezekan";
        renderControls();
        renderBoard();
      }
    });
  }

  /* restore from a shared link */
  function readLink() {
    var m = /#plan=(.+)$/.exec(location.hash);
    if (!m) return null;
    try {
      return JSON.parse(decodeURIComponent(m[1]));
    } catch (e) {
      return null;
    }
  }

  function boot() {
    var link = readLink();
    if (link && link.c) {
      state.cls = link.c;
      state.board = link.b || "nezekan";
      plans[state.cls] = {};
      BOARDS.forEach(function (b) {
        if (Array.isArray(link[b[0]])) plans[state.cls][b[0]] = link[b[0]];
      });
      savePlan(state.cls);
    } else {
      loadPlan(state.cls);
    }

    ensure(state.cls, function () {
      renderControls();
      renderBoard();
    });
  }

  document.addEventListener("langchange", function () {
    renderControls();
    renderBoard();
  });

  window.addEventListener("hashchange", function () {
    var l = readLink();
    if (l && l.c) boot();
  });

  boot();
})();
