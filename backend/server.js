// server.js
// CNC Monitoring Server - Correct Pin Logic
// GREEN: Pin 3 = 1 (manufacturing active)
// YELLOW/BLUE: Pin 3 = 0 (idle/waiting - not manufacturing)
// GREY: Machine OFF (no data from Arduino)

const express = require("express");
const cors = require("cors");

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// ==========================
// In-memory device store
// ==========================
let devices = {};

const DEBOUNCE_MS = 500;
const SHIFT_SECONDS = 12 * 3600;
const MIN_VALID_DURATION = 1;

// --------------------------
// Helpers
// --------------------------
function getShiftWindowMs(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const date = now.getDate();

  const s1Start = new Date(year, month, date, 8, 30, 0, 0);
  const s1End   = new Date(year, month, date, 20, 30, 0, 0);

  if (now >= s1Start && now < s1End) {
    return { shiftName: "Shift1", startMs: s1Start.getTime(), endMs: s1End.getTime() };
  }

  if (now < s1Start) {
    const prevStart = new Date(year, month, date - 1, 20, 30, 0, 0);
    return { shiftName: "Shift2", startMs: prevStart.getTime(), endMs: s1Start.getTime() };
  }

  const start = s1End;
  const end = new Date(year, month, date + 1, 8, 30, 0, 0);
  return { shiftName: "Shift2", startMs: start.getTime(), endMs: end.getTime() };
}

function overlapSeconds(aStartMs, aEndMs, bStartMs, bEndMs) {
  const s = Math.max(aStartMs, bStartMs);
  const e = Math.min(aEndMs, bEndMs);
  return e <= s ? 0 : Math.floor((e - s) / 1000);
}

