import type {
  DoorEvent,
  Food,
  Fridge,
  FridgeRoomEvent,
  Sample,
} from "../../src/model";
import {
  deriveRecoveryActions,
  initialDashboardState,
  reduceDashboardEvent,
  type DashboardMachineState,
} from "../../src/state/dashboard-machine";
import { eventTimeIsValid } from "../../workers/lib/event-time";
import { SeededRng } from "./prng";

export type ActorRole = "owner" | "member";

interface ServerAlertCooldown {
  alertType: string;
  lastSentS: number;
}

interface OutboxDelivery {
  target: "line" | "personal";
  fridgeId: string;
  alertType: string;
  sentAtS: number;
}

interface PhotoRecord {
  key: string;
  uploadedAtS: number;
  refCount: number;
}

interface PendingNetworkMessage {
  deliverAtS: number;
  seq: number;
  kind: "ws_event" | "api_retry";
  actorId?: string;
  fridgeId: string;
  event?: FridgeRoomEvent;
}

export function simBangkokIsoDate(epochS: number): string {
  return new Date((Math.max(0, epochS) + 7 * 3600) * 1000)
    .toISOString()
    .slice(0, 10);
}

export function simAddDaysIso(isoDate: string, days: number): string {
  const safeDays = Math.max(0, Math.min(3650, Math.round(days)));
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(ms + safeDays * 86_400_000).toISOString().slice(0, 10);
}

