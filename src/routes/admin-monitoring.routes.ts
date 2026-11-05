import { Router, type Response } from "express";

import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import {
  buildMonitoringSnapshot,
  monitoringFingerprint,
  type MonitoringSnapshot,
} from "../services/monitoring.service";

const router = Router();

router.use("/monitoring", requireAuth, requireRole("ADMIN"));

// GET /api/admin/monitoring — one-off snapshot (initial load / polling fallback)
router.get("/monitoring", async (_req, res) => {
  try {
    res.status(200).json({
      success: true,
      message: "Monitoring snapshot retrieved successfully",
      data: await buildMonitoringSnapshot(),
    });
  } catch (error) {
    console.error("Failed to build monitoring snapshot:", error);
    res.status(500).json({
      success: false,
      message: "Gagal memuat data monitoring. Coba lagi beberapa saat lagi.",
    });
  }
});

// ==========================================
// Realtime stream (Server-Sent Events)
// ==========================================
// One shared watcher checks a cheap fingerprint every few seconds and only
// rebuilds + broadcasts the snapshot when learning data actually changed.

const CHECK_INTERVAL_MS = 3000;
const HEARTBEAT_MS = 20000;
// Connections are recycled so an expired login cannot keep streaming forever;
// EventSource reconnects automatically (and re-authenticates).
const MAX_CONNECTION_MS = 15 * 60 * 1000;

const clients = new Set<Response>();
let lastFingerprint: string | null = null;
let lastSnapshot: MonitoringSnapshot | null = null;
let watcher: NodeJS.Timeout | null = null;
let checking = false;

function send(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function refresh() {
  if (checking) return;
  checking = true;

  try {
    const fingerprint = await monitoringFingerprint();

    if (fingerprint !== lastFingerprint || !lastSnapshot) {
      lastSnapshot = await buildMonitoringSnapshot();
      lastFingerprint = fingerprint;

      for (const client of clients) send(client, "snapshot", lastSnapshot);
    }
  } catch (error) {
    console.error("Monitoring stream refresh failed:", error);
    for (const client of clients) {
      send(client, "monitoring-error", {
        message: "Gagal memperbarui data monitoring. Mencoba lagi...",
      });
    }
  } finally {
    checking = false;
  }
}

function startWatcher() {
  if (watcher) return;
  watcher = setInterval(() => void refresh(), CHECK_INTERVAL_MS);
}

function stopWatcherIfIdle() {
  if (clients.size > 0 || !watcher) return;
  clearInterval(watcher);
  watcher = null;
  lastFingerprint = null;
  lastSnapshot = null;
}

// GET /api/admin/monitoring/stream
router.get("/monitoring/stream", async (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Reconnect delay hint for EventSource.
  res.write("retry: 5000\n\n");

  clients.add(res);
  startWatcher();

  // Send the current state immediately.
  try {
    send(res, "snapshot", lastSnapshot ?? (await buildMonitoringSnapshot()));
  } catch (error) {
    console.error("Failed to send initial monitoring snapshot:", error);
    send(res, "monitoring-error", {
      message: "Gagal memuat data monitoring. Mencoba lagi...",
    });
  }

  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  const recycle = setTimeout(() => res.end(), MAX_CONNECTION_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(recycle);
    clients.delete(res);
    stopWatcherIfIdle();
  });
});

export default router;