// --------------------------
// POST /update
// --------------------------
app.post("/update", (req, res) => {
  const { name, pin2, pin3, pin4, onTime } = req.body;
  if (!name) return res.status(400).send("Missing device name");

  const now = Date.now();

  if (!devices[name]) {
    devices[name] = {
      // Pin 2 tracking (Spindle status)
      spindle: 0,
      spindleStart: null,
      spindleTime: 0,
      
      // Manufacturing tracking (Pin 3 = 1 → GREEN)
      manufacturingActive: false,
      manufacturingStart: null,
      manufacturingRuns: [],
      
      // Idle tracking (Pin 3 = 0 = not manufacturing → YELLOW/BLUE)
      idleActive: false,
      idleStart: null,
      idleRuns: [],
      
      onTime: 0,
      lastPins: { pin2: 0, pin3: 0, pin4: 0 },
      lastChange: { pin2: 0, pin3: 0, pin4: 0 },
      lastValidChange: { pin2: 0, pin3: 0, pin4: 0 },
      lastUpdate: now
    };
    console.log(`[${name}] 🆕 Device registered`);
    
    // If Pin 3 is LOW on first connection, start idle period
    if (pin3 === 0) {
      devices[name].idleActive = true;
      devices[name].idleStart = now;
      console.log(`[${name}] 🟡 Idle START (device connected, Pin 3 = 0)`);
    }
  }

  const dev = devices[name];
  const prev = dev.lastPins;

  // ========== PIN 2 (SPINDLE) LOGIC ==========
  
  // Spindle ON when Pin 2 goes HIGH (0→1)
  if (pin2 === 1 && prev.pin2 === 0) {
    if (now - dev.lastValidChange.pin2 >= DEBOUNCE_MS) {
      dev.spindle = 1;
      dev.spindleStart = now;
      dev.lastValidChange.pin2 = now;
      console.log(`[${name}] 🔴 Spindle ON (Pin 2 = 1)`);
    }
  }

  // Spindle OFF when Pin 2 goes LOW (1→0)
  if (pin2 === 0 && prev.pin2 === 1 && dev.spindleStart) {
    const duration = Math.floor((now - dev.spindleStart) / 1000);
    if (duration >= MIN_VALID_DURATION) {
      dev.spindle = 0;
      dev.spindleTime += duration;
      console.log(`[${name}] 🔴 Spindle OFF (Pin 2 = 0) - ${duration}s`);
    }
    dev.spindleStart = null;
  }

  // ========== MANUFACTURING LOGIC (Pin 3 = 1 → GREEN) ==========
  
  // Manufacturing STARTS when Pin 3 goes HIGH (0→1)
  if (pin3 === 1 && prev.pin3 === 0) {
    if (now - dev.lastChange.pin3 >= DEBOUNCE_MS) {
      // End any active idle period first
      if (dev.idleActive && dev.idleStart) {
        const idleDuration = Math.floor((now - dev.idleStart) / 1000);
        if (idleDuration >= MIN_VALID_DURATION) {
          dev.idleRuns.push({ start: dev.idleStart, end: now, duration: idleDuration });
          console.log(`[${name}] 🟡 Idle END (manufacturing starting) - ${idleDuration}s`);
        }
        dev.idleActive = false;
        dev.idleStart = null;
      }
      
      dev.manufacturingActive = true;
      dev.manufacturingStart = now;
      dev.lastChange.pin3 = now;
      console.log(`[${name}] 🟢 Manufacturing START (Pin 3 = 1)`);
    }
  }

  // Manufacturing ENDS when Pin 3 goes LOW (1→0)
  if (pin3 === 0 && prev.pin3 === 1 && dev.manufacturingActive) {
    const duration = Math.floor((now - dev.manufacturingStart) / 1000);
    if (duration >= MIN_VALID_DURATION) {
      dev.manufacturingRuns.push({ start: dev.manufacturingStart, end: now, duration });
      console.log(`[${name}] 🟢 Manufacturing END (Pin 3 = 0) - ${duration}s`);
    }
    dev.manufacturingActive = false;
    dev.manufacturingStart = null;
    dev.lastChange.pin3 = now;
    
    // Start idle period immediately when manufacturing ends
    dev.idleActive = true;
    dev.idleStart = now;
    console.log(`[${name}] 🟡 Idle START (manufacturing ended)`);
  }

  // ========== IDLE LOGIC (Pin 3 = 0 = not manufacturing → YELLOW/BLUE) ==========
  
  // Idle ENDS when Pin 3 goes HIGH (manufacturing starts)
  if (pin3 === 1 && prev.pin3 === 0 && dev.idleActive && dev.idleStart) {
    const duration = Math.floor((now - dev.idleStart) / 1000);
    if (duration >= MIN_VALID_DURATION) {
      dev.idleRuns.push({ start: dev.idleStart, end: now, duration });
      console.log(`[${name}] 🟡 Idle END (manufacturing starting) - ${duration}s`);
    }
    dev.idleActive = false;
    dev.idleStart = null;
  }

  // Update onTime
  if (typeof onTime === "number") {
    dev.onTime = Math.floor(onTime / 1000);
  }

  dev.lastPins = { pin2, pin3, pin4 };
  dev.lastUpdate = now;

  res.json({ success: true });
});

