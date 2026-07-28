import { servePublicCampaignPage } from "@/lib/publicPage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { campaignId: string } }) {
  return servePublicCampaignPage(params.campaignId);
}
