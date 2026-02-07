import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UpperCasePipe } from '@angular/common';
import { SqliteService } from './services/sqlite.service';

interface TodoItem {
  id: number;
  title: string;
  done: number;
  created_at: string;
}

@Component({
  selector: 'app-root',
  imports: [FormsModule, UpperCasePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, OnDestroy {
  private sqlite = inject(SqliteService);

  readonly dbReady = this.sqlite.ready;
  readonly dbError = this.sqlite.error;
  readonly persistenceMode = this.sqlite.persistenceMode;
  readonly todos = signal<TodoItem[]>([]);
  readonly newTodoTitle = signal('');
  readonly storageEstimate = signal<{ usage: string; quota: string } | null>(null);
  readonly persistenceGranted = signal<boolean | null>(null);

  async ngOnInit(): Promise<void> {
    await this.sqlite.initialize();
    this.createSchema();
    this.loadTodos();
    await this.updateStorageInfo();
  }

  async ngOnDestroy(): Promise<void> {
    await this.sqlite.close();
  }

  async addTodo(): Promise<void> {
    const title = this.newTodoTitle().trim();
    if (!title) return;

    this.sqlite.exec(
      'INSERT INTO todos (title, done) VALUES (:title, 0)',
      { ':title': title }
    );
    await this.sqlite.save();
    this.newTodoTitle.set('');
    this.loadTodos();
  }

  async toggleTodo(id: number): Promise<void> {
    this.sqlite.exec(
      'UPDATE todos SET done = CASE WHEN done = 0 THEN 1 ELSE 0 END WHERE id = :id',
      { ':id': id }
    );
    await this.sqlite.save();
    this.loadTodos();
  }

  async deleteTodo(id: number): Promise<void> {
    this.sqlite.exec('DELETE FROM todos WHERE id = :id', { ':id': id });
    await this.sqlite.save();
    this.loadTodos();
  }

  async requestPersistence(): Promise<void> {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      this.persistenceGranted.set(granted);
    }
    await this.updateStorageInfo();
  }

  private createSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        done INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  private loadTodos(): void {
    const results = this.sqlite.query<TodoItem>(
      'SELECT * FROM todos ORDER BY created_at DESC'
    );
    this.todos.set(results);
  }

  private async updateStorageInfo(): Promise<void> {
    if (navigator.storage?.persisted) {
      this.persistenceGranted.set(await navigator.storage.persisted());
    }
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      this.storageEstimate.set({
        usage: this.formatBytes(est.usage ?? 0),
        quota: this.formatBytes(est.quota ?? 0),
      });
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }
}
