// The affiliate networks this app can track, and which of them it can build a tracking link for.
//
// ISOMORPHIC — the connections panel, the manual-add form and the renderer all read it, so it
// holds no secrets and imports nothing.
//
// Every URL shape below was PROBED live before being written (2026-08-17), because a tracking link
// that looks plausible and is wrong sends paid traffic to an unattributed page — you pay for the
// click and the network never records it, which is the most expensive kind of quiet failure.
//
// The probes also settled the shape of this module. Two findings:
//
//   * ShareASale now runs on Awin's infrastructure — shareasale.com/r.cfm redirected to
//     awin1.com/closedMerchant.html carrying b/u/m/afftrack through intact, which both confirms
//     the parameter names and explains why the two look alike.
//   * CJ and Impact links are NOT constructible. cj's /click-<pid>-<oid> shape routed to CJ's own
//     404, and Impact uses a per-brand vanity host (brand.pxf.io/<code>) — in both cases the link
//     id is ISSUED per advertiser and cannot be derived from an affiliate id. So they are supported
//     for tracking and kit generation, with products.hoplink_override (0064) carrying the real
//     link. That column already exists for exactly this.

export type NetworkId = "clickbank" | "digistore24" | "awin" | "shareasale" | "cj" | "impact";

export type NetworkInfo = {
  id: NetworkId;
  label: string;
  /** Can a link be built from (affiliateId, vendorId)? False = paste your own via the override. */
  constructsLink: boolean;
  /** What the network calls the affiliate's own id, in their UI. */
  affiliateIdLabel: string;
  /** What the network calls the merchant/product id. */
  vendorIdLabel: string;
  /** Shown under the field. Says where to find the value, or why a link must be pasted. */
  help: string;
  /** Live marketplace discovery. Only ClickBank has this today. */
  discovery: boolean;
};

export const NETWORKS: readonly NetworkInfo[] = [
  {
    id: "clickbank",
    label: "ClickBank",
    constructsLink: true,
    affiliateIdLabel: "Nickname",
    vendorIdLabel: "Vendor ID",
    help: "Your ClickBank account nickname — the value that appears in every hoplink.",
    discovery: true,
  },
  {
    id: "digistore24",
    label: "Digistore24",
    constructsLink: true,
    affiliateIdLabel: "Affiliate name",
    vendorIdLabel: "Product ID",
    help: "Your Digistore24 affiliate name, used in the /redir/ link path.",
    discovery: false,
  },
  {
    id: "awin",
    label: "Awin",
    constructsLink: true,
    affiliateIdLabel: "Publisher ID (awinaffid)",
    vendorIdLabel: "Advertiser ID (awinmid)",
    help: "Your numeric Awin publisher ID. Each product also needs its advertiser ID, which is the merchant you were approved for.",
    discovery: false,
  },
  {
    id: "shareasale",
    label: "ShareASale",
    constructsLink: true,
    affiliateIdLabel: "Affiliate ID",
    vendorIdLabel: "Merchant ID",
    help: "Your numeric ShareASale affiliate ID. Links use a generic text-link creative; if a merchant requires a specific banner, paste their link on the product instead.",
    discovery: false,
  },
  {
    id: "cj",
    label: "CJ Affiliate",
    constructsLink: false,
    affiliateIdLabel: "Publisher ID (PID)",
    vendorIdLabel: "Advertiser ID",
    help: "CJ issues a unique link per advertiser and creative, so it can't be built from your ID. Add the product, then paste CJ's own link as the tracking link.",
    discovery: false,
  },
  {
    id: "impact",
    label: "Impact",
    constructsLink: false,
    affiliateIdLabel: "Partner ID",
    vendorIdLabel: "Campaign ID",
    help: "Impact links live on a per-brand domain (brand.pxf.io/…), so they can't be built from your ID. Add the product, then paste Impact's own link as the tracking link.",
    discovery: false,
  },
] as const;

export function networkInfo(id: string): NetworkInfo | null {
  return NETWORKS.find((n) => n.id === id) ?? null;
}

export function networkLabel(id: string): string {
  return networkInfo(id)?.label ?? id;
}
