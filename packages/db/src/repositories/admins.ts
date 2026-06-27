import { eq } from "drizzle-orm";
import { db } from "../client";
import { admins } from "../schema";

export async function getAdminByEmail(email: string) {
  const [admin] = await db.select().from(admins).where(eq(admins.email, email.toLowerCase())).limit(1);
  return admin ?? null;
}

export async function getAdminById(id: string) {
  const [admin] = await db.select().from(admins).where(eq(admins.id, id)).limit(1);
  return admin ?? null;
}

export async function createAdmin(input: { email: string; passwordHash: string; role?: string }) {
  const [admin] = await db
    .insert(admins)
    .values({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      role: input.role ?? "admin"
    })
    .returning();
  return admin;
}
