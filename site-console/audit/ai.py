"""AI features: Gemini (Google, your own key) and Claude Haiku (Routeriva), both OpenAI-compatible."""
import json
import os
import re
from pathlib import Path

import requests

SEARCH_SYSTEM = """SEO strategist. Input: one site's crawled pages. No real Google data: all numbers are estimates.
JSON only:
{"keywords":[{"keyword","page":"input URL","intent":"informational|commercial|transactional|navigational",
"demand":"high|medium|low","competition":"high|medium|low","visibility":0-100}],
"suggestions":[{"type":"Title rewrite|Description rewrite|New keyword|Content|Internal linking","page":"input URL or new page",
"keyword","impact":"high|medium|low","title":"short action","current":"existing text or empty","suggested","why"}],
"questions":[{"question":"People-also-ask style","keyword","page":"input URL or new page","why"}]}
10 keywords, 5 suggestions (titles <60, descriptions <160 chars), 5 questions. "why" = a few words.
visibility = chance of Google page 1, from targeting, depth, internal links and competition."""

INSPECT_SYSTEM = """Search Console expert. Explain one URL's indexing status to a site owner, plainly. JSON only:
{"verdict":"1 sentence","explanation":"2-3 sentences","steps":["fixes in order, or empty"]}"""


class GatewayError(Exception):
    def __init__(self, status, message):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


def describe(e):
    """Error text including the root cause."""
    msg, cause = str(e), e.__cause__ or e.__context__
    while cause:
        if str(cause) and str(cause) not in msg:
            msg += f" ({type(cause).__name__}: {cause})"
        cause = cause.__cause__ or cause.__context__
    return msg[:500]


# Where each model runs: Gemini on Google with your own key; Claude Haiku on Routeriva (formerly Bay of Assets)
# with your sk- key. Both are OpenAI-compatible. Model names come from .env (GEMINI_MODEL, CLAUDE_MODEL).
PROVIDERS = {
    "google": {"name": "Gemini", "key": "GEMINI_API_KEY",
               "base": ("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")},
    "routeriva": {"name": "Routeriva", "key": "BOA_API_KEY",
                  "base": ("BOA_BASE_URL", "https://api.routeriva.com/v1")},
}
GOOGLE = "google/"
SETTINGS = Path(__file__).parent.parent / "data" / "settings.json"  # the model picked in the UI


def _provider(model):
    return "google" if model.startswith(GOOGLE) else "routeriva"


