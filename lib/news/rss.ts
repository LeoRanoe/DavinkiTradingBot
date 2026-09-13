/**
 * Minimal, dependency-free RSS 2.0 / Atom parser.
 *
 * Deliberately not a general XML parser and deliberately not a new npm
 * dependency: we only need a handful of well-specified fields from feeds we
 * explicitly choose, and a tightly scoped parser is easier to reason about
 * (and to keep out of the supply chain) than a general one.
 *
 * It is also written to FAIL SOFTLY: one malformed entry is skipped, never
 * allowed to abort a whole feed.
 */

export type RawFeedItem = {
  title: string;
  link: string;
  publishedAt: string | null;
  description: string | null;
  id: string | null;
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

/** Strips CDATA wrappers, tags and collapses whitespace. */
export function cleanText(input: string | null): string {
  if (!input) return "";
  const withoutCdata = input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const withoutTags = withoutCdata.replace(/<[^>]*>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

function firstTag(block: string, ...names: string[]): string | null {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
    if (match) return match[1];
  }
  return null;
}

/** Atom links carry the URL in an href attribute rather than the element body. */
function atomLink(block: string): string | null {
  const alternate = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  if (alternate) return alternate[1];
  const plain = /<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  return plain ? plain[1] : null;
}

export function parseFeed(xml: string): RawFeedItem[] {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ];

  const items: RawFeedItem[] = [];
  for (const block of blocks) {
    try {
      const body = block[1];
      const title = cleanText(firstTag(body, "title"));
      const link = cleanText(firstTag(body, "link")) || atomLink(body) || "";
      if (!title || !link) continue; // an entry without these is unusable, skip it

      items.push({
        title,
        link: decodeEntities(link.trim()),
        publishedAt: cleanText(firstTag(body, "pubDate", "published", "updated", "dc:date")) || null,
        description: cleanText(firstTag(body, "description", "summary", "content")) || null,
        id: cleanText(firstTag(body, "guid", "id")) || null,
      });
    } catch {
      // One malformed entry never fails the feed.
      continue;
    }
  }
  return items;
}
