import { redirect } from "next/navigation";
import { GuestAccessManager } from "@/components/settings/guest-access-manager";
import { isOwner } from "@/lib/auth/authorization";
import { createClient } from "@/lib/supabase/server";

export default async function GuestAccessPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isOwner(user)) redirect("/dashboard");

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Guest access</h1>
        <p className="text-muted-foreground text-sm">Create and manage private, read-only dashboard logins. There is no public signup.</p>
      </div>
      <GuestAccessManager />
    </div>
  );
}
