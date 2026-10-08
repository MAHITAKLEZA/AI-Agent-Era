"""Site Console — a self-hosted, Search Console-style dashboard
with keyword visibility analysis from Gemini."""
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request, send_from_directory

load_dotenv()

from audit import ai, crawl, reports, seo  # noqa: E402  (needs env loaded first)

DATA = Path(__file__).parent / "data"
(DATA / "audits").mkdir(parents=True, exist_ok=True)
MAX_PAGES = int(os.getenv("MAX_PAGES", 50))
WEB_DIST = Path(__file__).parent / "web" / "dist"  # the built React app (cd web && npm run build)
app = Flask(__name__, static_folder=None)
JOBS = {}


def _safe(fn, *args, **kw):
    try:
        return fn(*args, **kw)
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


def _history_file(host):
    return DATA / f"history_{host.replace(':', '_')}.json"


def _load_history(host):
    path = _history_file(host)
    return json.loads(path.read_text()) if path.exists() else []


STOP = {"a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "with", "how", "what", "is", "are", "vs", "best", "your", "you", "my", "do", "does", "can", "by", "at", "from"}


def _words(text):
    """Lower-case words with apostrophes dropped, so "Parkinson's" matches "parkinsons"."""
    return re.findall(r"[a-z0-9]+", re.sub(r"['’]", "", text.lower()))


def _coverage(keyword, page):
    """Measured on-page targeting: does each keyword term appear in the title, H1, description and URL?"""
    terms = [t for t in _words(keyword) if t not in STOP and len(t) > 1]
    fields = {"title": page.get("title") or "", "h1": " ".join(page.get("h1") or []),
              "description": page.get("description") or "", "url": page["url"]}
    if not terms:
        return {k: False for k in fields}

    def has(text):
        words = set(_words(text))
        stems = {w.rstrip("s") for w in words}
        return all(t in words or t.rstrip("s") in stems for t in terms)
    return {k: has(v) for k, v in fields.items()}


def _analyze(audit):
    """Run the AI search analysis with the active model and keep it next to other models' results."""
    model = ai.active_model()  # fixed at the start, so switching models mid-run can't mislabel the result
    search = _safe(ai.search_visibility, audit, model)
    search["model"] = model
    search["time"] = int(time.time())  # when this analysis ran (it can be later than the crawl)
    pages = {p["url"]: p for p in audit["report"]["pages"]}
    for k in search.get("keywords", []):
        if k.get("page") in pages:
            k["coverage"] = _coverage(k.get("keyword", ""), pages[k["page"]])
    audit.setdefault("searches", {})[model] = search
    audit["search"] = search


def _with_searches(audit):
    """Audits saved before per-model results keep their single analysis under the model that made it."""
    if "searches" not in audit:
        s = audit.get("search")
        audit["searches"] = {s["model"]: s} if s and s.get("model") else {}
    return audit


def run_audit(job, url, strategy, use_ai):
    def stage(name, progress):
        job.update(stage=name, progress=progress)

    started = time.time()
    host = urlparse(url).netloc
    stage("Crawling site", 0.05)
    site = crawl.crawl(url, MAX_PAGES, log=lambda m: job.update(detail=m, progress=min(0.6, job["progress"] + 0.04)))
    stage("Building reports", 0.65)
    audit = {"id": uuid.uuid4().hex[:12], "url": url, "site": host, "strategy": strategy, "time": int(started),
             "report": reports.build(site), "search": None}
    if use_ai:
        stage("AI analysis", 0.7)
        job["detail"] = "Estimating keyword visibility, suggestions and questions"
        _analyze(audit)
    audit["durationSec"] = round(time.time() - started, 1)

    (DATA / "audits" / f"{audit['id']}.json").write_text(json.dumps(audit))
    ix = audit["report"]["indexing"]
    kws = (audit["search"] or {}).get("keywords") or []
    history = _load_history(host)
    history.append({
        "id": audit["id"], "time": audit["time"], "url": url, "strategy": strategy, "v": 2,
        "indexed": ix["indexed"], "notIndexed": ix["notIndexed"], "pages": len(audit["report"]["pages"]),
        "keywords": len(kws) or None,
        "visibility": round(sum(float(k.get("visibility") or 0) for k in kws) / len(kws)) if kws else None,
    })
    _history_file(host).write_text(json.dumps(history[-200:]))
    job.update(status="done", progress=1, stage="Done", auditId=audit["id"])


def run_analysis(job, audit_id):
    """Analyze an existing crawl with the active model, without crawling again."""
    audit = _with_searches(_load_audit(audit_id))
    job.update(stage="AI analysis", progress=0.3, detail=f"Estimating keyword visibility with {ai.active_model()}")
    _analyze(audit)
    (DATA / "audits" / f"{audit_id}.json").write_text(json.dumps(audit))
    job.update(status="done", progress=1, stage="Done", auditId=audit_id)


def _job_thread(job, *args, target=None):
    try:
        (target or run_audit)(job, *args)
    except Exception as e:
        job.update(status="error", error=f"{type(e).__name__}: {e}")


@app.get("/")
@app.get("/<path:path>")
def web_app(path="index.html"):
    if path.startswith("api/"):
        abort(404)
    if not (WEB_DIST / "index.html").exists():
        return ("The React app isn't built yet. Run: cd web && npm install && npm run build", 503)
    return send_from_directory(WEB_DIST, path if (WEB_DIST / path).is_file() else "index.html")


@app.get("/api/config")
def api_config():
    return jsonify(aiEnabled=ai.ai_enabled(), model=ai.active_model(), maxPages=MAX_PAGES)


@app.post("/api/audit")
def api_audit():
    body = request.get_json(force=True)
    url = (body.get("url") or "").strip()
    if not url:
        return jsonify(error="URL required"), 400
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    if not urlparse(url).netloc:
        return jsonify(error="Invalid URL"), 400
    strategy = body.get("strategy") if body.get("strategy") in ("mobile", "desktop") else "mobile"
    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {"id": job_id, "status": "running", "stage": "Starting", "progress": 0, "detail": "", "url": url}
    threading.Thread(target=_job_thread, args=(JOBS[job_id], url, strategy, bool(body.get("ai", True))), daemon=True).start()
    return jsonify(job=job_id)


@app.post("/api/analyze")
def api_analyze():
    """Run the AI analysis on an existing crawl with the model chosen in the picker."""
    audit = _load_audit((request.get_json(force=True) or {}).get("auditId", ""))
    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {"id": job_id, "status": "running", "stage": "Starting", "progress": 0, "detail": "", "url": audit["url"]}
    threading.Thread(target=_job_thread, args=(JOBS[job_id], audit["id"]), kwargs={"target": run_analysis}, daemon=True).start()
    return jsonify(job=job_id)


@app.get("/api/job/<job_id>")
def api_job(job_id):
    job = JOBS.get(job_id)
    if not job:
        abort(404)
    return jsonify(job)


def _load_audit(audit_id):
    if not audit_id.isalnum():
        abort(404)
    path = DATA / "audits" / f"{audit_id}.json"
    if not path.exists():
        abort(404)
    return json.loads(path.read_text())


@app.get("/api/audit/<audit_id>")
def api_get_audit(audit_id):
    audit = _load_audit(audit_id)
    if "search" not in audit:
        abort(410)  # audit from an older version of the app
    audit["history"] = _load_history(audit["site"])
    audit = _with_searches(audit)
    audit["previous"] = _previous_analyses(audit)
    return jsonify(audit)


def _previous_analyses(audit):
    """For each model whose analysis of this crawl is missing or failed, its latest working analysis of an earlier
    crawl of the same site, so the page can show that instead of only an error."""
    ok = lambda s: s and not s.get("error") and s.get("keywords")
    found = {}
    for h in sorted(audit["history"], key=lambda h: -h["time"]):
        if h["id"] == audit["id"] or h["time"] > audit["time"]:
            continue
        path = DATA / "audits" / f"{h['id']}.json"
        if not path.exists():
            continue
        for model, s in _with_searches(json.loads(path.read_text())).get("searches", {}).items():
            if model not in found and ok(s) and not ok(audit["searches"].get(model)):
                found[model] = {**s, "fromAudit": h["id"], "fromCrawl": h["time"]}
    return found


@app.post("/api/inspect")
def api_inspect():
    """URL inspection: crawled data for the URL, plus an optional live test and AI explanation."""
    body = request.get_json(force=True)
    audit = _load_audit(body.get("auditId", ""))
    url = crawl.normalize((body.get("url") or "").strip())
    page = next((p for p in audit["report"]["pages"] if p["url"] == url), None)
    out = {"url": url, "page": page,
           "discovered": url in audit["report"]["indexing"]["discoveredUrls"]}
    if body.get("live"):
        out["live"] = _safe(seo.analyze, url)
    if body.get("ai"):
        subject = page or {"url": url, "note": "URL was not found in the crawl"}
        if out.get("live") and not out["live"].get("error"):
            subject = {**subject, "liveChecks": [c for c in out["live"]["checks"] if c["status"] != "pass"]}
        out["ai"] = _safe(ai.inspect, subject, audit["site"])
    return jsonify(out)


@app.get("/api/models")
def api_models():
    """Models in the picker (Gemini, Claude Haiku), and the one Site Console is using."""
    try:
        return jsonify(groups=ai.model_groups(), active=ai.active_model())
    except Exception as e:
        return jsonify(error=f"{type(e).__name__}: {ai.describe(e)}"), 502


@app.post("/api/model")
def api_set_model():
    """Switch the model used for AI analysis."""
    try:
        ai.set_model((request.get_json(force=True) or {}).get("model", ""))
    except ValueError as e:
        return jsonify(error=str(e)), 400
    except Exception as e:
        return jsonify(error=f"{type(e).__name__}: {ai.describe(e)}"), 502
    return jsonify(active=ai.active_model())


@app.get("/api/sites")
def api_sites():
    sites = []
    for f in DATA.glob("history_*.json"):
        hist = [h for h in json.loads(f.read_text()) if h.get("v") == 2]
        if hist:
            sites.append({"host": urlparse(hist[-1]["url"]).netloc, "latest": hist[-1], "audits": len(hist)})
    return jsonify(sorted(sites, key=lambda s: -s["latest"]["time"]))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", 5055)), debug=False, threaded=True)
