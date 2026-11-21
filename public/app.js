// UI for the Steal-the-VFY Match Reconstructor.
// Fetches the bundled examples and the rule catalog, posts a pasted match
// to /api/check, and renders the per-turn verdicts + reconstructed state.
(function () {
  "use strict";

  var input = document.getElementById("input");
  var status = document.getElementById("status");
  var result = document.getElementById("result");
  var buttons = document.getElementById("example-buttons");
  var rulesBox = document.getElementById("rules");

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function boardHtml(board) {
    var order = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"];
    var cells = order
      .map(function (name) {
        var cell = board[name] || { owner: null, fortified: false };
        var cls = cell.owner === "self" ? "self" : cell.owner === "opponent" ? "opponent" : "neutral";
        var who = cell.owner === null ? "neutral" : cell.owner;
        return (
          '<div class="cell ' + cls + '"><span class="name">' + name + "</span><span>" +
          who + "</span>" +
          (cell.fortified ? '<span class="fort">FORTIFIED</span>' : "") +
          "</div>"
        );
      })
      .join("");
    return '<div class="board">' + cells + "</div>";
  }

  function renderReport(report) {
    var verdictCls = report.verdict === "legal" ? "legal" : "illegal";
    var html = "";
    html += '<div class="verdict ' + verdictCls + '">Match verdict: ' + report.verdict.toUpperCase() + "</div>";
    html += "<p>Turns checked: <b>" + report.turnsChecked + "</b> · legal: <b>" +
      report.legalTurns + "</b> · illegal: <b>" + report.illegalTurns + "</b> · match " +
      (report.complete ? "complete (20 turns)" : "incomplete (" + report.finalState.turn + " of 20 turns)") +
      (report.winner ? " · winner: <b>" + escapeHtml(report.winner) + "</b>" : "") + "</p>";

    html += "<h3>Final state</h3>";
    html += "<p>Balances — self: <b>" + report.finalState.balances.self + " VFY</b> · opponent: <b>" +
      report.finalState.balances.opponent + " VFY</b></p>";
    html += boardHtml(report.finalState.board);

    html += "<h3>Per-turn verdicts</h3>";
    html += "<table><thead><tr><th>Turn</th><th>Actor</th><th>Action</th><th>Verdict</th><th>Failed rules</th><th>Balances after</th></tr></thead><tbody>";
    report.turns.forEach(function (t) {
      var action = t.action === null ? "—" : escapeHtml(t.action);
      var errors = t.errors.length === 0
        ? "—"
        : t.errors.map(function (e) {
            return '<span class="err"><b>' + escapeHtml(e.rule) + "</b>: " + escapeHtml(e.message) + "</span>";
          }).join("<br>");
      html += "<tr><td>" + (t.turn === null ? "—" : t.turn) + "</td><td>" + escapeHtml(t.actor) +
        "</td><td>" + action + '</td><td class="' + t.verdict + '">' + t.verdict.toUpperCase() +
        "</td><td>" + errors + "</td><td>self " + t.stateAfter.balances.self +
        " · opp " + t.stateAfter.balances.opponent + "</td></tr>";
    });
    html += "</tbody></table>";
    result.innerHTML = html;
  }

  function runCheck() {
    status.textContent = "";
    var payload;
    try {
      payload = JSON.parse(input.value);
    } catch (err) {
      status.textContent = "Input is not valid JSON: " + err.message;
      return;
    }
    fetch("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (resp) { return resp.json().then(function (body) { return { status: resp.status, body: body }; }); })
      .then(function (out) {
        if (out.status !== 200) {
          status.textContent = "Error " + out.status + ": " + (out.body.error || "unknown");
          return;
        }
        renderReport(out.body);
      })
      .catch(function (err) {
        status.textContent = "Request failed: " + err.message;
      });
  }

  document.getElementById("run").addEventListener("click", runCheck);
  document.getElementById("clear").addEventListener("click", function () {
    input.value = "";
    result.innerHTML = "";
    status.textContent = "";
  });

  fetch("/api/examples")
    .then(function (resp) { return resp.json(); })
    .then(function (data) {
      data.examples.forEach(function (ex) {
        var btn = document.createElement("button");
        btn.className = "secondary";
        btn.textContent = ex.id + " (" + ex.expectedVerdict + ")";
        btn.title = ex.title;
        btn.addEventListener("click", function () {
          input.value = JSON.stringify(ex.input, null, 2);
          result.innerHTML = "";
          status.textContent = ex.title + " — expected verdict: " + ex.expectedVerdict;
        });
        buttons.appendChild(btn);
      });
    })
    .catch(function () {
      buttons.textContent = "Could not load examples.";
    });

  fetch("/api/rules")
    .then(function (resp) { return resp.json(); })
    .then(function (data) {
      rulesBox.innerHTML = data.rules
        .map(function (r) {
          return '<div class="rule"><span class="rule-kind ' + r.kind + '">' +
            r.kind.toUpperCase() + '</span><b>' + escapeHtml(r.id) + " — " + escapeHtml(r.title) +
            '</b><br><span class="spec">' + escapeHtml(r.spec) + "</span><br>" +
            escapeHtml(r.detail) + "</div>";
        })
        .join("");
    })
    .catch(function () {
      rulesBox.innerHTML = "<p>Could not load rules.</p>";
    });
})();
