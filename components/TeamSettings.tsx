"use client";

import { useCallback, useEffect, useState } from "react";
import { Users, Loader2, Copy, Check, Trash2, Crown, Link2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Role = "owner" | "admin" | "member";

type Member = {
  user_id: string;
  role: Role;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  joined_at: string;
};

type Invitation = { id: string; email: string; role: "admin" | "member"; expires_at: string };

type Overview = {
  workspace: { id: string; name: string; slug: string };
  my_role: Role;
  members: Member[];
  invitations: Invitation[];
};

const ROLE_HELP: Record<Role, string> = {
  owner: "Billing, workspace settings, and can transfer ownership.",
  admin: "Invite and remove people, manage connections and domains.",
  member: "Create and edit campaigns, funnels, blog and emails.",
};

export default function TeamSettings({
  workspaceId,
  appUrl,
}: {
  workspaceId: string;
  appUrl: string;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data: d, error } = await createClient().rpc("get_workspace_overview", {
      p_workspace_id: workspaceId,
    });
    if (error) setErr(error.message);
    else setData(d as Overview);
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  // Supabase RPC builders are thenable but not Promises, so the callback is typed as
  // PromiseLike rather than Promise — awaiting it works identically.
  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key);
    setErr(null);
    const { error } = await fn();
    setBusy(null);
    if (error) setErr(error.message);
    else await load();
  }

  async function invite() {
    setBusy("invite");
    setErr(null);
    setInviteLink(null);
    const { data: token, error } = await createClient().rpc("invite_to_workspace", {
      p_workspace_id: workspaceId,
      p_email: inviteEmail,
      p_role: inviteRole,
    });
    setBusy(null);
    if (error) {
      setErr(error.message);
      return;
    }
    // No transactional email is wired for invitations yet, so the link is surfaced for the admin
    // to send however they like. That's deliberate over silently "sending" an email that never
    // arrives — and it works regardless of which mail provider the workspace has configured.
    setInviteLink(`${appUrl.replace(/\/$/, "")}/invite/${token}`);
    setInviteEmail("");
    await load();
  }

  if (err && !data) {
    return <p className="text-sm text-red-300">{err}</p>;
  }
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
      </p>
    );
  }

  const canManage = data.my_role === "owner" || data.my_role === "admin";
  const isOwner = data.my_role === "owner";
  const field =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500";

  return (
    <div className="space-y-6">
      <Card as="section" className="space-y-4 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Users className="h-4 w-4 text-emerald-400" /> Members
        </div>

        <div className="divide-y divide-ink-700 rounded-lg border border-ink-700">
          {data.members.map((m) => {
            const name = [m.first_name, m.last_name].filter(Boolean).join(" ").trim();
            return (
              <div key={m.user_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink-600 bg-ink-800 text-xs font-semibold text-zinc-400">
                  {m.avatar_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- data: URL */
                    <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (name || m.email)[0]?.toUpperCase()
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-200">{name || m.email}</div>
                  {name && <div className="truncate text-xs text-zinc-500">{m.email}</div>}
                </div>

                {m.role === "owner" ? (
                  <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                    <Crown className="mr-1 h-3 w-3" /> Owner
                  </Badge>
                ) : canManage ? (
                  <select
                    value={m.role}
                    disabled={busy === `role-${m.user_id}`}
                    onChange={(e) =>
                      run(`role-${m.user_id}`, () =>
                        createClient().rpc("set_workspace_member_role", {
                          p_workspace_id: workspaceId,
                          p_user_id: m.user_id,
                          p_role: e.target.value,
                        })
                      )
                    }
                    className="rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                ) : (
                  <Badge className="border-ink-600 bg-ink-800 text-zinc-400">{m.role}</Badge>
                )}

                {isOwner && m.role !== "owner" && (
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          `Make ${name || m.email} the owner? You'll become an admin and lose billing control.`
                        )
                      ) {
                        run(`transfer-${m.user_id}`, () =>
                          createClient().rpc("transfer_workspace_ownership", {
                            p_workspace_id: workspaceId,
                            p_user_id: m.user_id,
                          })
                        );
                      }
                    }}
                    className="rounded-lg border border-ink-600 px-2 py-1 text-xs text-zinc-400 hover:border-amber-500 hover:text-amber-300"
                  >
                    Make owner
                  </button>
                )}

                {m.role !== "owner" && (canManage || m.user_id === undefined) && (
                  <button
                    title="Remove from workspace"
                    onClick={() => {
                      if (window.confirm(`Remove ${name || m.email} from this workspace?`)) {
                        run(`remove-${m.user_id}`, () =>
                          createClient().rpc("remove_workspace_member", {
                            p_workspace_id: workspaceId,
                            p_user_id: m.user_id,
                          })
                        );
                      }
                    }}
                    className="rounded-lg p-1.5 text-zinc-500 hover:bg-ink-800 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-zinc-500">
          <span className="text-zinc-400">Owner</span> {ROLE_HELP.owner}{" "}
          <span className="text-zinc-400">Admin</span> {ROLE_HELP.admin}{" "}
          <span className="text-zinc-400">Member</span> {ROLE_HELP.member}
        </p>
      </Card>

      {canManage && (
        <Card as="section" className="space-y-3 p-5">
          <div className="text-sm font-semibold text-zinc-100">Invite someone</div>
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="their@email.com"
              className={`${field} min-w-0 flex-1`}
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
              className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <Button
              onClick={invite}
              disabled={busy === "invite" || !inviteEmail.trim()} className="disabled:opacity-50">
              {busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Invite
            </Button>
          </div>

          {inviteLink && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="flex items-center gap-2 text-xs text-emerald-300">
                <Link2 className="h-3.5 w-3.5" /> Send them this link — it expires in 14 days.
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-zinc-200">
                  {inviteLink}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(inviteLink);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="flex items-center gap-1 rounded-lg border border-ink-600 px-2 py-1.5 text-xs text-zinc-300 hover:border-emerald-500"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}

          {data.invitations.length > 0 && (
            <div className="divide-y divide-ink-700 rounded-lg border border-ink-700">
              {data.invitations.map((i) => (
                <div key={i.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-zinc-300">{i.email}</div>
                    <div className="text-xs text-zinc-500">
                      {i.role} · expires {new Date(i.expires_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      run(`revoke-${i.id}`, () =>
                        createClient().rpc("revoke_workspace_invitation", { p_invitation_id: i.id })
                      )
                    }
                    className="rounded-lg border border-ink-600 px-2 py-1 text-xs text-zinc-400 hover:border-red-500 hover:text-red-300"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {err && <p className="text-sm text-red-300">{err}</p>}
    </div>
  );
}
