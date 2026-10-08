"""On-page SEO / crawlability checks, similar to Search Console & Lighthouse SEO."""
import json
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from . import crawl



def _check(results, id, title, ok, detail="", severity="warning", category="SEO"):
    results.append({
        "id": id, "title": title, "category": category, "detail": detail,
        "status": "pass" if ok else severity,
    })


def _head_status(url):
    try:
        r = requests.head(url, headers=crawl.HEADERS, timeout=8, allow_redirects=True)
        if r.status_code in (405, 403):
            r = requests.get(url, headers=crawl.HEADERS, timeout=8, stream=True)
        return url, r.status_code
    except requests.RequestException:
        return url, 0


def analyze(url):
    fetcher = crawl.open_fetcher(url)
    try:
        return _analyze(fetcher, url)
    finally:
        fetcher.close()


def _analyze(s, url):
    r = s.get(url, timeout=20, allow_redirects=True)
    soup = BeautifulSoup(r.text, "html.parser")
    final = r.url
    parsed = urlparse(final)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    checks = []

    # --- Indexing & crawl ---
    _check(checks, "status", "Page returns HTTP 200", r.status_code == 200, f"Status {r.status_code}", "error", "Indexing")
    _check(checks, "redirects", "Few redirects", len(r.history) <= 1,
           " → ".join([h.url for h in r.history] + [final]) if r.history else "No redirects", "warning", "Indexing")
    robots_meta = (soup.find("meta", attrs={"name": "robots"}) or {}).get("content", "")
    x_robots = r.headers.get("X-Robots-Tag", "")
    noindex = "noindex" in (robots_meta + x_robots).lower()
    _check(checks, "indexable", "Page is indexable", not noindex,
           f"robots: '{robots_meta or x_robots}'" if noindex else "No noindex directive", "error", "Indexing")

    try:
        rb = s.get(origin + "/robots.txt", timeout=10)
        robots_ok = rb.status_code == 200
        robots_txt = rb.text if robots_ok else ""
    except requests.RequestException:
        robots_ok, robots_txt = False, ""
    _check(checks, "robots", "robots.txt found", robots_ok, origin + "/robots.txt", "warning", "Indexing")
    blocks_all = any(line.strip().lower() == "disallow: /" for line in robots_txt.splitlines())
    if robots_ok:
        _check(checks, "robots-block", "robots.txt does not block everything", not blocks_all,
               "Contains 'Disallow: /'" if blocks_all else "OK", "error", "Indexing")

    sitemaps = [l.split(":", 1)[1].strip() for l in robots_txt.splitlines() if l.lower().startswith("sitemap:")]
    sitemap_url = sitemaps[0] if sitemaps else origin + "/sitemap.xml"
    sitemap_count = 0
    try:
        sm = s.get(sitemap_url, timeout=10)
        sitemap_ok = sm.status_code == 200 and ("<urlset" in sm.text or "<sitemapindex" in sm.text)
        sitemap_count = sm.text.count("<loc>") if sitemap_ok else 0
    except requests.RequestException:
        sitemap_ok = False
    _check(checks, "sitemap", "XML sitemap found", sitemap_ok,
           f"{sitemap_url} ({sitemap_count} URLs)" if sitemap_ok else f"Not found at {sitemap_url}", "warning", "Indexing")

    canonical = (soup.find("link", rel="canonical") or {}).get("href")
    _check(checks, "canonical", "Canonical URL set", bool(canonical), canonical or "Missing <link rel=canonical>")

    # --- On-page ---
    title = (soup.title.string or "").strip() if soup.title else ""
    _check(checks, "title", "Title tag present", bool(title), title or "Missing <title>", "error")
    if title:
        _check(checks, "title-len", "Title length 30–60 chars", 30 <= len(title) <= 60, f"{len(title)} chars")
    desc = ((soup.find("meta", attrs={"name": "description"}) or {}).get("content") or "").strip()
    _check(checks, "description", "Meta description present", bool(desc), desc[:160] or "Missing", "error")
    if desc:
        _check(checks, "desc-len", "Meta description 70–160 chars", 70 <= len(desc) <= 160, f"{len(desc)} chars")
    h1s = [h.get_text(" ", strip=True) for h in soup.find_all("h1")]
    _check(checks, "h1", "Exactly one H1", len(h1s) == 1, f"{len(h1s)} found: {h1s[:3]}")
    lang = (soup.html or {}).get("lang") if soup.html else None
    _check(checks, "lang", "<html lang> set", bool(lang), lang or "Missing")
    _check(checks, "viewport", "Mobile viewport meta tag", bool(soup.find("meta", attrs={"name": "viewport"})),
           "", "error", "Mobile")
    imgs = soup.find_all("img")
    no_alt = [i.get("src", "")[:120] for i in imgs if not i.get("alt")]
    _check(checks, "img-alt", "Images have alt text", not no_alt, f"{len(no_alt)}/{len(imgs)} missing alt", "warning", "Accessibility")
    og = {m.get("property"): m.get("content") for m in soup.find_all("meta", property=True) if m.get("property", "").startswith("og:")}
    _check(checks, "og", "Open Graph tags", "og:title" in og and "og:image" in og, ", ".join(og) or "None")
    ld = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
            for item in data if isinstance(data, list) else [data]:
                ld.append(item.get("@type", "?") if isinstance(item, dict) else "?")
        except (ValueError, AttributeError):
            ld.append("invalid")
    _check(checks, "structured-data", "Structured data (JSON-LD)", bool(ld) and "invalid" not in ld,
           ", ".join(map(str, ld)) or "None found", "warning", "Enhancements")

    # --- Security / delivery ---
    _check(checks, "https", "Served over HTTPS", parsed.scheme == "https", final, "error", "Security")
    _check(checks, "hsts", "HSTS header", "Strict-Transport-Security" in r.headers, "", "warning", "Security")
    enc = r.headers.get("Content-Encoding", "")
    _check(checks, "compression", "Text compression (gzip/br)", enc in ("gzip", "br", "zstd", "deflate"),
           enc or "None", "warning", "Performance")
    cc = r.headers.get("Cache-Control", "")
    _check(checks, "cache", "Cache-Control header", bool(cc), cc or "Missing", "warning", "Performance")
    html_kb = len(r.content) / 1024
    _check(checks, "html-size", "HTML under 200 KB", html_kb < 200, f"{html_kb:.0f} KB", "warning", "Performance")
    head_scripts = soup.head.find_all("script", src=True) if soup.head else []
    blocking = [sc["src"] for sc in head_scripts
                if not (sc.has_attr("async") or sc.has_attr("defer") or sc.get("type") == "module")]
    _check(checks, "render-blocking", "No render-blocking scripts in <head>", not blocking,
           f"{len(blocking)}: " + ", ".join(b[:80] for b in blocking[:5]) if blocking else "None", "warning", "Performance")

    # --- Links ---
    links = set()
    for a in soup.find_all("a", href=True):
        href = urljoin(final, a["href"]).split("#")[0]
        if href.startswith("http"):
            links.add(href)
    internal = [l for l in links if urlparse(l).netloc == parsed.netloc]
    external = [l for l in links if urlparse(l).netloc != parsed.netloc]
    sample = sorted(internal)[:25] + sorted(external)[:10]
    if s.browser:  # the firewall blocks plain requests to this site, so check its own links through the browser
        def own_status(u):
            try:
                return u, s.get(u, timeout=10).status_code
            except requests.RequestException:
                return u, 0
        sample = sorted(internal)[:6] + sorted(external)[:10]
        statuses = [own_status(u) for u in sorted(internal)[:6]]
        with ThreadPoolExecutor(max_workers=10) as ex:
            statuses += list(ex.map(_head_status, sorted(external)[:10]))
    else:
        with ThreadPoolExecutor(max_workers=10) as ex:
            statuses = list(ex.map(_head_status, sample))
    broken = [{"url": u, "status": c} for u, c in statuses if c == 0 or c >= 400]
    _check(checks, "broken-links", "No broken links (sampled)", not broken,
           f"{len(broken)} broken of {len(sample)} checked", "error", "Links")

    passed = sum(c["status"] == "pass" for c in checks)
    return {
        "finalUrl": final,
        "score": round(passed / len(checks) * 100),
        "checks": checks,
        "page": {"title": title, "description": desc, "h1": h1s[:5], "canonical": canonical,
                 "wordCount": len(soup.get_text(" ", strip=True).split()), "images": len(imgs),
                 "internalLinks": len(internal), "externalLinks": len(external), "structuredData": ld,
                 "sitemapUrls": sitemap_count},
        "brokenLinks": broken,
    }
