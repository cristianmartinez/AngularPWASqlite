import { Injectable, signal } from '@angular/core';
import initSqlJs, { type Database } from 'sql.js';

const DB_NAME = 'app.db';

@Injectable({ providedIn: 'root' })
export class SqliteService {
  private db: Database | null = null;
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);
  readonly persistenceMode = signal<'opfs' | 'indexeddb' | 'memory'>('memory');

  async initialize(): Promise<void> {
    try {
      const SQL = await initSqlJs({
        locateFile: () => '/sql-wasm.wasm',
      });

      const savedData = await this.loadFromStorage();
      this.db = savedData ? new SQL.Database(savedData) : new SQL.Database();

      this.ready.set(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize SQLite';
      this.error.set(message);
      throw err;
    }
  }

  exec(sql: string, params?: Record<string, unknown>): void {
    this.ensureReady();
    this.db!.run(sql, params as Record<string, number | string | Uint8Array | null>);
  }

  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): T[] {
    this.ensureReady();
    const stmt = this.db!.prepare(sql);
    if (params) {
      stmt.bind(params as Record<string, number | string | Uint8Array | null>);
    }

    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  async save(): Promise<void> {
    this.ensureReady();
    const data = this.db!.export();
    await this.saveToStorage(data);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.save();
      this.db.close();
      this.db = null;
      this.ready.set(false);
    }
  }

  private ensureReady(): void {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
  }

  private async loadFromStorage(): Promise<Uint8Array | null> {
    // Try OPFS first (best for PWA - true filesystem access)
    if (await this.isOpfsAvailable()) {
      try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle(DB_NAME);
        const file = await fileHandle.getFile();
        const buffer = await file.arrayBuffer();
        if (buffer.byteLength > 0) {
          this.persistenceMode.set('opfs');
          return new Uint8Array(buffer);
        }
      } catch {
        // File doesn't exist yet in OPFS, fall through
      }
    }

    // Fallback to IndexedDB
    try {
      const data = await this.idbGet(DB_NAME);
      if (data) {
        this.persistenceMode.set('indexeddb');
        return data;
      }
    } catch {
      // IndexedDB not available
    }

    this.persistenceMode.set('memory');
    return null;
  }

  private async saveToStorage(data: Uint8Array): Promise<void> {
    // Request persistent storage permission
    if (navigator.storage?.persist) {
      await navigator.storage.persist();
    }

    // Try OPFS first
    if (await this.isOpfsAvailable()) {
      try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle(DB_NAME, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data.buffer as ArrayBuffer);
        await writable.close();
        this.persistenceMode.set('opfs');
        return;
      } catch {
        // OPFS write failed, fall through to IndexedDB
      }
    }

    // Fallback to IndexedDB
    try {
      await this.idbSet(DB_NAME, data);
      this.persistenceMode.set('indexeddb');
    } catch {
      this.persistenceMode.set('memory');
    }
  }

  private async isOpfsAvailable(): Promise<boolean> {
    try {
      return typeof navigator.storage?.getDirectory === 'function';
    } catch {
      return false;
    }
  }

  // Simple IndexedDB key-value helpers
  private idbOpen(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('sqlite-storage', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('databases');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async idbGet(key: string): Promise<Uint8Array | null> {
    const db = await this.idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('databases', 'readonly');
      const request = tx.objectStore('databases').get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  private async idbSet(key: string, value: Uint8Array): Promise<void> {
    const db = await this.idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('databases', 'readwrite');
      tx.objectStore('databases').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
