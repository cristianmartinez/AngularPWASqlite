# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun start          # Dev server at localhost:4200
bun run build      # Production build to dist/
bun test           # Run tests with Vitest
bun test -- --run  # Run tests once (no watch)
```

Build info is auto-generated via `prebuild`/`prestart` hooks.

## Architecture

Angular 21 PWA with client-side SQLite running entirely in the browser via sql.js (WASM).

### Data Flow

```
UI (signals) → TodoService → SqliteService → sql.js (in-memory) → Storage Backend
```

### Key Services

**SqliteService** (`src/app/services/sqlite.service.ts`)
- Wraps sql.js database with `exec()` and `query<T>()` methods
- Multi-backend persistence: OPFS → IndexedDB → memory (auto-fallback)
- Database loads entirely into memory on init, persists on `save()`
- Exposes reactive state via signals: `ready`, `error`, `activeBackend`

**Migrations** (`src/app/services/migrations.ts`)
- Version-based schema migrations using `PRAGMA user_version`
- Each migration runs in a transaction with automatic rollback on failure
- Add new migrations to `MIGRATIONS` array with incrementing version numbers

### Important Patterns

- **Standalone components** - no NgModules, imports declared per-component
- **Signals for state** - all reactive state uses Angular signals, not RxJS subjects
- **sql.js prebundle exclusion** - configured in angular.json to avoid Vite bundling issues

### PWA

Service worker enabled in production only. Update detection in `App.listenForPwaUpdates()` shows notification when new version available.

### Styling

Tailwind CSS 4 + Angular Material + SCSS. Component styles use `styleUrl` (singular).
