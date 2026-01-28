const serverUrl = "http://{"IPaddres"}:3000/devices";

// ====== FETCH MANUFACTURING STATUS ======
async function fetchManufacturing() {
  try {
    const res = await fetch(serverUrl);
    if (!res.ok) throw new Error("Server not reachable");
    const data = await res.json();
    renderManufacturing(data);
    document.getElementById("error").innerText = "";
  } catch (err) {
    console.error(err);
    document.getElementById("error").innerText = "❌ Cannot reach server";
  }
}

// ====== RENDER MANUFACTURING STATUS ======
function renderManufacturing(devices) {
  const tbody = document.getElementById("manufacturingTable");
  if (!tbody) return;
  tbody.innerHTML = "";

  let index = 1;
  for (const [name, dev] of Object.entries(devices)) {
    const partsCount = dev.parts ? dev.parts.length : 0;
    let status = "Idle";

    if (dev.pin3 === 1 && dev.pin4 === 0) status = "🟡 Manufacturing";
    else if (dev.pin3 === 0 && dev.pin4 === 1) status = "🟢 Completed";
    else if (dev.pin3 === 0 && dev.pin4 === 0) status = "⚪ Idle";

    const lastPart = dev.parts?.[0];
    const startStr = lastPart ? new Date(lastPart.start).toLocaleTimeString() : "-";
    const endStr = lastPart ? new Date(lastPart.end).toLocaleTimeString() : "-";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index++}</td>
      <td>${name}</td>
      <td>${status}</td>
      <td>${partsCount}</td>
      <td>${startStr}</td>
      <td>${endStr}</td>
    `;
    tbody.appendChild(row);
  }
}

// ====== AUTO REFRESH ======
setInterval(fetchManufacturing, 3000);
fetchManufacturing();
