# Daylight

A full-stack task manager with private accounts, task lists, tags, deadlines, priorities, and Pending / In Progress / Completed status tracking. Built with React, TypeScript, Vite, Express, and SQLite.

## Run locally

Requires Node.js 24 or newer and npm.

```sh
npm ci
npm run dev
```

The web app runs on port 5173 and proxies API requests to port 3001. Each browser starts in its own guest workspace with sample tasks. Create an account to keep that workspace and sign in from another browser. Signing into an existing account opens that account's tasks; it does not merge the guest workspace.

## Build and serve

```sh
npm run build
npm start
```

The Express server serves both the built app and API on port 3001. SQLite data persists in `data/taskflow.sqlite`; keep this directory on a persistent volume when deploying. Back up the database using SQLite's backup facilities, or stop the server before copying the database and its WAL files together.

## Checks

```sh
npm test
npm run build
npm run test:e2e
```

The API tests use isolated databases and cover authentication, task CRUD, input validation, cross-user isolation, and persistence after restarting the server. Browser tests use a separate temporary database and exercise the real UI. They use `/usr/bin/chromium` when installed; otherwise run `npx playwright install chromium` first.

## Configuration

Set environment variables in your shell or hosting platform; `.env.example` documents defaults. `.env` files are not automatically loaded.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | API and production web server port |
| `DB_PATH` | `data/taskflow.sqlite` | Persistent SQLite file |
| `COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS |
| `APP_ORIGIN` | Same host | Optional comma-separated trusted browser origins for a reverse proxy |
| `NODE_ENV` | unset | Set to `production` for deployment |

Passwords are salted and hashed with scrypt. Sessions use random tokens in HttpOnly, SameSite cookies; only token hashes are stored in SQLite. API queries enforce ownership for every task. Mutating requests reject cross-site origins, and authentication endpoints have a per-process rate limit.

This version is suited to a single application instance. Before a public launch, configure HTTPS and persistent storage, and add the account recovery, email verification, distributed rate limiting, and guest-data retention policy appropriate to your deployment. Guest workspaces are accessible through their browser session for 30 days; creating an account gives them a reusable login.

## Project layout

- `src/`: responsive React interface, typed API client, task editor and authentication dialogs.
- `server/`: Express API, SQLite schema, authentication, and production static serving.
- `tests/`: API tests and browser workflow tests.

Each cloud task is already isolated. Use the existing checkout; a Git worktree is unnecessary unless explicitly requested.
