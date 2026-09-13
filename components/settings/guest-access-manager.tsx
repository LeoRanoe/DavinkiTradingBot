"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ManagedUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: "owner" | "guest";
  createdAt: string;
  lastSignInAt: string | null;
};

type Credential = { email: string; password: string };

export function GuestAccessManager() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credential, setCredential] = useState<Credential | null>(null);

  async function loadUsers() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load accounts.");
    setUsers(body.users);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/admin/users", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load accounts.");
        if (active) setUsers(body.users);
      })
      .catch((error) => toast.error(error.message))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function createGuest(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create guest.");
      setCredential(body.credential);
      setEmail("");
      setDisplayName("");
      await loadUsers();
      toast.success("Guest login created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create guest.");
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(userId: string) {
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const body = await response.json();
    if (!response.ok) return toast.error(body.error ?? "Could not reset password.");
    setCredential(body.credential);
    toast.success("A new guest password was generated.");
  }

  async function deleteGuest(user: ManagedUser) {
    if (!window.confirm(`Delete guest login ${user.email}? This signs them out permanently.`)) return;
    const response = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    const body = await response.json();
    if (!response.ok) return toast.error(body.error ?? "Could not delete guest.");
    setCredential(null);
    await loadUsers();
    toast.success("Guest login deleted.");
  }

  async function copyCredential() {
    if (!credential) return;
    await navigator.clipboard.writeText(`Email: ${credential.email}\nPassword: ${credential.password}`);
    toast.success("Credentials copied.");
  }

  return (
    <div className="space-y-6">
      {credential ? (
        <Alert>
          <KeyRound />
          <AlertTitle>Save these credentials now</AlertTitle>
          <AlertDescription className="mt-2 space-y-2">
            <p>This password is shown only once. Send it to the guest through a secure channel.</p>
            <div className="bg-muted rounded-md p-3 font-mono text-xs">
              <div>{credential.email}</div>
              <div>{credential.password}</div>
            </div>
            <Button size="sm" variant="outline" onClick={copyCredential}><Copy /> Copy credentials</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a guest login</CardTitle>
          <CardDescription>Guests can view the dashboard but cannot approve trades, change modes, or manage integrations.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createGuest} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="guest-email">Email</Label>
              <Input id="guest-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest-name">Display name</Label>
              <Input id="guest-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </div>
            <Button type="submit" disabled={saving}><Plus /> {saving ? "Creating..." : "Create guest"}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accounts</CardTitle>
          <CardDescription>Resetting a password immediately replaces the old guest password.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? <p className="text-muted-foreground text-sm">Loading accounts...</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Role</TableHead><TableHead>Last sign-in</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell><div className="font-medium">{user.displayName || user.email}</div>{user.displayName ? <div className="text-muted-foreground text-xs">{user.email}</div> : null}</TableCell>
                    <TableCell><Badge variant={user.role === "owner" ? "default" : "secondary"} className="capitalize">{user.role}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-sm">{user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString() : "Never"}</TableCell>
                    <TableCell className="text-right">
                      {user.role === "guest" ? <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => resetPassword(user.id)}><KeyRound /> Reset password</Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => deleteGuest(user)} aria-label={`Delete ${user.email}`}><Trash2 /></Button>
                      </div> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
