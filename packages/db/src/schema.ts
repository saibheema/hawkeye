import {
  pgTable, text, integer, boolean, bigint,
  jsonb, pgEnum, uniqueIndex, index,
} from 'drizzle-orm/pg-core';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const scriptStatusEnum = pgEnum('script_status', [
  'draft', 'review', 'approved', 'archived',
]);

export const runStatusEnum = pgEnum('run_status', [
  'running', 'success', 'failed',
]);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  orgId: text('org_id'),                          // nullable in POC, required enterprise
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  role: text('role').notNull().default('member'), // member | admin | auditor
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (t) => [uniqueIndex('users_email_idx').on(t.email)]);

// ─── Sessions (auth) ──────────────────────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
});

// ─── Scripts ──────────────────────────────────────────────────────────────────

export const scripts = pgTable('scripts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: text('org_id'),
  domain: text('domain').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  code: text('code').notNull(),
  prompt: text('prompt').notNull(),
  model: text('model').notNull(),
  status: scriptStatusEnum('status').notNull().default('draft'),
  enabled: boolean('enabled').notNull().default(true),
  autoRun: boolean('auto_run').notNull().default(false),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (t) => [index('scripts_domain_idx').on(t.domain), index('scripts_user_idx').on(t.userId)]);

// ─── Script Versions ──────────────────────────────────────────────────────────

export const scriptVersions = pgTable('script_versions', {
  id: text('id').primaryKey(),
  scriptId: text('script_id').notNull().references(() => scripts.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  code: text('code').notNull(),
  changedBy: text('changed_by').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// ─── Run History ──────────────────────────────────────────────────────────────

export const runHistory = pgTable('run_history', {
  id: text('id').primaryKey(),
  scriptId: text('script_id').notNull().references(() => scripts.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  status: runStatusEnum('status').notNull().default('running'),
  startedAt: bigint('started_at', { mode: 'number' }).notNull(),
  completedAt: bigint('completed_at', { mode: 'number' }),
  error: text('error'),
  screenshotPath: text('screenshot_path'),
  logs: jsonb('logs').$type<string[]>().notNull().default([]),
}, (t) => [index('runs_script_idx').on(t.scriptId)]);

// ─── API Catalog ──────────────────────────────────────────────────────────────

export const apiCatalog = pgTable('api_catalog', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  orgId: text('org_id'),
  domain: text('domain').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  baseUrl: text('base_url').notNull(),
  authType: text('auth_type').notNull().default('none'),
  callCount: integer('call_count').notNull().default(1),
  lastCalled: bigint('last_called', { mode: 'number' }).notNull(),
  requestSchema: jsonb('request_schema'),
  queryParams: jsonb('query_params').$type<Record<string, string>>().notNull().default({}),
}, (t) => [
  index('catalog_domain_idx').on(t.domain),
  uniqueIndex('catalog_unique_idx').on(t.userId, t.domain, t.method, t.path),
]);

// ─── DOM Registry ─────────────────────────────────────────────────────────────

export const domRegistry = pgTable('dom_registry', {
  id: text('id').primaryKey(),
  domain: text('domain').notNull(),
  selector: text('selector').notNull(),
  elementType: text('element_type').notNull(),
  lastSeen: bigint('last_seen', { mode: 'number' }).notNull(),
  isHealthy: boolean('is_healthy').notNull().default(true),
}, (t) => [index('dom_domain_idx').on(t.domain)]);

// ─── Conversations ────────────────────────────────────────────────────────────

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  domain: text('domain').notNull(),
  messages: jsonb('messages').$type<unknown[]>().notNull().default([]),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (t) => [uniqueIndex('conv_user_domain_idx').on(t.userId, t.domain)]);

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  orgId: text('org_id'),
  action: text('action').notNull(),   // script.create | script.run | script.inject
  domain: text('domain'),
  resourceId: text('resource_id'),
  payload: jsonb('payload'),
  ipAddress: text('ip_address'),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
}, (t) => [index('audit_user_idx').on(t.userId), index('audit_time_idx').on(t.timestamp)]);
