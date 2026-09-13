import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isOwner } from "@/lib/auth/authorization";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const createSchema = z.object({
  email: z.email().trim().toLowerCase(),
  displayName: z.string().trim().max(80).optional(),
  password: z.string().min(12).max(128).optional(),
});

const resetSchema = z.object({
  userId: z.uuid(),
  password: z.string().min(12).max(128).optional(),
});

const deleteSchema = z.object({ userId: z.uuid() });

function generatePassword(): string {
  return `Dv!${randomBytes(15).toString("base64url")}9a`;
}

async function requireOwner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && isOwner(user) ? user : null;
}

function sanitizedUser(user: {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}) {
  return {
    id: user.id,
    email: user.email ?? "",
    displayName: typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : null,
    role: user.app_metadata?.role === "owner" ? "owner" : "guest",
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}

export async function GET() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ users: data.users.map(sanitizedUser) });
}

export async function POST(request: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and a password of at least 12 characters." }, { status: 400 });

  const password = parsed.data.password ?? generatePassword();
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password,
    email_confirm: true,
    app_metadata: { role: "guest" },
    user_metadata: { display_name: parsed.data.displayName || undefined },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_events").insert({
    actor: owner.email ?? owner.id,
    action: "guest_created",
    metadata: { guest_user_id: data.user.id, guest_email: data.user.email },
  });

  return NextResponse.json({ user: sanitizedUser(data.user), credential: { email: data.user.email, password } }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const parsed = resetSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid password reset request." }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing, error: lookupError } = await admin.auth.admin.getUserById(parsed.data.userId);
  if (lookupError || !existing.user) return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  if (existing.user.app_metadata?.role === "owner") return NextResponse.json({ error: "The owner password cannot be reset here." }, { status: 400 });

  const password = parsed.data.password ?? generatePassword();
  const { data, error } = await admin.auth.admin.updateUserById(parsed.data.userId, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_events").insert({
    actor: owner.email ?? owner.id,
    action: "guest_password_reset",
    metadata: { guest_user_id: data.user.id, guest_email: data.user.email },
  });

  return NextResponse.json({ credential: { email: data.user.email, password } });
}

export async function DELETE(request: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const parsed = deleteSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid guest deletion request." }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing, error: lookupError } = await admin.auth.admin.getUserById(parsed.data.userId);
  if (lookupError || !existing.user) return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  if (existing.user.id === owner.id || existing.user.app_metadata?.role === "owner") {
    return NextResponse.json({ error: "The owner account cannot be deleted." }, { status: 400 });
  }

  const guestEmail = existing.user.email;
  const { error } = await admin.auth.admin.deleteUser(parsed.data.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_events").insert({
    actor: owner.email ?? owner.id,
    action: "guest_deleted",
    metadata: { guest_user_id: parsed.data.userId, guest_email: guestEmail },
  });

  return NextResponse.json({ ok: true });
}
