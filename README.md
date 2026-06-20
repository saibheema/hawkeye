# Hawkeye

Hawkeye is a Chrome extension that combines:

- Natural-language website actions in a side panel (powered by browser DOM tools)
- Flow recording from your real interactions
- Replay automation with repeat runs and test-data modes

This repository contains:

- `apps/extension`: Chrome MV3 extension
- `apps/api`: Fastify backend API
- `packages/db`: Drizzle schema and DB client
- `packages/types`: Shared TypeScript message and data contracts
- `apps/e2e`: Playwright end-to-end tests

## Features

### 1) Ask Hawkeye to modify pages
Use the side panel chat to ask for DOM changes. Hawkeye executes actions like:

- click, type_text, select_option
- replace_text and dom_op for temporary UI/content updates
- style changes via insert_css / set_style / set_css_var
- DOM reads for verification

### 2) Record + replay flows
Use the side panel to:

- record
- run your normal task on the page
- stop recording
- save and replay the flow multiple times
- choose **Same data** or **Random data** per run

Replay hardening includes:

- multi-locator capture for each recorded element
- selector self-healing when IDs or primary CSS selectors drift
- smart waits for dynamic UI and iframe rendering
- iframe-aware replay using recorded frame metadata
- failure diagnostics with URL, page text snippet, and stored screenshot key

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL (local or remote)
- Redis (optional, for local infra config)

## Quick start

```bash
# install all workspace deps
npm install

# build all packages
npm run build
```

### API service

1. create a local env file:

```bash
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env with real values
```

2. start API server:

```bash
npm run --workspace @hawkeye/api dev
```

### Extension

```bash
npm run --workspace @hawkeye/extension build
```

Load `apps/extension/dist` (or your built output location) in Chrome as an unpacked extension.

### E2E

```bash
npm test -w e2e
```

A live external-run test is included but skipped by default. Enable it with:

```bash
HAWKEYE_LIVE_AVISFORD=1 npx playwright test apps/e2e/tests/extension.spec.ts -c apps/e2e/playwright.config.ts -g "live Avis Ford"
```

## Environment files

- Put runtime values in `apps/api/.env`
- Do not commit `.env`
- Use `apps/api/.env.example` as a template

## Security before publishing

1. Never commit API keys, JWT secrets, or DB credentials
2. Keep `apps/api/.env` out of source control
3. Keep `dist/`, `node_modules/`, `.tmp/`, Playwright artifacts in `.gitignore`
4. Use a secret manager or deployment secrets in CI/CD for production values

## Useful scripts

```bash
npm run build                 # build all workspaces
npm run build -w @hawkeye/extension
npm run build -w @hawkeye/api
npm test -w e2e               # run Playwright test suite
```
