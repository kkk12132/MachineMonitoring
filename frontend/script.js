// ====== CONFIG ======
const serverUrl = "http://192.168.31.140:3000/devices";

// ====== LOCAL STORAGE KEYS ======
const STORAGE_KEY = "cnc_runtimeData";

// ====== LOAD RUNTIME DATA ======
let runtimeData = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
let lastDeviceData = {};

// ====== PAGE ELEMENTS ======
const liveSection = document.getElementById("liveSection");
const recentSection = document.getElementById("recentSection");
const partsSection = document.getElementById("partsSection");

const btnLive = document.getElementById("btnLive");
const btnRecent = document.getElementById("btnRecent");
const btnParts = document.getElementById("btnParts");

// ====== NAVIGATION ======
if (btnLive) btnLive.addEventListener("click", () => {
  liveSection.style.display = "block";
  recentSection.style.display = "none";
  partsSection.style.display = "none";
});
if (btnRecent) btnRecent.addEventListener("click", () => {
  liveSection.style.display = "none";
  recentSection.style.display = "block";
  partsSection.style.display = "none";
});
if (btnParts) btnParts.addEventListener("click", () => {
  liveSection.style.display = "none";
  recentSection.style.display = "none";
  partsSection.style.display = "block";
});

// ====== FETCH STATUS ======
async function fetchStatus() {
  try {
    const res = await fetch(serverUrl);
    if (!res.ok) throw new Error("Server not reachable");
    const data = await res.json();

    // Update runtimeData per device
    for (const [name, device] of Object.entries(data)) {
      if (!runtimeData[name]) {
        runtimeData[name] = {
          running: !!device.spindle,
          seconds: 0,
          startTime: device.spindle ? Date.now() : null
        };
      } else {
        const r = runtimeData[name];
        // OFF -> ON
        if (!r.running && device.spindle) {
          r.running = true;
          r.startTime = Date.now();
        }
        // ON -> OFF
        else if (r.running && !device.spindle) {
          r.running = false;
          if (r.startTime) {
            r.seconds += Math.floor((Date.now() - r.startTime) / 1000);
            r.startTime = null;
          }
        }
      }
    }

    // Save runtimeData to localStorage to persist across page toggles
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runtimeData));

    lastDeviceData = data;

    // Render tables
    const deviceTable = document.getElementById("deviceTable");
    if (deviceTable) renderLive(deviceTable);

    const recentTable = document.getElementById("recentTable");
    if (recentTable) renderRecent(recentTable);

    const partsTable = document.getElementById("partsTable");
    if (partsTable) renderParts(partsTable);

    const errorDiv = document.getElementById("error");
    if (errorDiv) errorDiv.innerText = "";
  } catch (e) {
    console.error(e);
    const errorDiv = document.getElementById("error");
    if (errorDiv) errorDiv.innerText = "❌ Cannot reach server";
  }
}

// ====== SHIFT HELPERS ======
function getShiftWindow(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const date = now.getDate();

  const s1Start = new Date(year, month, date, 8, 30, 0, 0);
  const s1End = new Date(year, month, date, 20, 30, 0, 0);

  if (now >= s1Start && now < s1End) {
    return { shiftName: "Shift1", start: s1Start.getTime(), end: s1End.getTime() };
  } else {
    if (now < s1Start) {
      const prevStart = new Date(year, month, date - 1, 20, 30, 0, 0);
      return { shiftName: "Shift2", start: prevStart.getTime(), end: s1Start.getTime() };
    } else {
      const s2End = new Date(year, month, date + 1, 8, 30, 0, 0);
      return { shiftName: "Shift2", start: s1End.getTime(), end: s2End.getTime() };
    }
  }
}

function overlapSeconds(aStartMs, aEndMs, bStartMs, bEndMs) {
  const s = Math.max(aStartMs, bStartMs);
  const e = Math.min(aEndMs, bEndMs);
  if (e <= s) return 0;
  return Math.floor((e - s) / 1000);
}

