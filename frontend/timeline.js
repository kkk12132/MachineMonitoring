// timeline.js
// Timeline visualization for CNC machines

const API_URL = "http://{"IPaddress"}:3000";
const VERIFICATION_KEY = "cnc_timeline_verifications";

let currentSegment = null;
let verifications = JSON.parse(localStorage.getItem(VERIFICATION_KEY) || "{}");

// ====== INITIALIZE ======
document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  document.getElementById("dateInput").valueAsDate = today;
  
  // Load timeline on page load
  loadTimeline();
});

// ====== LOAD TIMELINE ======
async function loadTimeline() {
  const dateInput = document.getElementById("dateInput").value;
  const shiftSelect = document.getElementById("shiftSelect").value;
  
  if (!dateInput) {
    alert("Please select a date");
    return;
  }

  const selectedDate = new Date(dateInput);
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const date = selectedDate.getDate();

  let startTime, endTime;

  if (shiftSelect === "shift1") {
    // Shift 1: 8:30 AM - 8:30 PM
    startTime = new Date(year, month, date, 8, 30, 0).getTime();
    endTime = new Date(year, month, date, 20, 30, 0).getTime();
  } else if (shiftSelect === "shift2") {
    // Shift 2: 8:30 PM - 8:30 AM next day
    startTime = new Date(year, month, date, 20, 30, 0).getTime();
    endTime = new Date(year, month, date + 1, 8, 30, 0).getTime();
  } else {
    // Full day: 00:00 - 23:59
    startTime = new Date(year, month, date, 0, 0, 0).getTime();
    endTime = new Date(year, month, date, 23, 59, 59).getTime();
  }

  try {
    const response = await fetch(`${API_URL}/devices`);
    if (!response.ok) throw new Error("Failed to fetch devices");
    
    const devices = await response.json();
    
    renderTimeline(devices, startTime, endTime);
    renderStats(devices, startTime, endTime);
  } catch (error) {
    console.error("Error loading timeline:", error);
    document.getElementById("machineTimelines").innerHTML = 
      '<div class="no-data">❌ Failed to load data. Check server connection.</div>';
  }
}

// ====== RENDER TIMELINE ======
function renderTimeline(devices, startTime, endTime) {
  const duration = endTime - startTime;
  const timelineHeader = document.getElementById("timelineHeader");
  const machineTimelines = document.getElementById("machineTimelines");

  // Create time labels
  timelineHeader.innerHTML = "";
  const numLabels = 13; // 0, 2, 4, 6, 8, 10, 12 hours
  for (let i = 0; i < numLabels; i++) {
    const label = document.createElement("div");
    label.className = "time-label";
    const hours = Math.floor((i / (numLabels - 1)) * (duration / 3600000));
    label.textContent = `${hours}h`;
    timelineHeader.appendChild(label);
  }

  // Clear machine timelines
  machineTimelines.innerHTML = "";

  if (Object.keys(devices).length === 0) {
    machineTimelines.innerHTML = '<div class="no-data">No machines found</div>';
    return;
  }

  // Render each machine
  for (const [machineName, device] of Object.entries(devices)) {
    const row = document.createElement("div");
    row.className = "machine-row";

    const nameDiv = document.createElement("div");
    nameDiv.className = "machine-name";
    nameDiv.textContent = machineName;

    const track = document.createElement("div");
    track.className = "timeline-track";

    // Render MANUFACTURING segments (GREEN)
    if (device.manufacturingRuns && device.manufacturingRuns.length > 0) {
      device.manufacturingRuns.forEach((run) => {
        if (run.end < startTime || run.start > endTime) return;

        const segmentStart = Math.max(run.start, startTime);
        const segmentEnd = Math.min(run.end, endTime);
        const segmentDuration = segmentEnd - segmentStart;

        const leftPercent = ((segmentStart - startTime) / duration) * 100;
        const widthPercent = (segmentDuration / duration) * 100;

        const segment = document.createElement("div");
        segment.className = "timeline-segment segment-manufacturing";
        segment.style.left = `${leftPercent}%`;
        segment.style.width = `${widthPercent}%`;
        segment.title = `Manufacturing: ${formatDuration(segmentDuration / 1000)}`;

        track.appendChild(segment);
      });
    }

    // Render IDLE segments (YELLOW or BLUE based on verification)
    if (device.idleRuns && device.idleRuns.length > 0) {
      device.idleRuns.forEach((run) => {
        if (run.end < startTime || run.start > endTime) return;

        const segmentStart = Math.max(run.start, startTime);
        const segmentEnd = Math.min(run.end, endTime);
        const segmentDuration = segmentEnd - segmentStart;

        const leftPercent = ((segmentStart - startTime) / duration) * 100;
        const widthPercent = (segmentDuration / duration) * 100;

        const segmentKey = `${machineName}-${run.start}-${run.end}`;
        const verification = verifications[segmentKey] || {};
        const isVerified = verification.verified || false;

        const segment = document.createElement("div");
        segment.className = `timeline-segment ${isVerified ? 'segment-verified' : 'segment-idle'}`;
        segment.style.left = `${leftPercent}%`;
        segment.style.width = `${widthPercent}%`;
        segment.title = `Idle: ${formatDuration(segmentDuration / 1000)}`;

        // Add click handler for idle segments
        segment.addEventListener("click", (e) => {
          openPopup(e, machineName, run, segmentKey);
        });

        track.appendChild(segment);
      });
    }

    row.appendChild(nameDiv);
    row.appendChild(track);
    machineTimelines.appendChild(row);
  }
}