def _call(method, path, body=None, timeout=180, provider="google"):
    """Call an OpenAI-compatible API (Google or Routeriva) directly with requests."""
    cfg = PROVIDERS[provider]
    key = os.getenv(cfg["key"])
    if not key:
        raise GatewayError(0, f"{cfg['key']} not set in .env")
    base = os.getenv(*cfg["base"]).rstrip("/")
    r = requests.request(method, f"{base}{path}", json=body, timeout=timeout,
                         headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    if r.status_code >= 400:
        try:
            err = r.json()
            err = err[0] if isinstance(err, list) and err else err  # Google wraps errors in a list
            err = err.get("error", r.text)
            err = err.get("message", err) if isinstance(err, dict) else err
        except (ValueError, AttributeError):
            err = "service is down or unreachable" if "<html" in r.text[:500].lower() else r.text[:300]
        raise GatewayError(r.status_code, err)
    return r.json()


def gemini_model():
    return os.getenv("GEMINI_MODEL") or "gemini-2.5-flash"  # free-tier Flash


def claude_model():
    return os.getenv("CLAUDE_MODEL") or "claude-haiku-4-5"


def model_groups():
    """Model picker entries: Gemini (Google) and Claude (Routeriva), named by GEMINI_MODEL / CLAUDE_MODEL in .env."""
    return [{"label": "Gemini", "model": GOOGLE + gemini_model(), "name": gemini_model()},
            {"label": "Claude", "model": claude_model(), "name": f"{claude_model()} (Routeriva)"}]


def _chosen_model():
    try:
        return json.loads(SETTINGS.read_text()).get("model")
    except (OSError, ValueError):
        return None


def set_model(model):
    """Use this model for all AI calls from now on (kept across restarts)."""
    if model not in [g["model"] for g in model_groups()]:
        raise ValueError(f"{model} is not one of the models in the picker")
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS.write_text(json.dumps({"model": model}))


def active_model():
    chosen = _chosen_model()
    return chosen if chosen in [g["model"] for g in model_groups()] else GOOGLE + gemini_model()


def ai_enabled():
    return any(os.getenv(cfg["key"]) for cfg in PROVIDERS.values())


def _complete(model, messages, temperature, max_tokens):
    provider = _provider(model)
    if provider == "routeriva":
        body = {"model": model, "temperature": temperature, "max_tokens": max_tokens, "messages": messages}
        data = _call("POST", "/chat/completions", body, provider=provider)
        return data["choices"][0]["message"].get("content") or ""
    # Gemini "thinks" by default and those hidden tokens count toward max_tokens, cutting the JSON short.
    # Thinking off and JSON mode on: a complete answer in about half the tokens.
    body = {"model": model[len(GOOGLE):] if model.startswith(GOOGLE) else model, "temperature": temperature,
            "max_tokens": max_tokens, "messages": messages,
            "reasoning_effort": "none", "response_format": {"type": "json_object"}}
    try:
        data = _call("POST", "/chat/completions", body, provider=provider)
    except GatewayError as e:
        if e.status != 400 or not re.search(r"reasoning|thinking", str(e), re.I):
            raise
        body.pop("reasoning_effort")  # models that can't turn thinking off
        data = _call("POST", "/chat/completions", body, provider=provider)
    return data["choices"][0]["message"].get("content") or ""


def _chat(system, payload, temperature=0.2, max_tokens=800, model=None):
    model = model or active_model()
    cfg = PROVIDERS[_provider(model)]
    if not os.getenv(cfg["key"]):
        return {"error": f"{cfg['key']} not set in .env"}
    messages = [{"role": "system", "content": system},
                {"role": "user", "content": json.dumps(payload, default=str, separators=(",", ":"))[:20000]}]
    try:
        text = _complete(model, messages, temperature, max_tokens)
    except Exception as e:  # API/network errors shouldn't break the audit
        return {"error": f"{cfg['name']} request failed: {describe(e)}"}
    match = re.search(r"\{.*\}", text, re.S)
    try:
        return json.loads(match.group(0)) if match else {"error": "AI returned no JSON", "raw": text[:2000]}
    except json.JSONDecodeError:
        return {"error": "AI returned malformed JSON", "raw": text[:2000]}


def search_visibility(audit, model=None):
    pages = [p for p in audit["report"]["pages"] if p.get("indexable")]
    pages.sort(key=lambda p: (-p.get("inlinks", 0), p.get("depth", 0)))
    if not pages:
        start = next((p for p in audit["report"]["pages"] if p["url"] == audit["report"].get("start")), None) or (audit["report"]["pages"] or [None])[0]
        why = f"the start page returned HTTP {start['status']}" if start and start.get("status") and start["status"] != 200 else (
            f"the start page is not indexable ({start.get('reasonText')})" if start else "no pages could be crawled")
        hint = " The site's firewall probably blocked the crawler; check its security/bot settings." if start and start.get("status") in (401, 403, 429, 503) else ""
        return {"error": f"Nothing to analyze: {why}.{hint}"}
    payload = {"site": audit["site"], "pages": [
        {"url": p["url"], "title": p.get("title"), "description": (p.get("description") or "")[:200],
         "h1": (p.get("h1") or [])[:1], "words": p.get("words"), "internalLinksIn": p.get("inlinks"), "depth": p.get("depth")}
        for p in pages[:25]]}
    return _chat(SEARCH_SYSTEM, payload, temperature=0.3, max_tokens=4000, model=model)


# Crawl fields that matter for explaining indexing; the rest (structured data, referrer lists, timings) only cost tokens.
INSPECT_FIELDS = ["url", "status", "title", "description", "h1", "noindex", "canonical", "indexable", "reasonText",
                  "inSitemap", "soft404", "depth", "inlinks", "words", "https", "note", "liveChecks"]


def inspect(page, site):
    page = {k: page[k] for k in INSPECT_FIELDS if page.get(k) not in (None, "", [])}
    return _chat(INSPECT_SYSTEM, {"site": site, "url": page}, max_tokens=600)
