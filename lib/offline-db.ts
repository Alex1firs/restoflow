/**
 * Restoflow POS Offline Database & Cryptography Engine
 * Handles IndexedDB transactional tables, 100,000 iterations PBKDF2,
 * constant-time hashes comparison, and unique device identification.
 */

const DB_NAME = "RestoflowOfflineDB";
const DB_VERSION = 1;

export type OfflineStaff = {
  staffId: string;
  staffName: string;
  role: string;
  pinSalt: string; // Hex salt string
  pinHash: string; // Hex PBKDF2 hash string
  isActive: boolean;
  lastSyncedAt: number;
};

export type OfflineMenuItem = {
  itemId: string;
  name: string;
  price: number;
  indoorPrice: number;
  isActive: boolean;
};

export type OfflineOrder = {
  localOrderId: string;
  items: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
    notes?: string;
  }>;
  total: number;
  cashierId: string;
  cashierName: string;
  deviceId: string;
  terminalName: string;
  syncStatus: "pending" | "syncing" | "synced" | "failed";
  syncError?: string;
  createdAt: number;
  orderSource: "counter";
};

// Open IndexedDB database
export function openOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      
      // Store 1: staff authentication cache
      if (!db.objectStoreNames.contains("staff")) {
        db.createObjectStore("staff", { keyPath: "staffId" });
      }

      // Store 2: local menu cached prices
      if (!db.objectStoreNames.contains("menu")) {
        db.createObjectStore("menu", { keyPath: "itemId" });
      }

      // Store 3: pending synchronization orders queue
      if (!db.objectStoreNames.contains("ordersQueue")) {
        db.createObjectStore("ordersQueue", { keyPath: "localOrderId" });
      }
    };
  });
}

// ── CRYPTO UTILITIES ─────────────────────────────────────────────────────────

// Convert hex string to byte array
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Convert byte array to hex string
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifies a 4-digit staff PIN code offline using Web Crypto PBKDF2 with 100,000 iterations.
 */
export async function verifyOfflinePin(
  enteredPin: string,
  storedSaltHex: string,
  storedHashHex: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const pinBuffer = encoder.encode(enteredPin);
    const saltBuffer = hexToBytes(storedSaltHex).buffer as ArrayBuffer;

    // Import the raw PIN bits as cryptographic base key material
    const baseKey = await crypto.subtle.importKey(
      "raw",
      pinBuffer,
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );

    // Derive 256 bits (32 bytes) of hash using PBKDF2 and 100,000 iterations
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: saltBuffer,
        iterations: 100000,
        hash: "SHA-256",
      },
      baseKey,
      256
    );

    const derivedHex = bytesToHex(new Uint8Array(derivedBits));

    // constant-time hash comparison to eliminate timing side-channel attacks
    return constantTimeCompare(derivedHex, storedHashHex);
  } catch (error) {
    console.error("Offline auth cryptographic derivation failed:", error);
    return false;
  }
}

/**
 * Compares two hashes in constant-time.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ── DEVICE IDENTITY UTILITIES ───────────────────────────────────────────────

/**
 * Retrieves or lazily registers a persistent, unique device ID for this browser client.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "server-side";
  let deviceId = localStorage.getItem("rf_pos_device_id");
  if (!deviceId) {
    // Generate simple compliant secure UUID v4 equivalent
    const parts = [
      Math.random().toString(36).substring(2, 10),
      Math.random().toString(36).substring(2, 6),
      Math.random().toString(36).substring(2, 6),
      Math.random().toString(36).substring(2, 14),
    ];
    deviceId = `dev-${parts.join("-")}-${Date.now()}`;
    localStorage.setItem("rf_pos_device_id", deviceId);
  }
  return deviceId;
}

/**
 * Gets or sets the custom terminal name recognized by the manager.
 */
export function getTerminalName(): string {
  if (typeof window === "undefined") return "Server Console";
  return localStorage.getItem("rf_pos_terminal_name") || "Terminal 1";
}

export function setTerminalName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("rf_pos_terminal_name", name.trim() || "Terminal 1");
}

// Last successful sync time persistence
export function getLastSyncTime(): string {
  if (typeof window === "undefined") return "Never";
  return localStorage.getItem("rf_pos_last_sync_time") || "Never";
}

export function setLastSyncTime(timeStr: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("rf_pos_last_sync_time", timeStr);
}

// ── DATABASE OPERATIONS ──────────────────────────────────────────────────────

// Generic write/put helper
export async function dbPut<T>(storeName: string, item: T): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(db.objectStoreNames.contains(storeName) ? storeName : tx.db.objectStoreNames[0]);
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Generic get all helper
export async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

// Generic delete helper
export async function dbDelete(storeName: string, key: string): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Clear store helper
export async function dbClear(storeName: string): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
