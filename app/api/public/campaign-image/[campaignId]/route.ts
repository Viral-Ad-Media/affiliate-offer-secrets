import { servePublicCampaignImage } from "@/lib/publicPage";

export async function GET(req: Request, { params }: { params: { campaignId: string } }) {
  return servePublicCampaignImage(params.campaignId, req);
}