// ====== RENDER STATS ======
function renderStats(devices, startTime, endTime) {
  const statsContainer = document.getElementById("statsContainer");
  statsContainer.innerHTML = "";

  let totalManufacturing = 0;
  let totalIdle = 0;
  let totalMachines = Object.keys(devices).length;

  for (const device of Object.values(devices)) {
    // Count manufacturing time
    if (device.manufacturingRuns) {
      device.manufacturingRuns.forEach((run) => {
        const overlap = getOverlap(run.start, run.end, startTime, endTime);
        totalManufacturing += overlap;
      });
    }

    // Count idle time
    if (device.idleRuns) {
      device.idleRuns.forEach((run) => {
        const overlap = getOverlap(run.start, run.end, startTime, endTime);
        totalIdle += overlap;
      });
    }
  }

  const totalActiveTime = totalManufacturing + totalIdle;
  const shiftDuration = endTime - startTime;
  const efficiency = shiftDuration > 0 ? (totalActiveTime / shiftDuration) * 100 : 0;

  statsContainer.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Manufacturing Time</div>
      <div class="stat-value">${formatDuration(totalManufacturing / 1000)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Idle Time</div>
      <div class="stat-value">${formatDuration(totalIdle / 1000)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Active Time</div>
      <div class="stat-value">${formatDuration(totalActiveTime / 1000)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Average Efficiency</div>
      <div class="stat-value">${efficiency.toFixed(1)}%</div>
    </div>
  `;
}

// ====== POPUP FUNCTIONS ======
function openPopup(event, machineName, run, segmentKey) {
  event.stopPropagation();
  
  const popup = document.getElementById("popup");
  const verification = verifications[segmentKey] || {};
  
  document.getElementById("popupHeader").textContent = `${machineName} - Idle Time`;
  document.getElementById("popupInfo").innerHTML = `
    <strong>Start:</strong> ${new Date(run.start).toLocaleString()}<br>
    <strong>End:</strong> ${new Date(run.end).toLocaleString()}<br>
    <strong>Duration:</strong> ${formatDuration(run.duration)}
  `;
  
  document.getElementById("reasonInput").value = verification.reason || "";
  document.getElementById("verifyCheckbox").checked = verification.verified || false;
  
  currentSegment = { machineName, run, segmentKey };
  
  // Position popup near click
  popup.style.left = `${event.pageX + 10}px`;
  popup.style.top = `${event.pageY + 10}px`;
  popup.classList.add("active");
}

function closePopup() {
  document.getElementById("popup").classList.remove("active");
  currentSegment = null;
}

function saveSegment() {
  if (!currentSegment) return;
  
  const reason = document.getElementById("reasonInput").value;
  const verified = document.getElementById("verifyCheckbox").checked;
  
  verifications[currentSegment.segmentKey] = {
    reason,
    verified,
    timestamp: Date.now()
  };
  
  localStorage.setItem(VERIFICATION_KEY, JSON.stringify(verifications));
  closePopup();
  loadTimeline(); // Reload to update colors
}

// ====== RESET MODAL ======
function showResetModal() {
  document.getElementById("resetModal").classList.add("active");
}

function hideResetModal() {
  document.getElementById("resetModal").classList.remove("active");
}

async function confirmReset() {
  try {
    // Clear server data
    const response = await fetch(`${API_URL}/reset`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Failed to reset server data');
    }
    
    // Clear local verification data
    localStorage.removeItem(VERIFICATION_KEY);
    verifications = {};
    
    hideResetModal();
    loadTimeline();
    
    alert("✅ All data has been reset! (Server data + Verification data)");
  } catch (error) {
    console.error("Error resetting data:", error);
    alert("❌ Failed to reset server data. Check server connection.");
  }
}

// ====== HELPER FUNCTIONS ======
function getOverlap(start, end, rangeStart, rangeEnd) {
  const overlapStart = Math.max(start, rangeStart);
  const overlapEnd = Math.min(end, rangeEnd);
  return Math.max(0, overlapEnd - overlapStart);
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Close popup when clicking outside
document.addEventListener("click", (e) => {
  const popup = document.getElementById("popup");
  if (popup.classList.contains("active") && !popup.contains(e.target)) {
    closePopup();
  }
});
