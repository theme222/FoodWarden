import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection, doc, limit, onSnapshot, orderBy, query,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { readBucket, readFood, readFridgeList, readHeartbeat } from "./model";
import type { Food, Fridge, Heartbeat, Sample } from "./model";

interface Live<T> {
  key: string;
  data: T | null;
  error: boolean;
}

export function useFridges(user: User) {
  const [live, setLive] = useState<Live<Fridge[]>>({ key: user.uid, data: null, error: false });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/fridges", {
          signal: controller.signal, headers: { Authorization: "Bearer " + await user.getIdToken() },
        });
        if (!response.ok) throw new Error("Fridges unavailable");
        const data = readFridgeList(await response.json());
        if (!controller.signal.aborted) setLive({ key: user.uid, data, error: false });
      } catch {
        if (!controller.signal.aborted) setLive({ key: user.uid, data: null, error: true });
      }
    })();
    return () => controller.abort();
  }, [user]);
  return live.key === user.uid ? live : { data: null, error: false };
}

export function useInventory(db: Firestore, fridgeId: string, enabled: boolean) {
  const [live, setLive] = useState<Live<Food[]>>({ key: fridgeId, data: null, error: false });
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(collection(db, "fridges", fridgeId, "inventory"), (snapshot) =>
      setLive({ key: fridgeId, data: snapshot.docs.map((doc) => readFood(doc.id, doc.data())), error: false }),
    () => setLive({ key: fridgeId, data: null, error: true }));
  }, [db, fridgeId, enabled]);
  return live.key === fridgeId ? live : { data: null, error: false };
}

export function useHeartbeat(db: Firestore, fridgeId: string) {
  const [live, setLive] = useState<Live<Heartbeat | undefined>>({ key: fridgeId, data: null, error: false });
  useEffect(() => onSnapshot(doc(db, "fridges", fridgeId, "system_status", "latest"), (snapshot) =>
    setLive({ key: fridgeId, data: readHeartbeat(snapshot.data()) ?? undefined, error: false }),
  () => setLive({ key: fridgeId, data: null, error: true })), [db, fridgeId]);
  return live.key === fridgeId ? live : { data: null, error: false };
}

export function useHistory(db: Firestore, fridgeId: string) {
  const [live, setLive] = useState<Live<Sample[]>>({ key: fridgeId, data: null, error: false });
  useEffect(() => {
    const buckets = query(collection(db, "fridges", fridgeId, "telemetry_minute"),
      orderBy("bucket_minute", "desc"), limit(61));
    return onSnapshot(buckets, (snapshot) => setLive({
      key: fridgeId, data: snapshot.docs.flatMap((doc) => readBucket(doc.data())), error: false,
    }), () => setLive({ key: fridgeId, data: null, error: true }));
  }, [db, fridgeId]);
  return live.key === fridgeId ? live : { data: null, error: false };
}

export function useNow() {
  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNowS(Math.floor(Date.now() / 1000)), 15000);
    return () => window.clearInterval(timer);
  }, []);
  return nowS;
}
