# Site Console

A self-hosted, Google Search Console-style dashboard focused on **search visibility**. Give it a website and it:

1. **Crawls** the site (up to 50 pages by default), the way Googlebot would: sitemaps first, then internal links.
2. **Measures** each page: HTTP status, indexability, title, meta description, H1, canonical, word count, internal links.
3. **Asks an AI model** (Gemini or Claude) to estimate which keywords the site can rank for, how visible it is for
   each, and what to improve.
4. **Shows the results** in a React dashboard and keeps a history of every crawl.

> Keywords, visibility scores and recommendations are **AI estimates** based on page content. Real Google clicks and
> positions only exist in Google Search Console. The on-page ✓/✗ checks and the indexing data are **measured** from the
> crawl.

---

## Contents

- [Pages](#pages)
- [Quick start](#quick-start)
- [Configuration (`.env`)](#configuration-env)
- [AI models](#ai-models)
- [How a crawl works](#how-a-crawl-works)
- [Where data is stored](#where-data-is-stored)
- [Project structure](#project-structure)
- [API](#api)
- [Troubleshooting](#troubleshooting)

---

## Pages

| Page | What it shows |
|---|---|
| **Search performance** | Five tabs. **Keyword visibility**: each keyword with demand, competition, intent, a 0–100 visibility score, and measured ✓/✗ checks for whether the keyword appears in the page's title, H1, description and URL. **Top pages**: pages ranked by the visibility of their keywords. **Suggestions**: title/description rewrites (current vs suggested text), new keywords, content and internal-linking ideas. **Questions**: "People also ask"-style questions and the page that should answer each. **Search appearance**: Google result previews. |
| **URL inspection** | For any URL on the site: is it indexable and why, its keywords and recommendations, a **live test** of the page right now, and **Explain with AI** for a plain-language verdict and fix steps. |
| **History** | Average keyword visibility and indexable pages across all crawls of a site. |
| **Add property** | Enter a URL to crawl a new site (from the site dropdown in the sidebar). |

The **sidebar** has the site dropdown (top), the page links, and the **AI model** dropdown (bottom). The **Re-crawl**
button (top right) crawls the current site again.

---

## Quick start

### Requirements

- **Python 3.10+**
- **Node.js 20+** (only to build the web interface)
- At least one AI key: a free **Gemini** key, or a **Routeriva** key for Claude (see [AI models](#ai-models))

### 1. Install

```bash
cd site-console
pip install -r requirements.txt
python -m playwright install chromium   # needed for sites behind a bot firewall (see "How a crawl works")
```

### 2. Create `.env`

Copy the template and fill in your keys:

```bash
cp .env.example .env      # Windows (cmd): copy .env.example .env
```

`.env` then looks like this:

```ini
# Gemini (Google) - free key: https://aistudio.google.com/apikey
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-2.5-flash

# Claude through Routeriva (formerly Bay of Assets) - key from your Routeriva dashboard
BOA_API_KEY=sk-your-routeriva-key
BOA_BASE_URL=https://api.routeriva.com/v1
CLAUDE_MODEL=claude-haiku-4-5

# Optional
MAX_PAGES=50
```

You only need the key for the model you want to use. `.env` holds secrets: it's listed in `.gitignore`, so never
commit it or share it.

### 3. Build the web interface and start

```bash
cd web
npm install
npm run build        # builds the React app into web/dist
cd ..
python app.py        # starts the server
```

Open **http://127.0.0.1:5055**, choose **Add property**, enter a website and click crawl.

### Changing the code

- **Python changes** (`app.py`, `audit/*.py`) and **`.env` changes**: stop `python app.py` (Ctrl+C) and start it again.
- **Web interface changes** (`web/src`): run `npm run build` in `web/` again, then refresh the browser.
- **Live reload while developing the interface**: keep `python app.py` running and, in a second terminal, run
  `cd web && npm run dev`, then open http://localhost:5173 (it forwards `/api` calls to the Flask server).

---

## Configuration (`.env`)

| Setting | Required | Default | What it does |
|---|---|---|---|
| `GEMINI_API_KEY` | for Gemini | none | Your Google AI Studio key. Free at https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | no | `gemini-2.5-flash` | Which Gemini model to use. Shown in the dropdown. |
| `BOA_API_KEY` | for Claude | none | Your Routeriva key (starts with `sk-`). Old `boa-` keys are rejected. |
| `BOA_BASE_URL` | no | `https://api.routeriva.com/v1` | Routeriva's API address. |
| `CLAUDE_MODEL` | no | `claude-haiku-4-5` | Which Claude model to use on Routeriva. Shown in the dropdown. |
| `MAX_PAGES` | no | `50` | Maximum pages per crawl. More pages = longer crawls. |
| `PORT` | no | `5055` | Port the server listens on. |
| `GEMINI_BASE_URL` | no | Google's OpenAI-compatible endpoint | Only change this if you know you need to. |

Restart the server after editing `.env`.

---

## AI models

Pick the model in the **AI model** dropdown at the bottom of the sidebar. The choice is saved in `data/settings.json`
and used for every crawl and for **Explain with AI**.

| Dropdown entry | Runs on | Key | Cost |
|---|---|---|---|
| **Gemini · gemini-2.5-flash** | Google's Gemini API (direct) | `GEMINI_API_KEY` | Free tier available |
| **Claude · claude-haiku-4-5 (Routeriva)** | Routeriva, an AI gateway (formerly Bay of Assets) | `BOA_API_KEY` | Uses your Routeriva token balance |

**Changing a model:** edit `GEMINI_MODEL` or `CLAUDE_MODEL` in `.env` and restart. Use the exact model name the
service expects (for Routeriva, see the model list in your dashboard).

**Each model's analysis is stored separately.** If you crawl with Gemini and later switch to Claude, the page shows
"Run analysis with …" so you can analyze the same crawl with the other model, without crawling again. If a model's
analysis of a crawl fails, the page shows that model's latest working analysis from an earlier crawl of the same site.

**Errors never switch services.** If Claude fails, the app doesn't silently use Gemini (or the other way round); it
shows the error.

### Token use

To keep costs low, each analysis:

- sends at most **25 pages** (the most-linked ones), with title, description, first H1, word count, depth and inbound
  links: no page bodies;
- asks for **10 keywords, 5 suggestions and 5 questions**, with replies capped at **4,000 tokens**;
- uses short system prompts (in `audit/ai.py`).

**Explain with AI** sends only the fields needed to explain indexing for one URL, and its reply is capped at 600 tokens.

For Gemini, "thinking" is turned off and JSON mode is on. Without that, Gemini spends most of the token budget on
hidden reasoning and the answer gets cut off.

### Routeriva note

Routeriva only runs models for keys that are **bound to a routing group**. Trial accounts may not be able to set
one (saving a route fails with `permission denied for function can_use_route_group`). In that case every Claude
request returns *"Choose a route for this key"*. Only Routeriva can fix this, through their support or a paid plan.
Gemini is unaffected. See [Troubleshooting](#troubleshooting).

---

## How a crawl works

1. **Robots and sitemaps.** Reads `robots.txt` and every sitemap it lists (or `/sitemap.xml`).
2. **Pages.** Fetches pages from the sitemaps and follows internal links until it reaches `MAX_PAGES`.
3. **Checks.** Records status, indexability (and why not), title, description, H1, canonical, `noindex`, structured
   data, word count, depth, and inbound internal links for each page.
4. **Reports.** Groups pages into Search Console-style indexing reasons ("Excluded by noindex", "Page with redirect",
   and so on).
5. **AI analysis.** Sends the summary to the selected model (if AI is on), then measures whether each suggested keyword
   actually appears in the page's title, H1, description and URL (the ✓/✗ columns).
6. **Saved.** The crawl is written to `data/audits/` and added to the site's history.

### Sites behind a bot firewall

Some hosts and plugins (Hostinger, Cloudflare, CleanTalk "Anti-Crawler Protection", and others) block automated
requests. Site Console detects this (HTTP 401/403/429/503) and switches to **browser mode**: a headless Chrome that
fetches only each page's HTML.

- Browser mode runs the page's inline JavaScript, so JavaScript checks such as CleanTalk's *"checking your browser"*
  pass once at the start, as they would for a visitor.
- It needs Playwright and Chromium: `python -m playwright install chromium`.
- It's slower: about 1–2 s per page, plus 5–10 s for a browser check.

---

## Where data is stored

Everything is local, in `data/`:

| File | Contents |
|---|---|
| `data/audits/<id>.json` | One crawl: every page's data, the indexing report, and each model's AI analysis (under `searches`, keyed by model). |
| `data/history_<site>.json` | One entry per crawl of that site, for the History page and the site dropdown. |
| `data/settings.json` | The model selected in the dropdown. |

To start fresh, delete the files in `data/`. Use the **Export** button on any page to download a crawl as JSON.

---

## Project structure

```
site-console/
├── app.py              Flask server: API routes, crawl/analysis jobs, serves the built web app
├── audit/
│   ├── crawl.py        Crawler: robots.txt, sitemaps, link discovery, browser mode for firewalls
│   ├── reports.py      Turns crawl data into Search Console-style indexing reports
│   ├── seo.py          Live on-page checks for URL inspection
│   └── ai.py           AI calls: prompts, model dropdown, Gemini (Google) and Claude (Routeriva)
├── web/                React + Vite interface
│   ├── src/App.jsx           App shell, navigation, crawl/analysis progress
│   ├── src/components/       Sidebar (site and model dropdowns), shared UI pieces
│   ├── src/views/            Search performance, URL inspection, History, Add property
│   └── dist/                 Built app served by Flask (created by `npm run build`)
├── data/               Crawls, history and settings (created automatically)
├── requirements.txt    Python dependencies
└── .env                Your keys and settings (not committed)
```

---

## API

The web interface uses these endpoints; you can call them directly too.

| Method | Endpoint | Body | Returns |
|---|---|---|---|
| `POST` | `/api/audit` | `{"url": "...", "ai": true}` | `{"job": id}`: starts a crawl (+ AI analysis) |
| `POST` | `/api/analyze` | `{"auditId": "..."}` | `{"job": id}`: runs the AI analysis on an existing crawl with the selected model |
| `GET` | `/api/job/<id>` | | Progress; includes `auditId` when done |
| `GET` | `/api/audit/<id>` | | The crawl, every model's analysis, and the site history |
| `POST` | `/api/inspect` | `{"auditId", "url", "live": bool, "ai": bool}` | URL inspection, with optional live test and AI explanation |
| `GET` | `/api/sites` | | All crawled sites and their latest crawl |
| `GET` | `/api/config` | | Whether AI is on, the selected model, the page limit |
| `GET` | `/api/models` | | The dropdown's models and the selected one |
| `POST` | `/api/model` | `{"model": "..."}` | Switches the model used for AI analysis |

---

## Troubleshooting

| Message or symptom | Cause | Fix |
|---|---|---|
| `Choose a route for this key in Dashboard → API Keys` | Your Routeriva key isn't bound to a routing group. | In the Routeriva dashboard, set the key's route (API Keys → Key route, or Model routing). If saving fails with `can_use_route_group`, contact Routeriva support. Use Gemini meanwhile. |
| `Model '…' not configured` | That model isn't available to your key (trial keys only get standard models). | Set `CLAUDE_MODEL` to a model your key lists, e.g. `claude-haiku-4-5`. |
| `Old key format. Use your sk- key` | A `boa-` key from before Bay of Assets became Routeriva. | Copy the `sk-` key from your Routeriva dashboard into `BOA_API_KEY`. |
| `HTTP 522: service is down or unreachable` | The AI service's servers aren't responding. | Wait and try again, or switch models. |
| `GEMINI_API_KEY not set in .env` / `BOA_API_KEY not set in .env` | The key for the selected model is missing. | Add it to `.env` and restart the server. |
| `AI returned malformed JSON` | The reply was cut off before it finished. | Click **Try again**. If it keeps happening, raise `max_tokens` in `search_visibility()` in `audit/ai.py`. |
| `Nothing to analyze: the start page returned HTTP 403` | The site's firewall blocked the crawler. | Run `python -m playwright install chromium` so browser mode can work, then **Re-crawl**. |
| Changes to `.env` or Python code don't show up | The server is still running the old code. | Stop `python app.py` and start it again. On Windows, make sure no old `python app.py` window is still running. |
| Changes to the web interface don't show up | `web/dist` wasn't rebuilt. | Run `npm run build` in `web/`, then refresh the browser. |
| `The React app isn't built yet` | `web/dist` is missing. | Run `cd web && npm install && npm run build`. |
| Page doesn't load at http://127.0.0.1:5055 | The server isn't running, or the port is taken. | Start `python app.py`; or set a different `PORT` in `.env`. |
