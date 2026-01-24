/**
 * Web tools for Research agent
 * Provides web search and fetch capabilities
 */

const MAX_CONTENT_SIZE = 50000; // 50KB limit for fetched content
const SEARCH_TIMEOUT = 10000; // 10 seconds
const FETCH_TIMEOUT = 15000; // 15 seconds

/**
 * Search the web using DuckDuckGo HTML API (no API key required)
 */
export async function webSearch(query: string): Promise<string> {
  if (!query || query.trim().length === 0) {
    throw new Error("Search query cannot be empty");
  }

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NemotronCLI/1.0; +https://github.com/nemotron-cli)",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    return parseSearchResults(html);
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Search timed out");
    }
    throw error;
  }
}

/**
 * Parse DuckDuckGo HTML search results
 */
function parseSearchResults(html: string): string {
  const results: { title: string; url: string; snippet: string }[] = [];

  // Match result blocks - DuckDuckGo uses <a class="result__a"> for titles
  const resultPattern =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/g;

  let match;
  while ((match = resultPattern.exec(html)) !== null && results.length < 10) {
    const [, url, title, snippet] = match;
    if (url && title) {
      results.push({
        title: decodeHtmlEntities(title.trim()),
        url: decodeUrl(url),
        snippet: decodeHtmlEntities(snippet?.trim() || ""),
      });
    }
  }

  // Fallback: try simpler pattern if no results
  if (results.length === 0) {
    const simplePattern = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
    while (
      (match = simplePattern.exec(html)) !== null &&
      results.length < 10
    ) {
      const [, url, title] = match;
      if (
        url &&
        title &&
        !url.includes("duckduckgo.com") &&
        title.trim().length > 10
      ) {
        results.push({
          title: decodeHtmlEntities(title.trim()),
          url: url,
          snippet: "",
        });
      }
    }
  }

  if (results.length === 0) {
    return "No search results found.";
  }

  return results
    .map(
      (r, i) =>
        `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet || "(no snippet)"}`
    )
    .join("\n\n");
}

/**
 * Fetch content from a URL and convert to readable text
 */
export async function webFetch(url: string): Promise<string> {
  if (!url || !url.startsWith("http")) {
    throw new Error("Invalid URL - must start with http:// or https://");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NemotronCLI/1.0; +https://github.com/nemotron-cli)",
        Accept: "text/html,application/xhtml+xml,text/plain,*/*",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const html = await response.text();

    // Convert HTML to readable text
    if (contentType.includes("text/html") || html.includes("<html")) {
      return htmlToText(html).slice(0, MAX_CONTENT_SIZE);
    }

    // Return plain text as-is
    return html.slice(0, MAX_CONTENT_SIZE);
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Fetch timed out");
    }
    throw error;
  }
}

/**
 * Convert HTML to readable text (simple implementation)
 */
function htmlToText(html: string): string {
  // Remove script and style tags
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");

  // Convert common elements to text
  text = text
    // Headers
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, "\n\n## $1\n\n")
    // Paragraphs
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
    // Line breaks
    .replace(/<br\s*\/?>/gi, "\n")
    // Links - keep href
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    // List items
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    // Bold/strong
    .replace(/<(b|strong)[^>]*>([\s\S]*?)<\/(b|strong)>/gi, "**$2**")
    // Italic/em
    .replace(/<(i|em)[^>]*>([\s\S]*?)<\/(i|em)>/gi, "_$2_")
    // Code
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    // Pre
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n")
    // Remove all other tags
    .replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Clean up whitespace
  text = text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  return text;
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

/**
 * Decode DuckDuckGo redirect URLs
 */
function decodeUrl(url: string): string {
  // DuckDuckGo wraps URLs in their redirect
  if (url.includes("uddg=")) {
    const match = url.match(/uddg=([^&]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return url;
}
