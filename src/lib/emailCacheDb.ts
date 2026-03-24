/**
 * Large email/CSV cache in IndexedDB (much higher quota than localStorage ~5MB).
 * Used for Daily Alerts / Jira month views so a full month of PB reports can persist after refresh.
 */
import type { GmailMessage } from "@/types/gmail";

const DB_NAME = "sentinel-email-cache";
const DB_VERSION = 1;
const STORE = "monthReports";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

/** Load cached messages for a storage key (e.g. sentinel_daily_alerts_emails_2026_3). */
export async function idbGetMonthEmails(key: string): Promise<GmailMessage[] | null> {
  try {
    const db = await openDb();
    return await new Promise<GmailMessage[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result;
        if (v == null) resolve(null);
        else if (Array.isArray(v)) resolve(v as GmailMessage[]);
        else resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Replace cache for key (stripped bodies recommended). */
export async function idbPutMonthEmails(key: string, messages: GmailMessage[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
    tx.objectStore(STORE).put(messages, key);
  });
}

export async function idbDeleteMonthEmails(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(key);
    });
  } catch {
    /* ignore */
  }
}

/** Optional: log estimated quota usage (devtools). */
export async function logStorageEstimate(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (usage != null && quota != null) {
      console.info(
        `[sentinel] persistent storage ~${(usage / 1e6).toFixed(1)} MB / ${(quota / 1e6).toFixed(0)} MB`
      );
    }
  } catch {
    /* ignore */
  }
}