function makeUuidV4(rng: SeededRng): string {
  const hex = "0123456789abcdef";
  const seg = (len: number) =>
    Array.from({ length: len }, () => hex[rng.int(0, 15)]!).join("");
  const variant = ["8", "9", "a", "b"][rng.int(0, 3)]!;
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${variant}${seg(3)}-${seg(12)}`;
}

function isCalendarIso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface FullStackInvariantMetrics {
  stepsExecuted: number;
  simulatedSeconds: number;
  idempotentDuplicatesBlocked: number;
  cooldownSuppressions: number;
  cooldownViolations: number;
  orphansCleaned: number;
  prematurePhotoDeletes: number;
  revokedAccessBlocked: number;
  staleStatusIgnored: number;
}

export class SimulatedFullStackSystem {
  readonly rng: SeededRng;
  nowS: number;
  private msgSeq = 1;
  private networkQueue: PendingNetworkMessage[] = [];

  // Simulated D1 + R2 Backend State
  readonly fridgeId = "fridge-alpha";
  fridgeDeleted = false;
  members = new Map<string, ActorRole>([
    ["owner@example.com", "owner"],
    ["member@example.com", "member"],
  ]);
  inventory = new Map<string, Food & { photoKey: string | null }>();
  appliedOps = new Set<string>();
  telemetry: Sample[] = [];
  doorEvents: DoorEvent[] = [];
  gatewaySeenS = 0;
  cooldowns = new Map<string, ServerAlertCooldown>();
  outbox: OutboxDelivery[] = [];
  photos = new Map<string, PhotoRecord>();

  // Simulated Multi-Actor Clients (browser tabs + localStorage)
  clients: Record<string, DashboardMachineState>;
  clientLastGatewaySeen: Record<string, number> = {
    "owner@example.com": 0,
    "member@example.com": 0,
  };

  readonly metrics: FullStackInvariantMetrics = {
    stepsExecuted: 0,
    simulatedSeconds: 0,
    idempotentDuplicatesBlocked: 0,
    cooldownSuppressions: 0,
    cooldownViolations: 0,
    orphansCleaned: 0,
    prematurePhotoDeletes: 0,
    revokedAccessBlocked: 0,
    staleStatusIgnored: 0,
  };
  readonly trace: string[] = [];

  constructor(seed: number, startTimeS = 1_795_305_600) {
    this.rng = new SeededRng(seed);
    this.nowS = startTimeS;
    const ownerFridge: Fridge = {
      id: this.fridgeId,
      name: "Family Fridge",
      role: "owner",
      lastSeenS: startTimeS,
      latest: null,
    };
    const memberFridge: Fridge = {
      ...ownerFridge,
      role: "member",
    };
    this.clients = {
      "owner@example.com": reduceDashboardEvent(
        initialDashboardState(startTimeS),
        {
          type: "SIGN_IN",
          fridges: [ownerFridge],
        },
      ),
      "member@example.com": reduceDashboardEvent(
        initialDashboardState(startTimeS),
        {
          type: "SIGN_IN",
          fridges: [memberFridge],
        },
      ),
    };
  }

  private enqueueWs(
    event: FridgeRoomEvent,
    minDelayS = 0,
    maxDelayS = 45,
  ): void {
    const delay = this.rng.int(minDelayS, maxDelayS);
    this.networkQueue.push({
      deliverAtS: this.nowS + delay,
      seq: this.msgSeq++,
      kind: "ws_event",
      fridgeId: this.fridgeId,
      event,
    });
  }

  private trySendAlert(
    target: "line" | "personal",
    alertType: string,
    cooldownS: number,
  ): void {
    const key = `${this.fridgeId}:${target}:${alertType}`;
    const prev = this.cooldowns.get(key);
    if (prev && this.nowS - prev.lastSentS < cooldownS) {
      this.metrics.cooldownSuppressions++;
      return;
    }
    this.cooldowns.set(key, { alertType, lastSentS: this.nowS });
    this.outbox.push({
      target,
      fridgeId: this.fridgeId,
      alertType,
      sentAtS: this.nowS,
    });
  }

  private addFood(
    actorEmail: string,
    opId: string,
    withPhoto: boolean,
  ): { ok: boolean; status: number } {
    if (!this.members.has(actorEmail) || this.fridgeDeleted) {
      this.metrics.revokedAccessBlocked++;
      return { ok: false, status: this.fridgeDeleted ? 404 : 403 };
    }
    if (this.appliedOps.has(opId)) {
      this.metrics.idempotentDuplicatesBlocked++;
      return { ok: true, status: 200 };
    }

    const offsetDays = this.rng.int(-4, 21);
    const todayIso = simBangkokIsoDate(this.nowS);
    const targetMs =
      Date.parse(`${todayIso}T00:00:00Z`) + offsetDays * 86_400_000;
    const expiry = new Date(targetMs).toISOString().slice(0, 10);
    const name = this.rng.pick([
      "Fresh Milk",
      "Spinach",
      "Eggs",
      "Yogurt",
      "Salmon",
    ]);
    const category = this.rng.pick([
      "Dairy",
      "Produce",
      "Meat",
      "Seafood",
      "Other",
    ]);
    if (!isCalendarIso(expiry) || !name.trim()) {
      return { ok: false, status: 400 };
    }

    const photoKey = withPhoto ? `photos/${opId}.jpg` : null;
    if (photoKey) {
      this.photos.set(photoKey, {
        key: photoKey,
        uploadedAtS: this.nowS,
        refCount: 1,
      });
    }

    const food: Food & { photoKey: string | null } = {
      id: opId,
      nameEn: name,
      nameTh: name,
      expiry,
      category,
      adviceEn: "Keep chilled",
      adviceTh: "แช่เย็น",
      hasPhoto: withPhoto,
      photoKey,
      checkInTimestampS: this.nowS,
      confidence: 0.95,
      checkInSource: "WEB_MANUAL",
    };
    this.appliedOps.add(opId);
    this.inventory.set(food.id, food);
    this.enqueueWs({
      type: "inventory_changed",
      itemId: food.id,
      action: "created",
    });

    const c = this.clients[actorEmail];
    if (c && c.signedIn) {
      this.clients[actorEmail] = reduceDashboardEvent(c, {
        type: "ADD_FOOD_ITEM",
        item: food,
      });
    }
    return { ok: true, status: 201 };
  }

  private removeFood(
    actorEmail: string,
    itemId: string,
  ): { ok: boolean; status: number } {
    if (!this.members.has(actorEmail) || this.fridgeDeleted) {
      this.metrics.revokedAccessBlocked++;
      return { ok: false, status: this.fridgeDeleted ? 404 : 403 };
    }
    const existing = this.inventory.get(itemId);
    if (!existing) return { ok: false, status: 404 };
    this.inventory.delete(itemId);
    if (existing.photoKey) {
      const p = this.photos.get(existing.photoKey);
      if (p) p.refCount = Math.max(0, p.refCount - 1);
    }
    this.enqueueWs({
      type: "inventory_changed",
      itemId,
      action: "deleted",
    });
    const c = this.clients[actorEmail];
    if (c && c.signedIn) {
      this.clients[actorEmail] = reduceDashboardEvent(c, {
        type: "TAKE_OUT_ITEM",
        itemId,
      });
    }
    return { ok: true, status: 200 };
  }

  private ingestGatewayTelemetry(): void {
    const temp = this.rng.chance(0.22)
      ? 9.2 + this.rng.next() * 3
      : 3.0 + this.rng.next() * 3.5;
    const voc = this.rng.chance(0.2)
      ? 280 + this.rng.int(0, 80)
      : this.rng.int(40, 150);
    const light = this.rng.chance(0.15)
      ? this.rng.int(240, 900)
      : this.rng.int(5, 45);
    const skew = this.rng.chance(0.1) ? 900 : -this.rng.int(0, 120);
    const ts = Math.max(0, this.nowS + skew);

    if (!eventTimeIsValid(ts, this.nowS)) {
      return;
    }

    const mapped: Sample = {
      nodeId: "F0",
      timeS: ts,
      temperature: temp,
      voc,
      light,
    };
    this.telemetry.push(mapped);
    this.telemetry.sort((a, b) => a.timeS - b.timeS);
    const cutoff = this.nowS - 30 * 86_400;
    this.telemetry = this.telemetry
      .filter((x) => x.timeS >= cutoff)
      .slice(-2000);

    if (temp > 8) {
      this.trySendAlert("line", "warm", 1800);
      this.trySendAlert("personal", "warm", 1800);
    }
    if (voc >= 250) {
      this.trySendAlert("line", "spoil", 1800);
      this.trySendAlert("personal", "spoil", 1800);
    }
    this.enqueueWs({
      type: "telemetry",
      lastSeenS: this.nowS,
      samples: [mapped],
    });
  }

  private ingestGatewayDoor(): void {
    const statuses = [
      "SUCCESS",
      "CLOSING",
      "OBSTRUCTION_ERROR",
      "TIMEOUT_ERROR",
      "FAULT_LOCKOUT",
      "CONTRADICTION_ERROR",
    ] as const;
    const st = this.rng.pick(statuses);
    if (!eventTimeIsValid(this.nowS, this.nowS)) return;

    const mapped: DoorEvent = {
      nodeId: "D0",
      timestampS: this.nowS,
      status: st,
    };
    this.doorEvents.unshift(mapped);
    this.doorEvents = this.doorEvents.slice(0, 100);
    if (st !== "SUCCESS" && st !== "CLOSING") {
      this.trySendAlert("line", `door_${st}`, 300);
      this.trySendAlert("personal", `door_${st}`, 300);
    }
    this.enqueueWs({ type: "door_events", events: [mapped] });
  }

  private ingestGatewayStatus(): void {
    const gatewaySeen = this.nowS;
    if (!eventTimeIsValid(gatewaySeen, this.nowS)) return;
    const f0Seen = this.rng.chance(0.25) ? gatewaySeen - 900 : gatewaySeen;
    this.gatewaySeenS = Math.max(this.gatewaySeenS, gatewaySeen);

    this.enqueueWs(
      {
        type: "status",
        status: {
          gatewaySeenS: this.gatewaySeenS,
          receivedS: this.nowS,
          nodes: [
            {
              id: "C0",
              reported: true,
              reportedS: this.gatewaySeenS,
              lastKnownS: this.gatewaySeenS,
            },
            { id: "F0", reported: true, reportedS: f0Seen, lastKnownS: f0Seen },
            {
              id: "D0",
              reported: true,
              reportedS: this.gatewaySeenS,
              lastKnownS: this.gatewaySeenS,
            },
          ],
        },
      },
      0,
      5,
    );

    if (this.gatewaySeenS > 600 && this.rng.chance(0.4)) {
      const olderSeen = this.gatewaySeenS - 300;
      this.enqueueWs(
        {
          type: "status",
          status: {
            gatewaySeenS: olderSeen,
            receivedS: this.nowS,
            nodes: [
              {
                id: "C0",
                reported: true,
                reportedS: olderSeen,
                lastKnownS: olderSeen,
              },
            ],
          },
        },
        10,
        40,
      );
    }
  }

  private runDailyCron(): void {
    for (const [key, photo] of this.photos) {
      if (photo.refCount === 0 && this.nowS - photo.uploadedAtS >= 86_400) {
        const stillReferenced = [...this.inventory.values()].some(
          (food) => food.photoKey === key,
        );
        if (stillReferenced) {
          this.metrics.prematurePhotoDeletes++;
        } else {
          this.photos.delete(key);
          this.metrics.orphansCleaned++;
        }
      }
    }

    const expCutoff = simAddDaysIso(simBangkokIsoDate(this.nowS), 2);
    const expSoonOrExpired = [...this.inventory.values()].filter(
      (food) => food.expiry <= expCutoff,
    );
    if (expSoonOrExpired.length > 0) {
      this.trySendAlert("line", "daily_digest", 20 * 3600);
    }
  }

  private flushDueNetwork(): void {
    this.networkQueue.sort(
      (a, b) => a.deliverAtS - b.deliverAtS || a.seq - b.seq,
    );
    while (
      this.networkQueue.length > 0 &&
      this.networkQueue[0]!.deliverAtS <= this.nowS
    ) {
      const msg = this.networkQueue.shift()!;
      if (msg.kind === "ws_event" && msg.event) {
        if (
          msg.event.type !== "member_revoked" &&
          msg.event.type !== "fridge_deleted" &&
          this.rng.chance(0.1)
        ) {
          continue;
        }
        for (const [email, client] of Object.entries(this.clients)) {
          if (!client.signedIn || client.room.connectionState === "closed")
            continue;
          const prevSeen = this.clientLastGatewaySeen[email] ?? 0;
          const next = reduceDashboardEvent(client, {
            type: "WS_EVENT",
            event: msg.event,
          });
          if (msg.event.type === "status") {
            const nextSeen = next.room.heartbeat?.gatewaySeenS ?? 0;
            if (
              msg.event.status.gatewaySeenS < prevSeen &&
              nextSeen === prevSeen
            ) {
              this.metrics.staleStatusIgnored++;
            }
            this.clientLastGatewaySeen[email] = nextSeen;
          }
          this.clients[email] = next;
        }
      }
    }
  }

  step(): string {
    this.metrics.stepsExecuted++;
    const actor = this.rng.pick([
      "owner@example.com",
      "member@example.com",
    ] as const);
    const op = this.rng.weightedPick<
      | "tick"
      | "add_food"
      | "duplicate_op"
      | "take_out"
      | "telemetry"
      | "door"
      | "status"
      | "cron"
      | "revoke_or_restore"
    >([
      ["tick", 20],
      ["add_food", 18],
      ["duplicate_op", 7],
      ["take_out", 12],
      ["telemetry", 14],
      ["door", 8],
      ["status", 8],
      ["cron", 5],
      ["revoke_or_restore", 4],
    ]);

    switch (op) {
      case "tick": {
        const delta = this.rng.pick([30, 120, 900, 3600, 21_600, 86_400]);
        this.nowS += delta;
        this.metrics.simulatedSeconds += delta;
        for (const email of Object.keys(this.clients)) {
          this.clients[email] = reduceDashboardEvent(this.clients[email]!, {
            type: "TICK_CLOCK",
            deltaS: delta,
          });
        }
        this.flushDueNetwork();
        break;
      }
      case "add_food": {
        const opId = makeUuidV4(this.rng);
        this.addFood(actor, opId, this.rng.bool(0.4));
        break;
      }
      case "duplicate_op": {
        const existingId = [...this.appliedOps][0];
        if (existingId) {
          this.addFood("owner@example.com", existingId, false);
        }
        break;
      }
      case "take_out": {
        const items = [...this.inventory.values()];
        if (items.length > 0) {
          this.removeFood(actor, this.rng.pick(items).id);
        }
        break;
      }
      case "telemetry":
        this.ingestGatewayTelemetry();
        this.flushDueNetwork();
        break;
      case "door":
        this.ingestGatewayDoor();
        this.flushDueNetwork();
        break;
      case "status":
        this.ingestGatewayStatus();
        this.flushDueNetwork();
        break;
      case "cron":
        this.runDailyCron();
        break;
      case "revoke_or_restore": {
        if (this.members.has("member@example.com")) {
          this.members.delete("member@example.com");
          const c = this.clients["member@example.com"]!;
          this.clients["member@example.com"] = reduceDashboardEvent(c, {
            type: "WS_EVENT",
            event: { type: "member_revoked", email: "member@example.com" },
          });
        } else {
          this.members.set("member@example.com", "member");
          this.clients["member@example.com"] = reduceDashboardEvent(
            initialDashboardState(this.nowS),
            {
              type: "SIGN_IN",
              fridges: [
                {
                  id: this.fridgeId,
                  name: "Family Fridge",
                  role: "member",
                  lastSeenS: this.nowS,
                  latest: null,
                },
              ],
            },
          );
          this.clientLastGatewaySeen["member@example.com"] = 0;
        }
        break;
      }
    }

    this.trace.push(`${this.metrics.stepsExecuted}:${op}@${this.nowS}`);
    return op;
  }

  assertInvariants(context: string): void {
    if (!this.fridgeDeleted) {
      const owners = [...this.members.values()].filter(
        (r) => r === "owner",
      ).length;
      if (owners < 1) {
        throw new Error(`Owner count dropped to 0 [${context}]`);
      }
    }

    if (this.metrics.prematurePhotoDeletes > 0) {
      throw new Error(`Premature photo GC detected [${context}]`);
    }
    for (const food of this.inventory.values()) {
      if (food.photoKey) {
        const photo = this.photos.get(food.photoKey);
        if (!photo || photo.refCount < 1) {
          throw new Error(
            `Missing photo ref for live food ${food.id} [${context}]`,
          );
        }
      }
    }

    const lastSeen = new Map<string, number>();
    for (const delivery of this.outbox) {
      const cooldown =
        delivery.alertType === "daily_digest"
          ? 20 * 3600
          : delivery.alertType.startsWith("door_")
            ? 300
            : 1800;
      const key = `${delivery.fridgeId}:${delivery.target}:${delivery.alertType}`;
      const prevS = lastSeen.get(key);
      if (prevS !== undefined && delivery.sentAtS - prevS < cooldown) {
        this.metrics.cooldownViolations++;
        throw new Error(
          `Cooldown violation on ${key}: ${delivery.sentAtS - prevS}s < ${cooldown}s [${context}]`,
        );
      }
      lastSeen.set(key, delivery.sentAtS);
    }

    for (const [email, client] of Object.entries(this.clients)) {
      if (!client.signedIn) continue;
      if (!this.members.has(email) && client.activeFridgeId === this.fridgeId) {
        if (client.room.connectionState !== "closed") {
          throw new Error(
            `Revoked member ${email} kept active room [${context}]`,
          );
        }
      }
      if (
        (client.room.loadError || client.room.inventory.length === 0) &&
        deriveRecoveryActions(client).length === 0
      ) {
        throw new Error(
          `No recovery action available for ${email} [${context}]`,
        );
      }
    }

    if (this.telemetry.length > 2000) {
      throw new Error(
        `Telemetry unbounded (${this.telemetry.length}) [${context}]`,
      );
    }
  }
}

export function runFullStackSimulation(
  seed: number,
  steps = 200,
): { sim: SimulatedFullStackSystem; trace: string[] } {
  const sim = new SimulatedFullStackSystem(seed);
  for (let i = 0; i < steps; i++) {
    const op = sim.step();
    sim.assertInvariants(`seed=${seed} step=${i + 1} op=${op}`);
  }
  return { sim, trace: sim.trace };
}
