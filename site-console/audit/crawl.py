"""Site crawler: discovers pages via sitemaps + internal links, like Googlebot would."""
import json
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup
from requests.structures import CaseInsensitiveDict

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
           "Accept-Language": "en-US,en;q=0.9"}
SKIP_EXT = re.compile(r"\.(jpe?g|png|gif|webp|avif|svg|ico|pdf|zip|gz|mp4|mp3|webm|css|js|json|xml|txt|woff2?|ttf|eot|docx?|xlsx?|pptx?)$", re.I)
SOFT_404 = re.compile(r"\b(404|not found|page not found|doesn.t exist|no longer available)\b", re.I)
_browser_hosts = set()  # hosts whose firewall only admits real browsers
# JavaScript browser checks that pass by themselves after a few seconds (e.g. CleanTalk Anti-Crawler on WordPress).
CHALLENGE = re.compile(rb"Anti-Crawler Protection is checking your browser", re.I)
BLOCKED = [f"*.{ext}*" for ext in ("js", "css", "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "woff", "woff2", "ttf", "otf", "mp4", "webm", "mp3")]


def _blocked(status):
    return status in (401, 403, 429, 503)


class Resp:
    """The parts of requests.Response the crawler uses, for pages fetched through the browser."""
    def __init__(self, status_code, headers, content, url, history=()):
        self.status_code, self.headers, self.content, self.url = status_code, CaseInsensitiveDict(headers), content, url
        self.history = list(history)

    @property
    def text(self):
        return self.content.decode("utf-8", "replace")


class HttpFetcher:
    browser = False

    def __init__(self):
        self.s = requests.Session()
        self.s.headers.update(HEADERS)

    def get(self, url, timeout=15, allow_redirects=True):
        return self.s.get(url, timeout=timeout, allow_redirects=allow_redirects)

    def close(self):
        self.s.close()


class BrowserFetcher:
    """Fetches documents through headless Chrome, for sites whose firewall blocks every non-browser client.
    Only the HTML document loads (no images, external scripts or styles). Inline JavaScript runs, so a JavaScript
    browser check passes once, the way it would for a visitor. Not thread-safe."""
    browser = True

    def __init__(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        try:
            self._browser = self._pw.chromium.launch(headless=True)
            # Sub-resources blocked inside Chrome, so each fetch costs about one HTML download.
            ctx = self._browser.new_context(user_agent=UA, locale="en-US")
            self._page = ctx.new_page()
            cdp = ctx.new_cdp_session(self._page)
            cdp.send("Network.enable")
            cdp.send("Network.setBlockedURLs", {"urls": BLOCKED})
        except Exception:
            self._pw.stop()
            raise

    def get(self, url, timeout=15, allow_redirects=True):
        from playwright.sync_api import Error as PlaywrightError
        try:
            resp = self._page.goto(url, wait_until="commit", timeout=timeout * 1000)
            if resp is None:
                raise requests.ConnectionError("No response")
            if CHALLENGE.search(resp.body()) and self._pass_challenge():
                resp = self._page.goto(url, wait_until="commit", timeout=timeout * 1000) or resp
            hops, req = [], resp.request.redirected_from
            while req:
                hops.insert(0, req)
                req = req.redirected_from
            hop_status = lambda h: h.response().status if h.response() else 301
            if hops and not allow_redirects:
                nxt = hops[1].url if len(hops) > 1 else resp.url
                return Resp(hop_status(hops[0]), {"Location": nxt}, b"", url)
            return Resp(resp.status, resp.headers, resp.body(), resp.url, [Resp(hop_status(h), {}, b"", h.url) for h in hops])
        except PlaywrightError as e:
            raise requests.ConnectionError(str(e).splitlines()[0]) from None

    def _pass_challenge(self, wait=15):
        """Let a JavaScript browser check finish; True once the site serves real pages."""
        for _ in range(wait * 2):
            self._page.wait_for_timeout(500)
            try:
                if not CHALLENGE.search(self._page.content().encode()):
                    return True
            except Exception:  # mid-navigation while the check redirects
                pass
        return False

    def close(self):
        try:
            self._browser.close()
        finally:
            self._pw.stop()


def open_fetcher(url, log=lambda m: None):
    """Plain HTTP when the site allows it; a real browser when its firewall blocks automated requests."""
    host = urlparse(url).netloc
    http = HttpFetcher()
    if host not in _browser_hosts:
        try:
            # Some firewalls let the first request through and block the rest, so probe twice.
            if not any(_blocked(http.get(url).status_code) for _ in range(2)):
                return http
        except requests.RequestException:
            return http
    try:
        browser = BrowserFetcher()
    except Exception:  # Playwright or its Chromium isn't installed
        return http
    try:
        if _blocked(browser.get(url).status_code):
            browser.close()
            return http
    except Exception:
        browser.close()
        return http
    log("Site firewall blocks automated requests; crawling with a real browser")
    _browser_hosts.add(host)
    http.close()
    return browser


def normalize(url):
    p = urlparse(url)
    path = p.path or "/"
    return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", p.query, ""))


def _same_site(url, host):
    h = urlparse(url).netloc.lower()
    return h == host or h.removeprefix("www.") == host.removeprefix("www.")


def _fetch_sitemaps(fetcher, origin, robots_text, log):
    declared = [l.split(":", 1)[1].strip() for l in robots_text.splitlines() if l.lower().startswith("sitemap:")]
    queue = declared or [origin + "/sitemap.xml"]
    sitemaps, urls, seen = [], [], set()
    while queue and len(sitemaps) < 10 and len(urls) < 2000:
        sm_url = queue.pop(0)
        if sm_url in seen:
            continue
        seen.add(sm_url)
        entry = {"url": sm_url, "declaredInRobots": sm_url in declared, "status": None, "type": None, "urls": 0, "error": None}
        try:
            r = fetcher.get(sm_url, timeout=40)
            entry["status"] = r.status_code
            if r.status_code != 200:
                entry["error"] = f"HTTP {r.status_code}"
            else:
                root = ET.fromstring(r.content)
                locs = [e.text.strip() for e in root.iter() if e.tag.endswith("loc") and e.text]
                if root.tag.endswith("sitemapindex"):
                    entry["type"] = "Sitemap index"
                    queue.extend(locs)
                else:
                    entry["type"] = "Sitemap"
                    urls.extend(locs)
                entry["urls"] = len(locs)
        except ET.ParseError:
            entry["error"] = "Couldn't parse XML"
        except requests.RequestException as e:
            entry["error"] = type(e).__name__
        sitemaps.append(entry)
        log(f"Read sitemap {sm_url}")
    return sitemaps, urls


def _parse_page(url, r, host):
    soup = BeautifulSoup(r.text, "html.parser")
    robots_meta = " ".join(m.get("content", "") for m in soup.find_all("meta", attrs={"name": re.compile("^(robots|googlebot)$", re.I)}))
    canonical = soup.find("link", rel="canonical")
    canonical = normalize(urljoin(url, canonical["href"])) if canonical and canonical.get("href") else None
    title = soup.title.get_text(strip=True) if soup.title else ""
    desc = ((soup.find("meta", attrs={"name": "description"}) or {}).get("content") or "").strip()
    text_words = len(soup.get_text(" ", strip=True).split())

    internal, external = set(), set()
    for a in soup.find_all("a", href=True):
        if "nofollow" in (a.get("rel") or []):
            continue
        href = urljoin(r.url, a["href"].strip())
        if not href.startswith("http"):
            continue
        if _same_site(href, host):
            if not SKIP_EXT.search(urlparse(href).path):
                internal.add(normalize(href))
        else:
            external.add(urlparse(href).netloc.lower())

    ld = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
            items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
            for it in items:
                if isinstance(it, dict):
                    t = it.get("@type", "Unknown")
                    ld.append({"type": t if isinstance(t, str) else ",".join(t), "keys": sorted(it.keys())})
        except (ValueError, AttributeError):
            ld.append({"type": "Unparsable structured data", "keys": [], "invalid": True})

    imgs = soup.find_all("img")
    return {
        "title": title, "description": desc,
        "h1": [h.get_text(" ", strip=True)[:120] for h in soup.find_all("h1")][:3],
        "noindex": "noindex" in (robots_meta + " " + r.headers.get("X-Robots-Tag", "")).lower(),
        "canonical": canonical,
        "lang": soup.html.get("lang") if soup.html else None,
        "viewport": bool(soup.find("meta", attrs={"name": "viewport"})),
        "words": text_words,
        "imagesNoAlt": sum(1 for i in imgs if not i.get("alt")),
        "images": len(imgs),
        "structuredData": ld,
        "links": sorted(internal),
        "externalDomains": sorted(external),
        "soft404": bool(SOFT_404.search(title)) or (text_words < 40 and bool(SOFT_404.search(soup.get_text(" ", strip=True)[:500]))),
    }


def crawl(start_url, max_pages=50, workers=8, log=lambda m: None):
    start = normalize(start_url)
    p = urlparse(start)
    host, origin = p.netloc, f"{p.scheme}://{p.netloc}"
    fetcher = open_fetcher(start, log)
    try:
        return _crawl(fetcher, start, host, origin, max_pages, workers, log)
    finally:
        fetcher.close()


def _crawl(fetcher, start, host, origin, max_pages, workers, log):
    try:
        rb = fetcher.get(origin + "/robots.txt", timeout=10)
        robots_found = rb.status_code == 200 and "html" not in rb.headers.get("Content-Type", "")
        robots_text = rb.text if robots_found else ""
    except requests.RequestException:
        robots_text, robots_found = "", False
    rp = RobotFileParser()
    rp.parse(robots_text.splitlines())
    log("Fetched robots.txt" if robots_found else "No robots.txt found")

    sitemaps, sitemap_urls = _fetch_sitemaps(fetcher, origin, robots_text, log)
    in_sitemap = {normalize(u) for u in sitemap_urls}

    pages, depth = {}, {start: 0}
    # Two queues: links found while crawling come first; sitemap URLs fill every 4th slot.
    queue = [start]
    sm_queue = [normalize(u) for u in sitemap_urls if _same_site(u, host)]
    for u in sm_queue:
        depth.setdefault(u, 1)
    seen = set()

    def next_url():
        use_sitemap = sm_queue and (not queue or len(seen) % 4 == 3)
        return (sm_queue if use_sitemap else queue).pop(0)

    def fetch(url):
        rec = {"url": url, "depth": depth.get(url, 0), "inSitemap": url in in_sitemap, "crawledAt": int(time.time())}
        if not rp.can_fetch("*", url):
            return {**rec, "status": None, "blockedByRobots": True}
        try:
            t0 = time.time()
            r = fetcher.get(url, timeout=20, allow_redirects=False)
            rec.update(status=r.status_code, ms=round((time.time() - t0) * 1000), bytes=len(r.content),
                       contentType=r.headers.get("Content-Type", "").split(";")[0], https=url.startswith("https://"))
            if 300 <= r.status_code < 400:
                rec["redirectTo"] = normalize(urljoin(url, r.headers.get("Location", "")))
            elif r.status_code == 200 and "html" in rec["contentType"]:
                rec.update(_parse_page(url, r, host))
        except requests.RequestException as e:
            rec.update(status=0, error=type(e).__name__)
        return rec

    with ThreadPoolExecutor(max_workers=workers) as ex:
        fetch_all = (lambda urls: map(fetch, urls)) if fetcher.browser else (lambda urls: ex.map(fetch, urls))
        while (queue or sm_queue) and len(pages) < max_pages:
            batch = []
            while (queue or sm_queue) and len(batch) < workers and len(pages) + len(batch) < max_pages:
                if not queue and batch:
                    break  # wait for this batch's links before falling back to the sitemap
                u = next_url()
                if u not in seen:
                    seen.add(u)
                    batch.append(u)
            for rec in fetch_all(batch):
                pages[rec["url"]] = rec
                nxt = rec.get("links", []) + ([rec["redirectTo"]] if rec.get("redirectTo") and _same_site(rec["redirectTo"], host) else [])
                for link in nxt:
                    if link not in seen:
                        depth.setdefault(link, rec["depth"] + 1)
                        queue.append(link)
            log(f"Crawled {len(pages)} pages")

    discovered = [u for u in dict.fromkeys(queue + sm_queue) if u not in pages]
    return {
        "origin": origin, "start": start, "browserMode": fetcher.browser,
        "robots": {"found": robots_found, "text": robots_text[:5000]},
        "sitemaps": sitemaps,
        "pages": list(pages.values()),
        "discoveredNotCrawled": discovered[:500],
        "maxPages": max_pages,
    }
