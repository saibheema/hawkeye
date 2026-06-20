# Hawkeye — Project Plan

## Vision
Enterprise-grade AI browser intelligence platform. Users describe tasks in plain English.
Hawkeye autonomously reads the page (DOM + network traffic), generates JavaScript flows,
executes them with user approval, and persists everything to a team-shared library.

## POC Goals
Demonstrate two personas on https://www.avisford.com/service-appointment.aspx:
1. PM Flow  — prototype UI changes in natural language, save to library
2. QA Flow  — run multi-step form-fill + submit smoke test, view pass/fail history

## Tech Stack
- Extension: TypeScript, React 18, Tailwind, Vite + CRXJS (MV3)
- API:       Node.js 22, Fastify, Drizzle ORM, Zod, Lucia Auth
- Dashboard: Next.js 15, React, Tailwind
- DB:        PostgreSQL 16 (Docker local), Redis 7 (Docker local)
- LLM:       Gemini (default) — multi-model via LLMClient interface
- Monorepo:  Turborepo

## Monorepo Structure
hawkeye/
├── apps/
│   ├── extension/       Chrome MV3 extension
│   ├── api/             Fastify REST API
│   └── dashboard/       Next.js web dashboard
├── packages/
│   ├── types/           Shared TypeScript interfaces
│   └── db/              Drizzle schema + migrations
├── infra/               Docker, future K8s/Terraform
├── docker-compose.yml
└── PLAN.md

## Build Stages

### Stage 1 — Foundation (monorepo, types, DB schema, docker)
### Stage 2 — Fastify API (auth, scripts CRUD, run history, catalog)
### Stage 3 — Extension Core (service worker, network watcher, content scripts)
### Stage 4 — Agent Engine (agent loop, tools, multi-model LLM client)
### Stage 5 — React Side Panel (chat, task feed, script library, settings)
### Stage 6 — Web Dashboard (script list, run history, API catalog)
### Stage 7 — Demo Wiring (end-to-end test on avisford.com)

## Enterprise Architecture (built later, designed now)
- Every DB record has user_id + org_id from day one
- Auth abstracted behind AuthProvider interface (SSO/SAML ready)
- Script status field: draft → review → approved (review workflow ready)
- LLMClient interface (Gemini/Claude/GPT-4/Ollama swappable)
- Audit log table written on every mutation
- Docker Compose designed to be Helm-portable (GCP Cloud Run target)

## Demo Script
1. Navigate to avisford.com/service-appointment.aspx
2. PM Demo (3 min): "Add a blue 'Book Today' banner at the top"
   → Agent injects → save → visible in dashboard
3. QA Demo (5 min): "Fill this appointment form with test data and submit"
   → Agent steps through form → run history shows pass/fail
4. Close: "PM prototyped in 2 min. QA tested in 5 min. Zero code written."