function computeTotalDurationThisShift(device, runtimeSeconds) {
  const nowMs = Date.now();
  const shift = getShiftWindow(new Date(nowMs));
  const shiftStart = shift.start;
  const shiftEnd = shift.end;

  let total = 0;

  if (Array.isArray(device.recent)) {
    for (const slot of device.recent) {
      const s = Number(slot.start);
      const e = Number(slot.end);
      if (!s || !e) continue;
      total += overlapSeconds(s, e, shiftStart, Math.min(shiftEnd, nowMs));
    }
  }

  if (runtimeSeconds && runtimeSeconds > 0 && (device.spindle || (runtimeData[device.name] && runtimeData[device.name].running))) {
    const runningEnd = nowMs;
    const runningStart = nowMs - runtimeSeconds * 1000;
    total += overlapSeconds(runningStart, runningEnd, shiftStart, Math.min(shiftEnd, nowMs));
  }

  if (total === 0 && typeof device.onTime === "number" && device.onTime > 0) {
    const shiftElapsed = Math.max(0, Math.min(Date.now(), shiftEnd) - shiftStart);
    total = Math.min(Math.floor(device.onTime), Math.floor(shiftElapsed / 1000));
  }

  return total;
}

// ====== RENDER LIVE ======
function renderLive(tbody) {
  if (!tbody) return;

  const now = Date.now();
  for (const [name, r] of Object.entries(runtimeData)) {
    if (r.running && r.startTime) {
      r.displaySeconds = r.seconds + Math.floor((now - r.startTime) / 1000);
    } else {
      r.displaySeconds = r.seconds;
    }
  }

  tbody.innerHTML = "";
  for (const [name, device] of Object.entries(lastDeviceData)) {
    const r = runtimeData[name] || { displaySeconds: 0, running: false };
    const totalShiftOnSec = computeTotalDurationThisShift(Object.assign({}, device, { name }), r.displaySeconds);

    const shift = getShiftWindow();
    const shiftElapsedSec = Math.floor(Math.max(0, Math.min(Date.now(), shift.end) - shift.start) / 1000);
    const effPercent = shiftElapsedSec > 0 ? ((totalShiftOnSec / shiftElapsedSec) * 100) : 0;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${name}</td>
      <td class="${device.spindle ? "on" : "off"}">${device.spindle ? "🟢 ON" : "🔴 OFF"}</td>
      <td>${formatTime(r.displaySeconds)}</td>
      <td>${totalShiftOnSec}s</td>
      <td>${effPercent.toFixed(1)}%</td>
    `;
    tbody.appendChild(row);
  }
}

// ====== RENDER RECENT ======
function renderRecent(tbody) {
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const [name, device] of Object.entries(lastDeviceData)) {
    if (!device.recent || device.recent.length === 0) continue;
    const r = runtimeData[name] || { seconds: 0 };
    for (const slot of device.recent) {
      const sMs = Number(slot.start);
      const eMs = Number(slot.end);
      if (!sMs || !eMs) continue;
      const duration = Number(slot.duration) || Math.floor((eMs - sMs) / 1000);
      const totalShiftOnSec = computeTotalDurationThisShift(Object.assign({}, device, { name }), r.seconds);
      const shift = getShiftWindow();
      const shiftElapsedSec = Math.floor(Math.max(0, Math.min(Date.now(), shift.end) - shift.start) / 1000);
      const effPercent = shiftElapsedSec > 0 ? ((totalShiftOnSec / shiftElapsedSec) * 100) : 0;

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${name}</td>
        <td>${new Date(sMs).toLocaleTimeString()}</td>
        <td>${new Date(eMs).toLocaleTimeString()}</td>
        <td>${formatTime(duration)}</td>
        <td>${effPercent.toFixed(1)}%</td>
      `;
      tbody.appendChild(row);
    }
  }
}

// ====== RENDER PARTS ======
function renderParts(tbody) {
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const [name, device] of Object.entries(lastDeviceData)) {
    if (!device.parts || device.parts.length === 0) continue;
    device.parts.forEach((p, i) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${i + 1}</td>
        <td>${name}</td>
        <td>${new Date(p.start).toLocaleTimeString()}</td>
        <td>${new Date(p.end).toLocaleTimeString()}</td>
        <td>${formatTime(p.duration)}</td>
      `;
      tbody.appendChild(row);
    });
  }
}

// ====== FORMAT TIME ======
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ====== INTERVALS ======
setInterval(fetchStatus, 3000); // fetch every 3s
const deviceTable = document.getElementById("deviceTable");
if (deviceTable) setInterval(() => renderLive(deviceTable), 1000);

// Initial fetch
fetchStatus();
