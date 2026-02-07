import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UpperCasePipe } from '@angular/common';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { SqliteService, type StorageBackend } from './services/sqlite.service';
import { TodoService, PRIORITY_LABELS } from './services/todo.service';
import { filter } from 'rxjs';

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
    MatDividerModule,
    MatSnackBarModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, OnDestroy {
  private sqlite = inject(SqliteService);
  private todoService = inject(TodoService);
  private swUpdate = inject(SwUpdate);
  private snackBar = inject(MatSnackBar);

  readonly dbReady = this.sqlite.ready;
  readonly dbError = this.sqlite.error;
  readonly dbVersion = this.sqlite.dbVersion;
  readonly preferredBackend = this.sqlite.preferredBackend;
  readonly activeBackend = this.sqlite.activeBackend;
  readonly availableBackends = this.sqlite.availableBackends;
  readonly todos = this.todoService.todos;
  readonly newTodoTitle = signal('');
  readonly newTodoPriority = signal(0);
  readonly priorityLabels = PRIORITY_LABELS;
  readonly storageEstimate = signal<{ usage: string; quota: string } | null>(null);
  readonly persistenceGranted = signal<boolean | null>(null);

  async ngOnInit(): Promise<void> {
    this.listenForPwaUpdates();
    await this.sqlite.initialize();
    this.showMigrationNotification();
    this.todoService.load();
    await this.updateStorageInfo();
  }

  async ngOnDestroy(): Promise<void> {
    await this.sqlite.close();
  }

  async addTodo(): Promise<void> {
    await this.todoService.add(this.newTodoTitle(), this.newTodoPriority());
    this.newTodoTitle.set('');
    this.newTodoPriority.set(0);
  }

  async toggleTodo(id: number): Promise<void> {
    await this.todoService.toggle(id);
  }

  async deleteTodo(id: number): Promise<void> {
    await this.todoService.delete(id);
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

  private listenForPwaUpdates(): void {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => {
        const ref = this.snackBar.open(
          'A new version is available',
          'Reload',
          { duration: 0 }
        );
        ref.onAction().subscribe(() => document.location.reload());
      });
  }

  private showMigrationNotification(): void {
    const result = this.sqlite.migrationResult();
    if (!result || result.applied.length === 0) return;

    const descriptions = result.applied
      .map((m) => `v${m.version}: ${m.description}`)
      .join(', ');

    this.snackBar.open(
      `Database updated (v${result.fromVersion} → v${result.toVersion}): ${descriptions}`,
      'OK',
      { duration: 8000 }
    );
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
