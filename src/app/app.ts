import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UpperCasePipe } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatListModule } from '@angular/material/list';
import { MatBadgeModule } from '@angular/material/badge';
import { SqliteService, type StorageBackend } from './services/sqlite.service';

interface TodoItem {
  id: number;
  title: string;
  done: number;
  priority: number;
  created_at: string;
}

const PRIORITY_LABELS = ['Low', 'Medium', 'High'] as const;

@Component({
  selector: 'app-root',
  imports: [
    FormsModule,
    UpperCasePipe,
    MatToolbarModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatChipsModule,
    MatListModule,
    MatBadgeModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, OnDestroy {
  private sqlite = inject(SqliteService);

  readonly dbReady = this.sqlite.ready;
  readonly dbError = this.sqlite.error;
  readonly dbVersion = this.sqlite.dbVersion;
  readonly preferredBackend = this.sqlite.preferredBackend;
  readonly activeBackend = this.sqlite.activeBackend;
  readonly availableBackends = this.sqlite.availableBackends;
  readonly todos = signal<TodoItem[]>([]);
  readonly newTodoTitle = signal('');
  readonly newTodoPriority = signal(0);
  readonly priorityLabels = PRIORITY_LABELS;
  readonly storageEstimate = signal<{ usage: string; quota: string } | null>(null);
  readonly persistenceGranted = signal<boolean | null>(null);

  async ngOnInit(): Promise<void> {
    await this.sqlite.initialize();
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
      'INSERT INTO todos (title, done, priority) VALUES (:title, 0, :priority)',
      { ':title': title, ':priority': this.newTodoPriority() }
    );
    await this.sqlite.save();
    this.newTodoTitle.set('');
    this.newTodoPriority.set(0);
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

  async onBackendChange(value: StorageBackend): Promise<void> {
    await this.sqlite.switchBackend(value);
    await this.updateStorageInfo();
  }

  async requestPersistence(): Promise<void> {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      this.persistenceGranted.set(granted);
    }
    await this.updateStorageInfo();
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
