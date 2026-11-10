import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { error } from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { ingestTelemetry, parseTelemetry } from "./telemetry";

initializeApp();

export const api = onRequest({ region: "asia-southeast1" }, async (req, res) => {
  try {
    const firestore = getFirestore();
    if (req.method === "GET" && req.path === "/health") {
      await firestore.doc("_system/health").get();
      res.status(200).json({ ok: true });
      return;
    }

    if (req.path !== "/telemetry") {
      res.status(404).json({ error: "NOT_FOUND", message: "Unknown API route." });
      return;
    }
    if (req.method !== "POST") {
      res.set("Allow", "POST").status(405).json({
        error: "METHOD_NOT_ALLOWED",
        message: "Use POST for telemetry ingestion.",
      });
      return;
    }

    const token = /^Bearer\s+(\S+)$/i.exec(req.get("Authorization") ?? "")?.[1];
    if (!token) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "A Bearer token is required." });
      return;
    }

    const samples = parseTelemetry(req.body);
    if (!samples) {
      res.status(400).json({ error: "INVALID_PAYLOAD", message: "Expected a valid telemetry batch." });
      return;
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const ingestedCount = await ingestTelemetry(firestore, tokenHash, samples);
    if (ingestedCount === null) {
      res.status(403).json({ error: "INVALID_TOKEN", message: "The gateway token is invalid." });
      return;
    }
    res.status(200).json({ success: true, ingested_count: ingestedCount });
  } catch {
    error("FoodWarden API request failed", { method: req.method });
    res.status(500).json({ error: "INTERNAL_ERROR", message: "The request could not be completed." });
  }
});
