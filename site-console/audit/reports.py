"""Turn crawl data into Search Console-style indexing data."""
from collections import defaultdict

# Search Console's "Why pages aren't indexed" reasons, with who usually has to fix them.
REASONS = {
    "noindex": ("Excluded by ‘noindex’ tag", "Website"),
    "redirect": ("Page with redirect", "Website"),
    "404": ("Not found (404)", "Website"),
    "4xx": ("Blocked due to other 4xx issue", "Website"),
    "5xx": ("Server error (5xx)", "Website"),
    "robots": ("Blocked by robots.txt", "Website"),
    "canonical": ("Alternate page with proper canonical tag", "Website"),
    "duplicate": ("Duplicate without user-selected canonical", "Website"),
    "soft404": ("Soft 404", "Website"),
    "fetch": ("Couldn't fetch (network error)", "Website"),
    "nonhtml": ("Not an HTML page", "Website"),
    "discovered": ("Discovered – currently not crawled", "Crawl limit"),
}

def classify(page):
    """Return (indexable, reason_key) for one crawled page."""
    if page.get("blockedByRobots"):
        return False, "robots"
    st = page.get("status")
    if not st:
        return False, "fetch"
    if 300 <= st < 400:
        return False, "redirect"
    if st == 404 or st == 410:
        return False, "404"
    if 400 <= st < 500:
        return False, "4xx"
    if st >= 500:
        return False, "5xx"
    if "html" not in (page.get("contentType") or ""):
        return False, "nonhtml"
    if page.get("noindex"):
        return False, "noindex"
    if page.get("canonical") and page["canonical"] != page["url"]:
        return False, "canonical"
    if page.get("soft404"):
        return False, "soft404"
    return True, None


def build(crawl):
    pages = crawl["pages"]
    by_url = {p["url"]: p for p in pages}

    # Inlinks
    inlinks = defaultdict(list)
    for p in pages:
        for l in p.get("links", []):
            if l != p["url"]:
                inlinks[l].append(p["url"])

    # Indexing status
    for p in pages:
        p["indexable"], p["reason"] = classify(p)
        p["inlinks"] = len(inlinks.get(p["url"], []))
        p["referrers"] = inlinks.get(p["url"], [])[:10]
    # Duplicates: same title+description, no canonical, keep the most-linked one
    groups = defaultdict(list)
    for p in pages:
        if p["indexable"] and not p.get("canonical") and p.get("title"):
            groups[(p["title"].strip().lower(), (p.get("description") or "").strip().lower())].append(p)
    for g in groups.values():
        if len(g) > 1:
            g.sort(key=lambda x: (-x["inlinks"], x["depth"]))
            for dup in g[1:]:
                dup["indexable"], dup["reason"], dup["duplicateOf"] = False, "duplicate", g[0]["url"]

    reasons = defaultdict(list)
    for p in pages:
        if not p["indexable"]:
            reasons[p["reason"]].append(p["url"])
    indexed = [p["url"] for p in pages if p["indexable"]]
    indexing = {
        "indexed": len(indexed),
        "notIndexed": sum(len(v) for v in reasons.values()),
        "reasons": sorted(
            [{"key": k, "reason": REASONS[k][0], "source": REASONS[k][1], "count": len(v), "urls": v[:200]} for k, v in reasons.items()],
            key=lambda r: -r["count"]),
        "indexedUrls": indexed,
        # URLs found but beyond the crawl limit: unknown status, so kept out of the not-indexed total.
        "discovered": len(crawl["discoveredNotCrawled"]),
        "discoveredUrls": crawl["discoveredNotCrawled"][:200],
        "crawlLimit": crawl["maxPages"],
    }

    # Slim page records for the client
    slim_keys = ("url", "status", "ms", "bytes", "contentType", "depth", "inSitemap", "redirectTo", "blockedByRobots", "error",
                 "title", "description", "h1", "noindex", "canonical", "lang", "viewport", "words", "images", "imagesNoAlt",
                 "structuredData", "https", "indexable", "reason", "inlinks", "referrers", "duplicateOf", "soft404", "crawledAt")
    slim = [{k: p[k] for k in slim_keys if k in p} for p in pages]
    for p in slim:
        p["reasonText"] = REASONS[p["reason"]][0] if p.get("reason") else None

    return {"indexing": indexing, "pages": slim, "start": crawl["start"]}
