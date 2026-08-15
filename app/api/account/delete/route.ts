import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAMPAIGN_VIDEOS_BUCKET } from "@/lib/supabase/storage";
import { removeDomainFromProject } from "@/lib/vercel/client";
import { destroyImage } from "@/lib/cloudinary/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AdminClient = ReturnType<typeof createAdminClient>;
type OwnedWorkspace = { id: string; name: string; memberCount: number };
type CampaignAsset = { id: string; workspaceId: string };
type DomainAsset = { id: string; domain: string; workspaceId: string };
type SecretSource = { table: string; columns: string[]; optional?: boolean };

const SECRET_SOURCES: SecretSource[] = [
  { table: "meta_connections", columns: ["user_token_secret_id"] },
  { table: "meta_pages", columns: ["page_token_secret_id"] },
  { table: "tiktok_connections", columns: ["access_token_secret_id", "refresh_token_secret_id"] },
  // Some deployed environments have the TikTok Marketing schema described by the app, while the
  // migration is not present in this checkout. Inventory it when available without making account
  // deletion impossible in environments where the table genuinely does not exist.
  {
    table: "tiktok_ad_accounts",
    columns: ["access_token_secret_id", "refresh_token_secret_id"],
    optional: true,
  },
  { table: "youtube_connections", columns: ["access_token_secret_id", "refresh_token_secret_id"] },
  { table: "mail_connections", columns: ["access_token_secret_id", "refresh_token_secret_id"] },
  { table: "mail_provider_connections", columns: ["secret_id"] },
];

function isMissingOptionalTable(source: SecretSource, error: { code?: string } | null) {
  return source.optional && (error?.code === "42P01" || error?.code === "PGRST205");
}

async function loadOwnedWorkspaces(
  admin: AdminClient,
  userId: string
): Promise<{ workspaces: OwnedWorkspace[]; error: string | null }> {
  const {
    data: ownerships,
    error: ownershipError,
    count: ownershipCount,
  } = await admin
    .from("workspace_members")
    .select("workspace_id", { count: "exact" })
    .eq("user_id", userId)
    .eq("role", "owner");
  if (ownershipError) return { workspaces: [], error: ownershipError.message };
  if (ownershipCount !== (ownerships ?? []).length) {
    return { workspaces: [], error: "incomplete workspace ownership result" };
  }

  const workspaceIds = Array.from(
    new Set((ownerships ?? []).map((row) => row.workspace_id as string))
  );
  if (workspaceIds.length === 0) return { workspaces: [], error: null };

  const [workspaceResult, memberResult] = await Promise.all([
    admin.from("workspaces").select("id, name", { count: "exact" }).in("id", workspaceIds),
    admin
      .from("workspace_members")
      .select("workspace_id", { count: "exact" })
      .in("workspace_id", workspaceIds),
  ]);
  if (workspaceResult.error) return { workspaces: [], error: workspaceResult.error.message };
  if (memberResult.error) return { workspaces: [], error: memberResult.error.message };
  if (workspaceResult.count !== (workspaceResult.data ?? []).length) {
    return { workspaces: [], error: "incomplete workspace result" };
  }
  if (memberResult.count !== (memberResult.data ?? []).length) {
    return { workspaces: [], error: "incomplete workspace membership result" };
  }

  const names = new Map<string, string>();
  for (const row of workspaceResult.data ?? []) names.set(row.id as string, row.name as string);

  const memberCounts = new Map<string, number>();
  for (const row of memberResult.data ?? []) {
    const workspaceId = row.workspace_id as string;
    memberCounts.set(workspaceId, (memberCounts.get(workspaceId) ?? 0) + 1);
  }

  return {
    workspaces: workspaceIds.map((id) => ({
      id,
      name: names.get(id) ?? "Unnamed workspace",
      memberCount: memberCounts.get(id) ?? 0,
    })),
    error: null,
  };
}

