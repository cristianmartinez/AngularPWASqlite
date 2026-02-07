import { Injectable, inject, signal } from '@angular/core';
import { SqliteService } from './sqlite.service';

export interface TodoItem {
  id: number;
  title: string;
  done: number;
  priority: number;
  created_at: string;
}

export const PRIORITY_LABELS = ['Low', 'Medium', 'High'] as const;

@Injectable({ providedIn: 'root' })
export class TodoService {
  private sqlite = inject(SqliteService);

  readonly todos = signal<TodoItem[]>([]);

  load(): void {
    const results = this.sqlite.query<TodoItem>(
      'SELECT * FROM todos ORDER BY created_at DESC'
    );
    this.todos.set(results);
  }

  async add(title: string, priority: number): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;

    this.sqlite.exec(
      'INSERT INTO todos (title, done, priority) VALUES (:title, 0, :priority)',
      { ':title': trimmed, ':priority': priority }
    );
    await this.sqlite.save();
    this.load();
  }

  async toggle(id: number): Promise<void> {
    this.sqlite.exec(
      'UPDATE todos SET done = CASE WHEN done = 0 THEN 1 ELSE 0 END WHERE id = :id',
      { ':id': id }
    );
    await this.sqlite.save();
    this.load();
  }

  async delete(id: number): Promise<void> {
    this.sqlite.exec('DELETE FROM todos WHERE id = :id', { ':id': id });
    await this.sqlite.save();
    this.load();
  }

  async bulkAdd(
    count: number,
    batchSize: number,
    onProgress?: (done: number) => void
  ): Promise<void> {
    for (let i = 0; i < count; i += batchSize) {
      const batch = Math.min(batchSize, count - i);
      this.sqlite.exec('BEGIN TRANSACTION');
      for (let j = 0; j < batch; j++) {
        const num = i + j + 1;
        const priority = num % 3;
        this.sqlite.exec(
          'INSERT INTO todos (title, done, priority) VALUES (:title, 0, :priority)',
          { ':title': `Test todo #${num}`, ':priority': priority }
        );
      }
      this.sqlite.exec('COMMIT');
      onProgress?.(i + batch);
      await new Promise((r) => setTimeout(r, 0)); // yield to UI
    }
    await this.sqlite.save();
    this.load();
  }
}
