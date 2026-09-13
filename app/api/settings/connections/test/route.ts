import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { testQwenConnection } from "@/lib/qwen/client";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { isOwner } from "@/lib/auth/authorization";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const { integration } = await request.json();

  if (integration === "qwen") {
    const result = await testQwenConnection();
    return NextResponse.json(result);
  }
  if (integration === "telegram") {
    const result = await sendTelegramMessage("Test message from Davinki Trading settings.");
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "Unknown integration" }, { status: 400 });
}