function transferRequired(workspaces: OwnedWorkspace[]) {
  const names = workspaces.map((workspace) => `“${workspace.name}”`).join(", ");
  return NextResponse.json(
    {
      error: `Transfer ownership of ${names} before deleting your account. These workspaces still have other members.`,
      code: "workspace_transfer_required",
      workspaces,
    },
    { status: 409 }
  );
}

// Deletion follows workspace ownership, not created-by attribution:
//   * an owner must transfer every workspace that still has another member;
//   * sole-member owned workspaces are deleted as units by 0085's auth.users trigger;
//   * memberships in other workspaces disappear, while the rows this person created stay there.
//
// The route inventories only the sole-member workspaces before deletion. Once the database has
// atomically guarded/deleted the account, it removes those workspaces' non-database resources:
// Vault secrets, Storage objects, and verified Vercel domains. Nothing is ever selected for
// cleanup by user_id, because a connector or domain created for somebody else's workspace belongs
// to that workspace even after its creator leaves.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  const confirmEmail = typeof body.confirm_email === "string" ? body.confirm_email.trim() : "";

  if (!password) return NextResponse.json({ error: "Password required" }, { status: 400 });
  // Typing the address is a second, deliberate speed bump — the password alone is muscle memory.
  if (confirmEmail.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return NextResponse.json({ error: "The email you typed doesn't match this account" }, { status: 400 });
  }

  // Re-auth on a THROWAWAY client, never `supabase` (the request-scoped, cookie-writing one).
  // signInWithPassword rewrites session cookies on that client, so a wrong password there logs the
  // real user out mid-request. Checking a password must never end the session it is checking.
  const verifier = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: reauthError } = await verifier.auth.signInWithPassword({
    email: user.email ?? "",
    password,
  });
  if (reauthError) return NextResponse.json({ error: "Password is incorrect" }, { status: 403 });

  const admin = createAdminClient();

  // Fail closed if the schema migration has not landed. Without the attribution tombstone, a
  // hard auth deletion would still cascade shared workspace rows.
  const { data: attribution, error: attributionError } = await admin
    .from("account_attributions")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (attributionError || !attribution) {
    console.error("Account deletion attribution preflight failed", attributionError);
    return NextResponse.json(
      { error: "Account deletion is temporarily unavailable. Nothing was deleted." },
      { status: 503 }
    );
  }

  const ownedResult = await loadOwnedWorkspaces(admin, user.id);
  if (ownedResult.error) {
    console.error("Account deletion workspace preflight failed", ownedResult.error);
    return NextResponse.json(
      { error: "Could not verify workspace ownership. Nothing was deleted." },
      { status: 500 }
    );
  }

  const blockedWorkspaces = ownedResult.workspaces.filter((workspace) => workspace.memberCount > 1);
  if (blockedWorkspaces.length > 0) return transferRequired(blockedWorkspaces);

  const ownedWorkspaceIds = ownedResult.workspaces.map((workspace) => workspace.id);
  const secretWorkspaces = new Map<string, Set<string>>();
  let campaigns: CampaignAsset[] = [];
  let customDomains: DomainAsset[] = [];
  // Hosted images. Inventoried up front like everything else here: cloudinary_assets
  // cascades with its workspace, so after deletion there is nothing left to read.
  let cloudinaryAssets: { publicId: string; workspaceId: string }[] = [];

  // Inventory is read-only and must be complete before anything irreversible happens. An error in
  // any query aborts the deletion so an external secret/object cannot become undiscoverable.
  if (ownedWorkspaceIds.length > 0) {
    const [secretResults, campaignResult, domainResult, cloudinaryResult] = await Promise.all([
      Promise.all(
        SECRET_SOURCES.map(async (source) => ({
          source,
          result: await admin
            .from(source.table)
            .select(["workspace_id", ...source.columns].join(", "), { count: "exact" })
            .in("workspace_id", ownedWorkspaceIds),
        }))
      ),
      admin
        .from("campaigns")
        .select("id, workspace_id", { count: "exact" })
        .in("workspace_id", ownedWorkspaceIds),
      admin
        .from("custom_domains")
        .select("id, domain, status, workspace_id", { count: "exact" })
        .in("workspace_id", ownedWorkspaceIds),
      admin
        .from("cloudinary_assets")
        .select("public_id, workspace_id", { count: "exact" })
        .in("workspace_id", ownedWorkspaceIds),
    ]);

    const inventoryErrors: string[] = [];
    for (const { source, result } of secretResults) {
      if (result.error) {
        if (isMissingOptionalTable(source, result.error)) continue;
        inventoryErrors.push(`${source.table}: ${result.error.message}`);
        continue;
      }
      if (result.count !== (result.data ?? []).length) {
        inventoryErrors.push(`${source.table}: incomplete result`);
        continue;
      }
      for (const row of (result.data ?? []) as unknown as Record<string, unknown>[]) {
        const workspaceId = row.workspace_id;
        if (typeof workspaceId !== "string" || !workspaceId) {
          inventoryErrors.push(`${source.table}: missing workspace attribution`);
          continue;
        }
        for (const column of source.columns) {
          const secretId = row[column];
          if (typeof secretId !== "string" || !secretId) continue;
          const workspaces = secretWorkspaces.get(secretId) ?? new Set<string>();
          workspaces.add(workspaceId);
          secretWorkspaces.set(secretId, workspaces);
        }
      }
    }
    if (campaignResult.error) inventoryErrors.push(`campaigns: ${campaignResult.error.message}`);
    else if (campaignResult.count !== (campaignResult.data ?? []).length) {
      inventoryErrors.push("campaigns: incomplete result");
    }
    if (domainResult.error) inventoryErrors.push(`custom_domains: ${domainResult.error.message}`);
    else if (domainResult.count !== (domainResult.data ?? []).length) {
      inventoryErrors.push("custom_domains: incomplete result");
    }

    // Same fail-closed treatment as every other asset class: an unreadable inventory aborts the
    // deletion rather than proceeding and leaving images nobody can find afterwards.
    if (cloudinaryResult.error) {
      inventoryErrors.push(`cloudinary_assets: ${cloudinaryResult.error.message}`);
    } else if (cloudinaryResult.count !== (cloudinaryResult.data ?? []).length) {
      inventoryErrors.push("cloudinary_assets: incomplete result");
    }

    if (inventoryErrors.length > 0) {
      console.error("Account deletion asset inventory failed", inventoryErrors);
      return NextResponse.json(
        { error: "Could not safely inventory account assets. Nothing was deleted." },
        { status: 500 }
      );
    }

    campaigns = (campaignResult.data ?? []).map((campaign) => ({
      id: campaign.id as string,
      workspaceId: campaign.workspace_id as string,
    }));

    cloudinaryAssets = (cloudinaryResult.data ?? []).map((asset) => ({
      publicId: asset.public_id as string,
      workspaceId: asset.workspace_id as string,
    }));
    // Pending domains are already attached to the Vercel project: domain creation calls Vercel
    // before DNS verification. Inventory every row, not only verified ones, so deletion cannot
    // orphan a pending project-domain attachment.
    customDomains = (domainResult.data ?? []).map((domain) => ({
        id: domain.id as string,
        domain: domain.domain as string,
        workspaceId: domain.workspace_id as string,
      }));
  }

  // 0085's BEFORE DELETE trigger locks ownership, repeats the team-workspace guard, deletes each
  // sole-member owned workspace through workspace_id cascades, and tombstones creator attribution.
  // If any part fails, PostgreSQL rolls the whole delete back and no external resource was touched.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    // A member can be added after the friendly preflight. The trigger catches that race; reload so
    // the caller still gets the actionable transfer-ownership response when it happens.
    const currentOwned = await loadOwnedWorkspaces(admin, user.id);
    const newlyBlocked = currentOwned.workspaces.filter((workspace) => workspace.memberCount > 1);
    if (!currentOwned.error && newlyBlocked.length > 0) return transferRequired(newlyBlocked);

    console.error("Account deletion failed", deleteError);
    return NextResponse.json(
      { error: "Could not delete the account. Nothing was deleted." },
      { status: 500 }
    );
  }

  // Database deletion succeeded. External cleanup is best-effort from the retained inventory: a
  // third-party outage must not resurrect or block an otherwise-complete account deletion.
  const cleanupFailures: string[] = [];
  const deletedWorkspaceIds = new Set<string>();

  // Ownership could have been transferred away after the first inventory. The database trigger
  // correctly leaves that workspace intact, so re-read the original IDs and clean only those that
  // actually disappeared. Keeping workspace_id on every inventoried asset makes this check useful
  // instead of trusting a stale preflight snapshot.
  if (ownedWorkspaceIds.length > 0) {
    const survivingResult = await admin
      .from("workspaces")
      .select("id", { count: "exact" })
      .in("id", ownedWorkspaceIds);
    if (
      survivingResult.error ||
      survivingResult.count !== (survivingResult.data ?? []).length
    ) {
      console.error("Account deletion workspace cleanup verification failed", survivingResult.error);
      cleanupFailures.push("external cleanup skipped: workspace verification failed");
    } else {
      const survivingWorkspaceIds = new Set(
        (survivingResult.data ?? []).map((workspace) => workspace.id as string)
      );
      for (const workspaceId of ownedWorkspaceIds) {
        if (!survivingWorkspaceIds.has(workspaceId)) deletedWorkspaceIds.add(workspaceId);
      }
    }
  }

  // A connector can be moved after the inventory snapshot, and a Vault UUID can be referenced by
  // more than one row. Verify every candidate secret across every known secret-bearing column;
  // any incomplete query skips secret cleanup entirely rather than deleting a live credential.
  const candidateSecretIds = Array.from(secretWorkspaces.entries())
    .filter(([, workspaceIds]) =>
      Array.from(workspaceIds).every((workspaceId) => deletedWorkspaceIds.has(workspaceId))
    )
    .map(([secretId]) => secretId);

  if (candidateSecretIds.length > 0) {
    const referenceResults = await Promise.all(
      SECRET_SOURCES.flatMap((source) =>
        source.columns.map(async (column) => ({
          source,
          column,
          result: await admin
            .from(source.table)
            .select(column, { count: "exact" })
            .in(column, candidateSecretIds),
        }))
      )
    );
    const liveSecretIds = new Set<string>();
    let verificationFailed = false;
    for (const { source, column, result } of referenceResults) {
      if (result.error) {
        if (isMissingOptionalTable(source, result.error)) continue;
        verificationFailed = true;
        console.error(`Secret cleanup verification failed for ${source.table}.${column}`, result.error);
        continue;
      }
      if (result.count !== (result.data ?? []).length) {
        verificationFailed = true;
        console.error(`Secret cleanup verification was incomplete for ${source.table}.${column}`);
        continue;
      }
      for (const row of (result.data ?? []) as unknown as Record<string, unknown>[]) {
        const secretId = row[column];
        if (typeof secretId === "string") liveSecretIds.add(secretId);
      }
    }

    if (verificationFailed) {
      cleanupFailures.push("vault cleanup skipped: reference verification failed");
    } else {
      for (const secretId of candidateSecretIds) {
        if (liveSecretIds.has(secretId)) continue;
        const { error } = await admin.rpc("delete_oauth_secret", { p_secret_id: secretId });
        if (error) cleanupFailures.push("vault secret");
      }
    }
  }

  const candidateCampaignIds = campaigns
    .filter((campaign) => deletedWorkspaceIds.has(campaign.workspaceId))
    .map((campaign) => campaign.id);

  if (candidateCampaignIds.length > 0) {
    const liveCampaignResult = await admin
      .from("campaigns")
      .select("id", { count: "exact" })
      .in("id", candidateCampaignIds);
    if (
      liveCampaignResult.error ||
      liveCampaignResult.count !== (liveCampaignResult.data ?? []).length
    ) {
      console.error("Campaign storage cleanup verification failed", liveCampaignResult.error);
      cleanupFailures.push("storage cleanup skipped: campaign verification failed");
    } else {
      const liveCampaignIds = new Set(
        (liveCampaignResult.data ?? []).map((campaign) => campaign.id as string)
      );
      const deletedCampaignIds = candidateCampaignIds.filter((id) => !liveCampaignIds.has(id));
      const videoPaths = new Set(deletedCampaignIds.map((id) => `${id}.mp4`));
      for (const campaignId of deletedCampaignIds) {
        const { data: listed, error: listError } = await admin.storage
          .from(CAMPAIGN_VIDEOS_BUCKET)
          .list(campaignId);
        if (listError) {
          cleanupFailures.push(`storage folder ${campaignId}`);
          continue;
        }
        for (const object of listed ?? []) videoPaths.add(`${campaignId}/${object.name}`);
      }
      if (videoPaths.size > 0) {
        const { error: removeError } = await admin.storage
          .from(CAMPAIGN_VIDEOS_BUCKET)
          .remove(Array.from(videoPaths));
        if (removeError) cleanupFailures.push(`storage: ${removeError.message}`);
      }
    }
  }

  const candidateDomains = customDomains.filter((domain) =>
    deletedWorkspaceIds.has(domain.workspaceId)
  );
  if (candidateDomains.length > 0) {
    const [liveDomainIdResult, liveDomainNameResult] = await Promise.all([
      admin
        .from("custom_domains")
        .select("id", { count: "exact" })
        .in("id", candidateDomains.map((domain) => domain.id)),
      admin
        .from("custom_domains")
        .select("domain", { count: "exact" })
        .in("domain", candidateDomains.map((domain) => domain.domain)),
    ]);
    const domainVerificationFailed =
      Boolean(liveDomainIdResult.error) ||
      Boolean(liveDomainNameResult.error) ||
      liveDomainIdResult.count !== (liveDomainIdResult.data ?? []).length ||
      liveDomainNameResult.count !== (liveDomainNameResult.data ?? []).length;

    if (domainVerificationFailed) {
      console.error(
        "Domain cleanup verification failed",
        liveDomainIdResult.error ?? liveDomainNameResult.error
      );
      cleanupFailures.push("domain cleanup skipped: reference verification failed");
    } else {
      const liveDomainIds = new Set(
        (liveDomainIdResult.data ?? []).map((domain) => domain.id as string)
      );
      const liveDomainNames = new Set(
        (liveDomainNameResult.data ?? []).map((domain) => domain.domain as string)
      );
      for (const { id, domain } of candidateDomains) {
        if (liveDomainIds.has(id) || liveDomainNames.has(domain)) continue;
        try {
          await removeDomainFromProject(domain);
        } catch {
          cleanupFailures.push(`vercel ${domain}`);
        }
      }
    }
  }

  // Hosted images, for the workspaces that were actually deleted. Same rule as every other class
  // here: selected by WORKSPACE, never by user_id, because an image uploaded into somebody else's
  // workspace belongs to that workspace after this person leaves.
  //
  // No liveness re-check like domains and campaigns get: cloudinary_assets cascades with its
  // workspace, so "the workspace is gone" already means "no surviving row references this asset".
  // destroyImage treats an already-deleted id as success, so a partial previous run is safe to
  // repeat.
  const doomedAssets = cloudinaryAssets.filter((asset) => deletedWorkspaceIds.has(asset.workspaceId));
  for (const asset of doomedAssets) {
    try {
      await destroyImage(asset.publicId);
    } catch {
      cleanupFailures.push(`cloudinary ${asset.publicId}`);
    }
  }

  // Best-effort local sign-out; the account is gone either way, and its refresh token is invalid.
  await supabase.auth.signOut().catch(() => {});

  if (cleanupFailures.length > 0) {
    console.error("Account deleted with external cleanup failures", cleanupFailures);
  }

  return NextResponse.json({ ok: true, cleanupFailures });
}
