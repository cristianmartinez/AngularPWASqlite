import { Injectable, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { runMigrations, getDbVersion, type MigrationResult } from './migrations';

type SqlJsDatabase = import('sql.js').Database;

export type StorageBackend = 'auto' | 'opfs' | 'indexeddb' | 'memory';
export type ActiveBackend = 'opfs' | 'indexeddb' | 'memory';

const DB_NAME = 'app.db';
const PREF_KEY = 'sqlite-preferred-backend';

@Injectable({ providedIn: 'root' })
export class SqliteService {
  private document = inject(DOCUMENT);
  private db: SqlJsDatabase | null = null;
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);
  readonly dbVersion = signal(0);
  readonly preferredBackend = signal<StorageBackend>('auto');
  readonly activeBackend = signal<ActiveBackend>('memory');
  readonly availableBackends = signal<ActiveBackend[]>(['memory']);
  readonly migrationResult = signal<MigrationResult | null>(null);

  async initialize(): Promise<void> {
    try {
      // Detect available backends
      const backends: ActiveBackend[] = ['memory'];
      if (typeof indexedDB !== 'undefined') backends.unshift('indexeddb');
      if (await this.isOpfsAvailable()) backends.unshift('opfs');
      this.availableBackends.set(backends);

      // Load saved preference
      const saved = localStorage.getItem(PREF_KEY) as StorageBackend | null;
      if (saved) this.preferredBackend.set(saved);

      const baseHref = this.document.querySelector('base')?.getAttribute('href') ?? '/';
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs({
        locateFile: () => `${baseHref}sql-wasm.wasm`,
      });

      const savedData = await this.loadFromStorage();
      this.db = savedData ? new SQL.Database(savedData) : new SQL.Database();

      // Snapshot before migrations for rollback safety
      const snapshot = this.db.export();

      try {
        const result = runMigrations(this.db);
        if (result.applied.length > 0) {
          this.migrationResult.set(result);
        }
        this.dbVersion.set(getDbVersion(this.db));
        await this.saveToStorage(this.db.export());
      } catch (err) {
        console.error('Migration failed, restoring snapshot:', err);
        this.db.close();
        this.db = new SQL.Database(snapshot);
        this.dbVersion.set(getDbVersion(this.db));
        this.error.set(
          `Migration failed: ${err instanceof Error ? err.message : err}`
        );
      }

      this.ready.set(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize SQLite';
      this.error.set(message);
      throw err;
    }
  }

  async switchBackend(target: StorageBackend): Promise<void> {
    this.ensureReady();
    const data = this.db!.export();

    this.preferredBackend.set(target);
    localStorage.setItem(PREF_KEY, target);

    // Save to the new target
    await this.saveToStorage(data);
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

  private resolveBackend(): ActiveBackend | 'auto' {
    return this.preferredBackend();
  }

  // --- Load ---

  private async loadFromStorage(): Promise<Uint8Array | null> {
    const pref = this.resolveBackend();

    if (pref !== 'auto') {
      return this.loadFromSpecific(pref);
    }

    // Auto: try OPFS -> IndexedDB -> memory
    const fromOpfs = await this.loadFromSpecific('opfs');
    if (fromOpfs) return fromOpfs;

    const fromIdb = await this.loadFromSpecific('indexeddb');
    if (fromIdb) return fromIdb;

    this.activeBackend.set('memory');
    return null;
  }

  private async loadFromSpecific(backend: ActiveBackend): Promise<Uint8Array | null> {
    switch (backend) {
      case 'opfs':
        if (!(await this.isOpfsAvailable())) return null;
        try {
          const root = await navigator.storage.getDirectory();
          const fileHandle = await root.getFileHandle(DB_NAME);
          const file = await fileHandle.getFile();
          const buffer = await file.arrayBuffer();
          if (buffer.byteLength > 0) {
            this.activeBackend.set('opfs');
            return new Uint8Array(buffer);
          }
        } catch {
          // File doesn't exist yet
        }
        return null;

      case 'indexeddb':
        try {
          const data = await this.idbGet(DB_NAME);
          if (data) {
            this.activeBackend.set('indexeddb');
            return data;
          }
        } catch {
          // IndexedDB not available
        }
        return null;

      case 'memory':
        this.activeBackend.set('memory');
        return null;
    }
  }

  // --- Save ---

  private async saveToStorage(data: Uint8Array): Promise<void> {
    const pref = this.resolveBackend();

    if (pref !== 'auto') {
      await this.saveToSpecific(pref, data);
      return;
    }

    // Auto: try OPFS -> IndexedDB -> memory
    if (await this.saveToSpecific('opfs', data)) return;
    if (await this.saveToSpecific('indexeddb', data)) return;
    this.activeBackend.set('memory');
  }

  private async saveToSpecific(backend: ActiveBackend, data: Uint8Array): Promise<boolean> {
    switch (backend) {
      case 'opfs':
        if (!(await this.isOpfsAvailable())) return false;
        try {
          const root = await navigator.storage.getDirectory();
          const fileHandle = await root.getFileHandle(DB_NAME, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(data.buffer as ArrayBuffer);
          await writable.close();
          this.activeBackend.set('opfs');
          return true;
        } catch {
          return false;
        }

      case 'indexeddb':
        try {
          await this.idbSet(DB_NAME, data);
          this.activeBackend.set('indexeddb');
          return true;
        } catch {
          return false;
        }

      case 'memory':
        this.activeBackend.set('memory');
        return true;
    }
  }

  private async isOpfsAvailable(): Promise<boolean> {
    try {
      return typeof navigator.storage?.getDirectory === 'function';
    } catch {
      return false;
    }
  }

  // --- IndexedDB helpers ---

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