// --------------------------
// GET /devices (dashboard)
// --------------------------
app.get("/devices", (req, res) => {
  const now = Date.now();
  const shift = getShiftWindowMs(new Date(now));
  const result = {};

  for (const [name, dev] of Object.entries(devices)) {
    let totalShiftOnSec = 0;

    // Count manufacturing time (GREEN)
    for (const run of dev.manufacturingRuns) {
      totalShiftOnSec += overlapSeconds(
        run.start,
        run.end,
        shift.startMs,
        shift.endMs
      );
    }

    if (dev.manufacturingActive && dev.manufacturingStart) {
      totalShiftOnSec += overlapSeconds(
        dev.manufacturingStart,
        now,
        shift.startMs,
        shift.endMs
      );
    }

    // Count idle time (YELLOW/BLUE)
    for (const run of dev.idleRuns) {
      totalShiftOnSec += overlapSeconds(
        run.start,
        run.end,
        shift.startMs,
        shift.endMs
      );
    }

    if (dev.idleActive && dev.idleStart) {
      totalShiftOnSec += overlapSeconds(
        dev.idleStart,
        now,
        shift.startMs,
        shift.endMs
      );
    }

    totalShiftOnSec = Math.min(totalShiftOnSec, SHIFT_SECONDS);

    result[name] = {
      spindle: dev.spindle,
      spindleTime: dev.spindleTime,
      manufacturingActive: dev.manufacturingActive,
      manufacturingRuns: dev.manufacturingRuns, // GREEN bars
      idleActive: dev.idleActive,
      idleRuns: dev.idleRuns, // YELLOW/BLUE bars
      
      // Legacy compatibility - combine both for "recent" runs
      recent: [...dev.manufacturingRuns, ...dev.idleRuns].sort((a, b) => b.start - a.start),
      
      // Parts = manufacturing runs only
      parts: dev.manufacturingRuns,
      
      onTime: dev.onTime,
      totalShiftOnSeconds: totalShiftOnSec,
      efficiencyPercent: +((totalShiftOnSec / SHIFT_SECONDS) * 100).toFixed(2),
      shiftName: shift.shiftName,
      lastUpdate: dev.lastUpdate,
      currentState: {
        pin2: dev.lastPins.pin2,
        pin3: dev.lastPins.pin3,
        pin4: dev.lastPins.pin4
      }
    };
  }

  res.json(result);
});

// --------------------------
// GET /devices/report
// --------------------------
app.get("/devices/report", (req, res) => {
  const from = Number(req.query.from);
  const to = Number(req.query.to);

  if (!from || !to || from >= to) {
    return res.status(400).json({ error: "Invalid date range" });
  }

  const report = {};

  for (const [name, dev] of Object.entries(devices)) {
    let manufacturingSeconds = 0;
    let idleSeconds = 0;

    // Count manufacturing runs (GREEN)
    for (const run of dev.manufacturingRuns) {
      manufacturingSeconds += overlapSeconds(
        run.start,
        run.end,
        from,
        to
      );
    }

    if (dev.manufacturingActive && dev.manufacturingStart) {
      manufacturingSeconds += overlapSeconds(
        dev.manufacturingStart,
        Date.now(),
        from,
        to
      );
    }

    // Count idle runs (YELLOW/BLUE)
    for (const run of dev.idleRuns) {
      idleSeconds += overlapSeconds(
        run.start,
        run.end,
        from,
        to
      );
    }

    if (dev.idleActive && dev.idleStart) {
      idleSeconds += overlapSeconds(
        dev.idleStart,
        Date.now(),
        from,
        to
      );
    }

    const totalOnSeconds = manufacturingSeconds + idleSeconds;
    const rangeSeconds = Math.floor((to - from) / 1000);
    const efficiency =
      rangeSeconds > 0 ? (totalOnSeconds / rangeSeconds) * 100 : 0;

    report[name] = {
      manufacturingSeconds,
      idleSeconds,
      totalOnSeconds,
      efficiencyPercent: Number(efficiency.toFixed(2))
    };
  }

  res.json({ devices: report });
});

// --------------------------
// Health check
// --------------------------
app.get("/status", (req, res) => {
  res.json({
    status: "online",
    devices: Object.keys(devices),
    uptime: process.uptime()
  });
});

// --------------------------
// DELETE /reset - Reset all data
// --------------------------
app.delete("/reset", (req, res) => {
  console.log("🗑️  RESETTING ALL DATA");
  devices = {}; // Clear all device data
  res.json({ 
    success: true, 
    message: "All data has been reset",
    timestamp: Date.now()
  });
});

// --------------------------
// START SERVER
// --------------------------
app.listen(port, "0.0.0.0", () => {
  console.log("✅ CNC Server running");
  console.log(`🌐 http://{"IPaddress"}:${port}`);
  console.log(`🌐 Local: http://localhost:${port}`);
});
