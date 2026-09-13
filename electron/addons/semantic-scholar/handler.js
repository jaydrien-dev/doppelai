/**
 * Semantic Scholar add-on — searches academic papers via the free public API.
 * No API key required. Returns titles, authors, years, abstracts, DOIs, and
 * citation counts.
 */

async function scholar_search(input) {
  const query = input.query;
  if (!query) return { error: true, text: "No search query given." };

  const limit = Math.min(input.limit ?? 10, 20);
  const url =
    `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}` +
    `&limit=${limit}&fields=title,authors,year,abstract,citationCount,url,externalIds`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Doppel/1.0 (desktop agent)" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: true, text: `Semantic Scholar ${res.status}: ${body.slice(0, 200)}` };
  }

  const data = await res.json();
  const papers = data.data ?? [];

  if (papers.length === 0) {
    return { text: `Academic search for "${query}":\n\nNo results found.` };
  }

  const formatted = papers.map((p, i) => {
    const authors = (p.authors ?? []).map((a) => a.name).join(", ");
    const doi = p.externalIds?.DOI ? `DOI: ${p.externalIds.DOI}` : "";
    const cited = p.citationCount != null ? `Cited by ${p.citationCount}` : "";
    const abstract = p.abstract ? p.abstract.slice(0, 300) : "";
    return [
      `${i + 1}. ${p.title ?? "Untitled"}`,
      `   ${authors}${p.year ? ` (${p.year})` : ""}`,
      p.url ? `   ${p.url}` : "",
      doi ? `   ${doi}` : "",
      cited ? `   ${cited}` : "",
      abstract ? `   ${abstract}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  return { text: `Academic search for "${query}":\n\n${formatted}` };
}

module.exports = { scholar_search };
