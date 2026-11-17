/* Steiner tree solver for the Daevanion planner.
 *
 * Given a grid graph whose node weights are crystal costs, find the cheapest
 * connected set of nodes that contains every terminal (the start node is a
 * free terminal). Exact Dreyfus–Wagner DP for up to 12 terminals; greedy
 * nearest-terminal otherwise.
 *
 * window.AION2_SOLVE.steiner(nodeCount, adjacency, cost, terminalIndices)
 *   → { set: Set<number>, cost: number, exact: boolean }
 */
(function () {
  "use strict";

  var INF = 1e9;

  function relax(n, adj, cost, dist, prev, used) {
    used.fill(0);
    for (var it = 0; it < n; it++) {
      var u = -1;
      var best = INF;
      for (var i = 0; i < n; i++) {
        if (!used[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      }
      if (u < 0) break;
      used[u] = 1;
      var list = adj[u];
      for (var q = 0; q < list.length; q++) {
        var w = list[q];
        var nd = dist[u] + cost[w];
        if (nd < dist[w]) {
          dist[w] = nd;
          if (prev) prev[w] = u;
        }
      }
    }
  }

  function exact(n, adj, cost, terms) {
    var k = terms.length;
    var full = 1 << k;
    var dp = [];
    var split = [];
    var prev = [];
    for (var m = 0; m < full; m++) {
      dp.push(new Float64Array(n).fill(INF));
      split.push(new Int16Array(n).fill(-1));
      prev.push(new Int16Array(n).fill(-1));
    }
    for (var i = 0; i < k; i++) dp[1 << i][terms[i]] = cost[terms[i]];

    var used = new Uint8Array(n);
    for (var mask = 1; mask < full; mask++) {
      var d = dp[mask];
      var sp = split[mask];
      var pr = prev[mask];

      for (var sub = (mask - 1) & mask; sub > 0; sub = (sub - 1) & mask) {
        var other = mask ^ sub;
        if (sub > other) continue;
        var a = dp[sub];
        var b = dp[other];
        for (var v = 0; v < n; v++) {
          var val = a[v] + b[v] - cost[v];
          if (val < d[v]) {
            d[v] = val;
            sp[v] = sub;
          }
        }
      }

      relax(n, adj, cost, d, pr, used);
    }

    var endMask = full - 1;
    var endV = -1;
    var endVal = INF;
    for (var x = 0; x < n; x++) {
      if (dp[endMask][x] < endVal) {
        endVal = dp[endMask][x];
        endV = x;
      }
    }

    var set = new Set();
    function build(mask, v) {
      if (mask <= 0 || v < 0) return;
      set.add(v);
      var s = split[mask][v];
      if (s > 0 && dp[mask][v] === dp[s][v] + dp[mask ^ s][v] - cost[v]) {
        build(s, v);
        build(mask ^ s, v);
        return;
      }
      var p = prev[mask][v];
      if (p >= 0) build(mask, p);
    }
    build(endMask, endV);

    return { set: set, cost: endVal, exact: true };
  }

  function greedy(n, adj, cost, terms) {
    var set = new Set([terms[0]]);
    var pending = terms.slice(1);
    var used = new Uint8Array(n);
    while (pending.length) {
      var dist = new Float64Array(n).fill(INF);
      var prev = new Int16Array(n).fill(-1);
      set.forEach(function (s) {
        dist[s] = 0;
      });
      relax(n, adj, cost, dist, prev, used);

      var bestIdx = -1;
      var bestVal = INF;
      for (var i = 0; i < pending.length; i++) {
        if (dist[pending[i]] < bestVal) {
          bestVal = dist[pending[i]];
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;

      var v = pending.splice(bestIdx, 1)[0];
      while (v >= 0 && !set.has(v)) {
        set.add(v);
        v = prev[v];
      }
    }
    var total = 0;
    set.forEach(function (i) {
      total += cost[i];
    });
    return { set: set, cost: total, exact: false };
  }

  window.AION2_SOLVE = {
    steiner: function (n, adj, cost, terms) {
      if (!terms.length) return { set: new Set(), cost: 0, exact: true };
      if (terms.length === 1) return { set: new Set([terms[0]]), cost: cost[terms[0]], exact: true };
      return terms.length <= 12 ? exact(n, adj, cost, terms) : greedy(n, adj, cost, terms);
    }
  };
})();
