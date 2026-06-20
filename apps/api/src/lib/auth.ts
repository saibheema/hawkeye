import { db, users, sessions } from '@hawkeye/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createHash } from 'crypto';

export function hashPassword(password: string): string {
  return createHash('sha256').update(password + 'hawkeye_salt').digest('hex');
}

export async function createUser(email: string, password: string, name?: string) {
  const id = nanoid();
  const now = Date.now();
  const [user] = await db.insert(users).values({
    id, email, name: name ?? null,
    passwordHash: hashPassword(password),
    createdAt: now, updatedAt: now,
  }).returning();
  return user;
}

export async function validateUser(email: string, password: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) return null;
  if (user.passwordHash !== hashPassword(password)) return null;
  return user;
}

export async function createSession(userId: string) {
  const id = nanoid(32);
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
  await db.insert(sessions).values({ id, userId, expiresAt });
  return id;
}
