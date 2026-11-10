import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { error } from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { addManualFood, inventoryPhotoPath, isFridgeMember, parseManualFood, readInventoryPhoto, verifiedEmail } from "./inventory";
import { ingestStatus, parseStatus } from "./status";
import { ingestTelemetry, parseTelemetry } from "./telemetry";

initializeApp();

export const api = onRequest({ region: "asia-southeast1" }, async (req, res) => {
  try {
    const firestore = getFirestore();
    const path = req.path.replace(/^\/api(?=\/)/, "");
    if (req.method === "GET" && path === "/health") {
      await firestore.doc("_system/health").get();
      res.status(200).json({ ok: true });
      return;
    }

    if (path === "/fridges" && req.method === "GET") {
      res.set("Cache-Control", "private, no-store");
      const token = /^Bearer\s+(\S+)$/i.exec(req.get("Authorization") ?? "")?.[1];
      const email = token ? await verifiedEmail(token) : null;
      if (!email) {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      const memberships = await firestore.collection("fridges")
        .where(new FieldPath("members", email), "in", ["owner", "member"]).get();
      res.json({ fridges: memberships.docs.map((fridge) => ({
        id: fridge.id,
        name: fridge.get("name") as unknown,
        last_telemetry: fridge.get("last_telemetry") as unknown,
      })) });
      return;
    }

    const inventoryRoute = /^\/fridges\/([a-z0-9_-]{1,128})\/inventory(?:\/([a-z0-9_-]{1,128})\/photo)?$/i.exec(path);
    if (inventoryRoute?.[1]) {
      const fridge = firestore.collection("fridges").doc(inventoryRoute[1]);
      const itemId = inventoryRoute[2];
      const method = itemId ? "GET" : "POST";
      res.set("Cache-Control", "private, no-store");
      if (req.method !== method) {
        res.set("Allow", method).status(405).json({ error: "METHOD_NOT_ALLOWED" });
        return;
      }

      const token = /^Bearer\s+(\S+)$/i.exec(req.get("Authorization") ?? "")?.[1];
      const email = token ? await verifiedEmail(token) : null;
      if (!email) {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      if (!isFridgeMember((await fridge.get()).get("members"), email)) {
        res.status(403).json({ error: "FORBIDDEN" });
        return;
      }

      if (itemId) {
        const item = await fridge.collection("inventory").doc(itemId).get();
        const photoPath = inventoryPhotoPath(item.get("image_storage_path"), fridge.id);
        const photo = photoPath ? await readInventoryPhoto(photoPath) : null;
        if (!photo) {
          res.status(404).json({ error: "PHOTO_NOT_FOUND" });
          return;
        }
        res.set("X-Content-Type-Options", "nosniff").type("jpeg").send(photo);
        return;
      }

      const food = parseManualFood(req.body);
      if (!food) {
        res.status(400).json({ error: "INVALID_PAYLOAD" });
        return;
      }
      const result = await addManualFood(firestore, fridge, email, food);
      if (result === "forbidden" || result === "conflict") {
        res.status(result === "forbidden" ? 403 : 409).json({ error: result.toUpperCase() });
        return;
      }
      res.status(result === "created" ? 201 : 200).json({ item_id: food.itemId });
      return;
    }

    if (path !== "/telemetry" && path !== "/status") {
      res.status(404).json({ error: "NOT_FOUND", message: "Unknown API route." });
      return;
    }
    if (req.method !== "POST") {
      res.set("Allow", "POST").status(405).json({
        error: "METHOD_NOT_ALLOWED",
        message: "Use POST for gateway reports.",
      });
      return;
    }

    const token = /^Bearer\s+(\S+)$/i.exec(req.get("Authorization") ?? "")?.[1];
    if (!token) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "A Bearer token is required." });
      return;
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    if (path === "/status") {
      const receivedS = Math.floor(Date.now() / 1000);
      const report = parseStatus(req.body, receivedS);
      if (!report) {
        res.status(400).json({ error: "INVALID_PAYLOAD", message: "Expected a valid node status report." });
        return;
      }
      const updatedCount = await ingestStatus(firestore, tokenHash, report, receivedS);
      if (updatedCount === null) {
        res.status(403).json({ error: "INVALID_TOKEN", message: "The gateway token is invalid." });
        return;
      }
      res.status(200).json({ success: true, updated_count: updatedCount });
      return;
    }

    const samples = parseTelemetry(req.body);
    if (!samples) {
      res.status(400).json({ error: "INVALID_PAYLOAD", message: "Expected a valid telemetry batch." });
      return;
    }

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
