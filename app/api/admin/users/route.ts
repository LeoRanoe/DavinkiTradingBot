import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isOwner } from "@/lib/auth/authorization";
import { createClient } from "@/lib/supabase/server";

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

type ManagedUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: "owner" | "guest";
  created_at: string;
  last_sign_in_at: string | null;
};

function sanitizedUser(user: ManagedUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at,
  };
}

async function callOwnerRpc<T>(name: string, args?: Record<string, unknown>) {
  const supabase = await createClient();
  const client = supabase as unknown as {
    rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: T; error: { message: string } | null }>;
  };
  return client.rpc(name, args);
}

export async function GET() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const { data, error } = await callOwnerRpc<ManagedUser[]>("owner_list_auth_users");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ users: (data ?? []).map(sanitizedUser) });
}

export async function POST(request: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and a password of at least 12 characters." }, { status: 400 });

  const password = parsed.data.password ?? generatePassword();
  const { data, error } = await callOwnerRpc<ManagedUser[]>("owner_create_guest", {
    p_email: parsed.data.email,
    p_password: password,
    p_display_name: parsed.data.displayName || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const user = data?.[0];
  if (!user) return NextResponse.json({ error: "Guest account was not returned." }, { status: 500 });
  return NextResponse.json({ user: sanitizedUser(user), credential: { email: user.email, password } }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const parsed = resetSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid password reset request." }, { status: 400 });

  const password = parsed.data.password ?? generatePassword();
  const { data: email, error } = await callOwnerRpc<string>("owner_reset_guest_password", {
    p_user_id: parsed.data.userId,
    p_password: password,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ credential: { email, password } });
}

export async function DELETE(request: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const parsed = deleteSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid guest deletion request." }, { status: 400 });

  const { error } = await callOwnerRpc<string>("owner_delete_guest", { p_user_id: parsed.data.userId });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
