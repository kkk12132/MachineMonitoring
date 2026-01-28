// report_script.js
const serverUrl = "http://{"IPaddress"}:3000/devices";

const fromDate = document.getElementById("fromDate");
const fromTime = document.getElementById("fromTime");
const toDate = document.getElementById("toDate");
const toTime = document.getElementById("toTime");
const generateBtn = document.getElementById("generateBtn");
const reportBody = document.getElementById("reportBody");
const rangeInfo = document.getElementById("rangeInfo");
const errorDiv = document.getElementById("error");
const exportCsvBtn = document.getElementById("exportCsv");
const backBtn = document.getElementById("backBtn");

backBtn.addEventListener("click", () => window.history.back());

// Default last 24 hours
(function setDefaults() {
  const now = new Date();
  const prev = new Date(now.getTime() - 24 * 3600 * 1000);
  fromDate.value = prev.toISOString().slice(0, 10);
  fromTime.value = prev.toTimeString().slice(0, 8);
  toDate.value = now.toISOString().slice(0, 10);
  toTime.value = now.toTimeString().slice(0, 8);
})();

function showError(msg) {
  errorDiv.style.display = "block";
  errorDiv.innerText = msg;
}
function clearError() {
  errorDiv.style.display = "none";
  errorDiv.innerText = "";
}

function buildTimestamp(dateVal, timeVal) {
  if (!dateVal || !timeVal) return NaN;
  return Date.parse(dateVal + "T" + timeVal);
}

function formatSecondsToHMS(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function enableExportCsv(enabled) {
  exportCsvBtn.disabled = !enabled;
}

// CSV Export
exportCsvBtn.addEventListener("click", () => {
  const rows = [];
  const headers = ["Name", "TotalOnSeconds", "TotalRange", "EfficiencyPercent"];
  rows.push(headers.join(","));

  const trs = reportBody.querySelectorAll("tr");
  trs.forEach(tr => {
    const tds = tr.querySelectorAll("td");
    if (tds.length === 4) {
      rows.push([
        tds[0].innerText.trim(),
        tds[1].innerText.trim(),
        tds[2].innerText.trim(),
        tds[3].innerText.trim()
      ].join(","));
    }
  });

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cnc_report_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// Generate Report
generateBtn.addEventListener("click", async () => {
  clearError();
  reportBody.innerHTML = `<tr><td colspan="4" class="small">Generating report…</td></tr>`;
  enableExportCsv(false);
  generateBtn.disabled = true; // prevent multiple clicks

  const fromMs = buildTimestamp(fromDate.value, fromTime.value);
  const toMs = buildTimestamp(toDate.value, toTime.value);

  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    showError("Please enter valid From/To date & time.");
    reportBody.innerHTML = `<tr><td colspan="4" class="small">Invalid input.</td></tr>`;
    generateBtn.disabled = false;
    return;
  }
  if (fromMs >= toMs) {
    showError("'From' must be earlier than 'To'.");
    reportBody.innerHTML = `<tr><td colspan="4" class="small">Invalid range.</td></tr>`;
    generateBtn.disabled = false;
    return;
  }

  const totalRangeSec = Math.floor((toMs - fromMs) / 1000);
  const rangeText = `${formatSecondsToHMS(totalRangeSec)} ( ${totalRangeSec} seconds )`;
  rangeInfo.innerText = rangeText;

  try {
    const res = await fetch(`${serverUrl}/report?from=${fromMs}&to=${toMs}`);
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();

    const devices = json.devices || {};
    const names = Object.keys(devices).sort();

    if (names.length === 0) {
      reportBody.innerHTML = `<tr><td colspan="4" class="small">No machines found.</td></tr>`;
      return;
    }

    // Use DocumentFragment for smoother DOM updates
    const fragment = document.createDocumentFragment();
    names.forEach(name => {
      const d = devices[name];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${name}</td>
        <td class="right">${d.totalOnSeconds}</td>
        <td class="right">${rangeText}</td>
        <td class="right">${d.efficiencyPercent.toFixed(2)}%</td>
      `;
      fragment.appendChild(tr);
    });

    reportBody.innerHTML = ""; // clear previous
    reportBody.appendChild(fragment);

    enableExportCsv(true);
  } catch (err) {
    console.error(err);
    showError("Failed to fetch report: " + err.message);
    reportBody.innerHTML = `<tr><td colspan="4" class="small">Failed to fetch report.</td></tr>`;
  } finally {
    generateBtn.disabled = false;
  }
});
