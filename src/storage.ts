// ===== 本机保存层：资料、判定、设置三个相互独立的 IndexedDB 库 =====
// 资料（钻孔分层/试段读数）与判定（复核结论/冻结版本）物理分库，
// 任何一方的读写、迁移、清空都不牵连另一方。
import type { Hole, TestRecord, Verdict } from "./types";

const DB_RAW = "wpt_raw_material"; // 资料库
const DB_VERDICT = "wpt_verdict"; // 判定库
const DB_LOCAL = "wpt_local_settings"; // 本机设置库
const STORE = "kv";
const VERSION = 1;

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet<T>(dbName: string, key: string): Promise<T | undefined> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function dbPut<T>(dbName: string, key: string, value: T): Promise<void> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// ----- 资料库：holes.json + tests/<孔号>/<试段id> -----
const K_HOLES = "holes";
const testsKey = (holeId: string) => `tests/${holeId}`;

export const storage = {
  async loadHoles(): Promise<Hole[] | undefined> {
    return dbGet<Hole[]>(DB_RAW, K_HOLES);
  },
  async saveHoles(holes: Hole[]): Promise<void> {
    await dbPut(DB_RAW, K_HOLES, holes);
  },
  async loadTests(holeId: string): Promise<TestRecord[] | undefined> {
    return dbGet<TestRecord[]>(DB_RAW, testsKey(holeId));
  },
  async saveTests(holeId: string, tests: TestRecord[]): Promise<void> {
    await dbPut(DB_RAW, testsKey(holeId), tests);
  },

  // ----- 判定库：verdicts/<孔号>（与资料完全独立） -----
  async loadVerdicts(holeId: string): Promise<Record<string, Verdict> | undefined> {
    return dbGet<Record<string, Verdict>>(DB_VERDICT, testsKey(holeId));
  },
  async saveVerdicts(holeId: string, verdicts: Record<string, Verdict>): Promise<void> {
    await dbPut(DB_VERDICT, testsKey(holeId), verdicts);
  },

  // ----- 本机设置：记住上次查看的孔号（不进资料、不进判定） -----
  async getLastHole(): Promise<string | undefined> {
    return dbGet<string>(DB_LOCAL, "lastHoleId");
  },
  async setLastHole(holeId: string): Promise<void> {
    await dbPut(DB_LOCAL, "lastHoleId", holeId);
  },
};

/** 导出某一库的 JSON（资料导出 / 判定导出分开） */
export async function exportStore(kind: "raw" | "verdict", holeId?: string): Promise<string> {
  if (kind === "raw") {
    const holes = (await storage.loadHoles()) ?? [];
    const tests = holeId
      ? Object.fromEntries([[holeId, (await storage.loadTests(holeId)) ?? []]])
      : Object.fromEntries(
          await Promise.all(
            holes.map(async (h) => [h.id, (await storage.loadTests(h.id)) ?? []])
          )
        );
    return JSON.stringify({ kind: "资料", holes, tests }, null, 2);
  }
  const holes = (await storage.loadHoles()) ?? [];
  const verdicts = Object.fromEntries(
    await Promise.all(
      (holeId ? holes.filter((h) => h.id === holeId) : holes).map(async (h) => [
        h.id,
        (await storage.loadVerdicts(h.id)) ?? {},
      ])
    )
  );
  return JSON.stringify({ kind: "判定", verdicts }, null, 2);
}
