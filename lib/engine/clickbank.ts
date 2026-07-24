// ClickBank marketplace GraphQL discovery. Validated live: the endpoint returns clean data over
// a bare server-side POST as long as a realistic browser User-Agent is sent — the gate is a
// WAF/CDN rule keyed on UA, not a browser-session/CORS requirement. No API key, no browser needed.
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MARKETPLACE_QUERY = `
  query ($parameters: MarketplaceSearchParameters!) {
    marketplaceSearch(parameters: $parameters) {
      totalHits
      hits {
        site
        title
        description
        url
        marketplaceStats {
          category
          subCategory
          initialDollarsPerSale
          averageDollarsPerSale
          gravity
          totalRebill
          rebill
          upsell
        }
        affiliateToolsUrl
      }
    }
  }
`;

export type DiscoverPayload = {
  mode: "category" | "keyword";
  category?: string;
  subCategory?: string;
  keyword?: string;
  count: number;
};

export type MarketplaceHit = {
  site: string;
  title: string;
  description: string | null;
  url: string;
  marketplaceStats: {
    category: string | null;
    subCategory: string | null;
    initialDollarsPerSale: number | null;
    averageDollarsPerSale: number | null;
    gravity: number | null;
    totalRebill: number | null; // avg rebill $ amount
    rebill: boolean | null; // whether the product has recurring billing at all
    upsell: boolean | null;
  } | null;
  affiliateToolsUrl: string | null;
};

export async function searchMarketplace(payload: DiscoverPayload): Promise<MarketplaceHit[]> {
  const parameters: Record<string, unknown> = {
    sortField: "gravity",
    sortDescending: true,
    resultsPerPage: payload.count,
    offset: 0,
  };
  if (payload.mode === "keyword") {
    parameters.includeKeywords = payload.keyword;
  } else {
    parameters.category = payload.category;
    if (payload.subCategory) parameters.subCategory = payload.subCategory;
  }

  const res = await fetch("https://accounts.clickbank.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": BROWSER_UA,
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
    body: JSON.stringify({ query: MARKETPLACE_QUERY, variables: { parameters } }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`ClickBank marketplace fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`ClickBank GraphQL error: ${JSON.stringify(json.errors)}`);
  return (json.data?.marketplaceSearch?.hits ?? []) as MarketplaceHit[];
}
