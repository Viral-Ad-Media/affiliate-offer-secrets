import { servePublicCampaignImage } from "@/lib/publicPage";

export async function GET(_req: Request, { params }: { params: { campaignId: string } }) {
  return servePublicCampaignImage(params.campaignId);
}
