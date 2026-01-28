const serverUrl = "http://192.168.31.140:3000/devices";

// ====== FETCH DEVICE DATA FROM SERVER ======
async function fetchDevices() {
  try {
    const res = await fetch(serverUrl);
    if (!res.ok) throw new Error("Server not reachable");
    const data = await res.json();

    // Debug: see server response in console
    console.log("Server response:", data);

    renderParts(data);
    renderSummary(data);

    document.getElementById("error").innerText = "";
    document.getElementById("lastUpdated").innerText =
      "Last updated: " + new Date().toLocaleTimeString();
  } catch (err) {
    console.error(err);
    document.getElementById("error").innerText = "❌ Cannot reach server";
    document.getElementById("lastUpdated").innerText = "Offline";
  }
}

// ====== RENDER PARTS TABLE ======
function renderParts(devices) {
  const tbody = document.getElementById("partsTable");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const [name, dev] of Object.entries(devices)) {
    // Ensure parts array exists
    if (!dev.parts || dev.parts.length === 0) continue;

    dev.parts.forEach((p, i) => {
      const startStr = new Date(p.start).toLocaleTimeString();
      const endStr = new Date(p.end).toLocaleTimeString();
      const duration = formatTime(p.duration);

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${i + 1}</td>
        <td>${name}</td>
        <td>${startStr}</td>
        <td>${endStr}</td>
        <td>${duration}</td>
      `;
      tbody.appendChild(row);
    });
  }
}

// ====== RENDER SUMMARY TABLE ======
function renderSummary(devices) {
  const tbody = document.getElementById("summaryTable");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const [name, dev] of Object.entries(devices)) {
    const totalParts = dev.parts ? dev.parts.length : 0;
    const totalTime = formatTime(dev.spindleTime || 0);

    const lastPart =
      dev.parts && dev.parts.length > 0
        ? dev.parts[dev.parts.length - 1].duration
        : 0;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${name}</td>
      <td>${totalParts}</td>
      <td>${totalTime}</td>
      <td>${formatTime(lastPart)}</td>
      <td>${dev.spindle ? "🟢 Running" : "🔴 Stopped"}</td>
    `;
    tbody.appendChild(row);
  }
}

// ====== TIME FORMAT HELPER ======
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ====== AUTO REFRESH EVERY 5s ======
setInterval(fetchDevices, 5000);
fetchDevices();
