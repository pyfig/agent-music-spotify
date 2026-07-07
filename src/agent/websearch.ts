// DuckDuckGo HTML web search — keyless research tool for the agent loop.
// Parses the html.duckduckgo.com/html/ results page with regex; no DOM deps.

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type WebSearchFn = (query: string, signal?: AbortSignal) => Promise<WebSearchResult[]>;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|nbsp|#x27|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** Unwrap DDG redirect links (`//duckduckgo.com/l/?uddg=<encoded>&...`). */
function unwrapUrl(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) {
    try {
      return decodeURIComponent(m[1]!);
    } catch {
      return href;
    }
  }
  return href;
}

/**
 * Parse the html.duckduckgo.com/html/ results markup. Pure function so it can
 * be tested against fixture HTML. Returns up to `limit` results; garbage input
 * yields an empty array rather than throwing.
 */
export function parseDuckDuckGoHtml(html: string, limit = 5): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const anchorRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/g;

  const snippets: string[] = [];
  for (let m = snippetRe.exec(html); m; m = snippetRe.exec(html)) {
    snippets.push(decodeEntities(stripTags(m[1]!)));
  }

  let i = 0;
  for (let m = anchorRe.exec(html); m && results.length < limit; m = anchorRe.exec(html), i++) {
    const url = unwrapUrl(decodeEntities(m[1]!));
    const title = decodeEntities(stripTags(m[2]!));
    if (!title || !url) continue;
    results.push({ title, url, snippet: snippets[i] ?? "" });
  }
  return results;
}

/**
 * Built-in web search via DuckDuckGo's HTML endpoint (no API key). GET only:
 * POST triggers DDG's anti-bot challenge (HTTP 202 with no results). Aborts on
 * the caller's signal or a 10s timeout, whichever fires first. Non-2xx throws;
 * the agent loop converts thrown errors into tool-result error text.
 */
export const duckDuckGoSearch: WebSearchFn = async (query, signal) => {
  const timeout = AbortSignal.timeout(10_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    signal: combined,
  });
  if (!res.ok) {
    throw new Error(`duckduckgo search failed: HTTP ${res.status}`);
  }
  return parseDuckDuckGoHtml(await res.text());
};
