/**
 * The IndexedDB database behind saved progress. Every change is a transaction, which IndexedDB
 * applies atomically and one at a time across all tabs — unlike localStorage, where each browser
 * process has its own copy and two tabs can overwrite each other's changes.
 *
 * One record per item, keyed by dataset first, so a map's records form one key range:
 * - stats: [datasetId, kind, placeId] → { seen, firstTry }
 * - best:  [datasetId, "mode:group"] → { correct, total, ms }
 * - runs:  [datasetId, runId]        → the run
 * - daily: [datasetId, "YYYY-MM-DD"] → the day's result (added once: the first finished run wins)
 * - attempts: [datasetId, "YYYY-MM-DD"] → the day's challenge in progress, saved after every answer
 * - meta:  [datasetId, name]         → bookkeeping, e.g. that old localStorage progress was moved in
 */

export const DB_NAME = 'map-memory'
const DB_VERSION = 3

export type StoreName = 'stats' | 'best' | 'runs' | 'daily' | 'attempts' | 'meta'
export const PROGRESS_STORES: StoreName[] = ['stats', 'best', 'runs', 'daily', 'attempts']

/** Every key belonging to one map: [datasetId, …] sorts after [datasetId] and before [datasetId, []]. */
export const datasetRange = (datasetId: string) => IDBKeyRange.bound([datasetId], [datasetId, []])

/**
 * Opens (creating or upgrading) the database. Rejects if IndexedDB isn't available; if another tab is
 * blocking an upgrade, it waits for that tab to let go.
 */
export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = (e) => {
      const db = open.result
      for (const name of ['stats', 'best', 'runs', 'daily', 'attempts', 'meta'] as StoreName[]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
      }
      // Version 1 only held daily results, keyed "datasetId:YYYY-MM-DD": move them into `daily`.
      if (e.oldVersion === 1 && db.objectStoreNames.contains('daily-claims')) {
        const tx = open.transaction!
        const daily = tx.objectStore('daily')
        const cursorReq = tx.objectStore('daily-claims').openCursor()
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result
          if (!cursor) return db.deleteObjectStore('daily-claims')
          const key = String(cursor.key)
          const cut = key.lastIndexOf(':')
          if (cut > 0) daily.put(cursor.value, [key.slice(0, cut), key.slice(cut + 1)])
          cursor.continue()
        }
      }
    }
    open.onsuccess = () => {
      const db = open.result
      // A newer version opened in another tab: step aside so it can upgrade.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    open.onerror = () => reject(open.error)
    // Blocked (another tab still has an older version open): the request waits until that tab lets go.
  })
}

/** A request's result as a promise. Safe to await inside a transaction: the next request still goes in it. */
export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Runs `body` in one transaction and resolves with its value once the transaction has committed —
 * so callers only ever see changes that were actually saved. Inside `body`, await only requests
 * (other awaits would let the transaction close). If `body` throws, the transaction is rolled back.
 */
export async function transact<T>(
  db: IDBDatabase,
  stores: StoreName[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode)
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'))
  })
  try {
    const value = await body(tx)
    await committed
    return value
  } catch (e) {
    try {
      tx.abort()
    } catch {
      // Already finished or aborted.
    }
    committed.catch(() => {}) // the rollback's rejection is expected; the error below is the one that matters
    throw e
  }
}
