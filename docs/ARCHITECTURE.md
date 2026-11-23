# Architecture – India CX-AI Job Tracker

Contracts and decisions. Types and zod schemas live in `server/src/types.ts`; when this
doc and that file disagree, the file wins and this doc gets fixed.

## 0. Overview

```
 web (Vite/React) ──/api (Vite proxy)──▶ Express on 127.0.0.1:3001
                                           │
        recipes: server/data/companies/*.json ──▶ refresh service ──▶ adapters ──▶ http client ──▶ ATS
        profile: server/data/profile.json      │  (normalize, score, upsert, close)
                                           ▼
                              SQLite server/data/jobs.sqlite
```

- **Files are the source of truth for configuration** (recipes, profile) and are git-tracked.
  **SQLite is the source of truth for data** (jobs, statuses, runs). The `companies` table is a
  mirror of the recipe files plus runtime state, so SQL can join and filter on it.
- One process. No queue, no scheduler, no cache layer, no LLM.
- Runtime dependencies (server): express, better-sqlite3, zod 4, cheerio (HTML adapters only).

## 1. Jobs: `FetchedJob` → `NormalizedJob`

Adapters return only what the listing gives (`FetchedJob`). One shared pipeline in
`refresh/normalize.ts` turns it into a `NormalizedJob`, so the twelve adapters don't each
repeat id hashing, date parsing, location parsing, snippet cleaning and scoring.

| Field | Rule |
|---|---|
| `id` | First 16 hex chars of `sha256(companySlug + "\n" + externalId)`. Slugs are immutable. |
| `externalId` | The ATS's own job ID (string). Jobs without one are dropped as invalid. |
| `title` | Trimmed, whitespace collapsed. Empty → invalid. |
| `url` | Absolute http(s). Adapters resolve relative paths. Not absolute → invalid. |
| `locationRaw` | As given; multiple locations joined with `" \| "`; `""` if unknown. |
| `cities`, `isIndia`, `isRemote` | `lib/location.ts` using `profile.cities`, `indiaTerms`, `remoteTerms`, `remoteRegionTerms` – rules in §11.6. `cities` holds canonical names (`Bengaluru`, not `Bangalore`), plus `"Remote"` when remote. If the recipe has `filters.indiaFiltered: true`, `isIndia = true` (covers Workday `"2 Locations"`). |
| `postedAt` | `lib/dates.ts` parses ISO, epoch (number < 1e11 = seconds, else ms), and English relative text (`"Posted 3 Days Ago"`, `"today"`, `"yesterday"`) against the fetch time. `"30+ days"` and anything else unparseable → `null`. Output is ISO UTC. |
| `descriptionSnippet` | `lib/text.ts`: strip HTML, decode entities, collapse whitespace, cut at 12 000 chars on a word boundary (whole postings; the UI shortens it for display). Taken from the listing, or from one detail request for jobs that qualify (§5 "Description requests"); otherwise `""`. |
| `firstSeenAt`, `lastSeenAt`, `closedAt` | See §6. |
| `relevanceScore`, `relevanceTier`, `matchedKeywords` | `scoring/relevance.ts`, deterministic from `profile.json` (§11). |

All timestamps are ISO 8601 UTC strings (`Date.prototype.toISOString()`), stored as TEXT.

**We store every fetched job, including non-India ones.** It keeps the closing logic simple
(the "seen" set = what was fetched), and a profile change to cities can re-classify stored
jobs without re-fetching. The UI and API default to `india=true`.

## 2. Company recipes

One file per company: `server/data/companies/<slug>.json`. File name must equal `slug`.
Schema: `CompanyRecipeSchema` in `types.ts`. Example:

```json
{
  "slug": "acme",
  "name": "Acme",
  "category": "cx-vendor",
  "careersUrl": "https://acme.example/careers",
  "ats": "workday",
  "fetch": {
    "url": "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs",
    "method": "POST",
    "headers": { "content-type": "application/json" },
    "body": { "appliedFacets": { "locationCountry": ["<id copied from a real request>"] }, "limit": 20, "offset": 0, "searchText": "" },
    "pagination": { "maxPages": 5, "sortedNewestFirst": false }
  },
  "filters": { "keywords": ["Dialogflow", "Conversational AI"], "indiaFiltered": true },
  "status": "verified",
  "verifiedOn": "2026-11-21"
}
```

### Fields

- `fetch.url` / `fetch.body` – the **real listing request**, copied from the browser or built
  only from tokens seen in a fetched page. Adapters override only their paging and keyword
  fields; everything else in the body (e.g. Workday location facets) is sent as written.
- `fetch.headers` – usually empty. Credential/session headers are rejected by the schema
  (`FORBIDDEN_HEADER_PATTERN`).
- `fetch.pagination` – `maxPages` (default 5, max 20) and `pageSize` apply to all paged
  adapters. `sortedNewestFirst` enables early stop (§3). `type`/`param`/`sizeParam`/`start`
  are for `generic` only; ATS-specific adapters know their own paging mechanics.
- `fieldMap` – `generic` only. Dot paths (`data.jobs`, `locations.0.name`) into the JSON
  response, same idea as the original `getValue` helper. `urlTemplate` like
  `https://x.com/jobs/{{id}}` substitutes dot paths from the job object.
- `filters.keywords` – sent to the ATS's search when it has one: **one query per keyword**
  (max 6), results merged and de-duplicated by `externalId`. `[]` = one unfiltered query.
  Generic recipes put `{{keyword}}` in `fetch.url` or `fetch.body`.
- `filters.location` – an ATS-native location value copied from a real request, for ATSs that
  take a location parameter (see table). Not a free-text guess.
- `filters.indiaFiltered` – the request already restricts to India.
- `manualSearchUrl` – careers search pre-filtered for India + a profile keyword.
- `verifiedOn`, `lastError` – written only by `verify:company` (CLI or API). Refresh errors go
  to SQLite, never into the file, so a refresh never edits git-tracked files.

### Status lifecycle

**Rule: a recipe is refreshed only after it has passed verify at least once.** That live
call proves the API integration works: the endpoint answers, the response parses, and the jobs
have an ID, a title and an absolute URL. The schema enforces it: `verified` and `broken`
(the only statuses refresh runs) both require `verifiedOn`.

| Status | Meaning | Refreshed? |
|---|---|---|
| `unverified` | Written (by researcher or UI), or its fetch settings were edited, and not yet proven by verify. | No |
| `verified` | Last verify returned ≥ 1 parseable job. Needs `verifiedOn`. | Yes |
| `broken` | Passed verify before (`verifiedOn` kept); the last verify failed. | Yes (so it can recover) |
| `needs-manual` | No working public endpoint. Needs `manualSearchUrl` + `notes`. | No |
| `disabled` | Turned off by the user. | No |

- Only verify sets `verified` (success) or `broken` (failure of a `verified`/`broken`
  recipe; a failing `unverified` recipe stays `unverified` with `lastError`). A failed verify
  keeps the old `verifiedOn`.
- `ats: "manual"` ⇒ no `fetch`, status `needs-manual` or `disabled`.
- The API never accepts `verified` from a client unless the stored recipe is already
  verified and `ats`, `fetch`, `fieldMap` and `filters` are unchanged (e.g. a notes edit).
  Any other change to those fields resets status to `unverified` and clears `verifiedOn`, so
  the edited integration must pass verify again. The client's `verifiedOn`/`lastError` are always
  ignored (rules in `recipes/write-rules.ts`): a new recipe cannot arrive `verified`/`broken`;
  **asking for `unverified` (the UI's "Enable" after "Disable") clears the proof**, and the UI then
  runs verify; disabling keeps the proof.
- UI "Add company": paste → preview → **Test** (dry-run verify) → **Save** writes the file as
  `unverified` and immediately runs a real verify, so a saved company that passed the test
  ends up `verified` in one click.

Job boards (LinkedIn, Naukri, Indeed, Glassdoor, Instahyre, Wellfound, Cutshort) are **not**
recipes. The UI builds prefilled search links from profile keywords + India.

## 3. Adapters

```ts
interface Adapter {
  ats: FetchableAts;
  fetchJobs(recipe: CompanyRecipe, ctx: FetchContext): AsyncGenerator<FetchedJob, FetchOutcome, undefined>;
  fetchDescription?(job: FetchedJob, recipe: CompanyRecipe, ctx: FetchContext): Promise<string>;
}
```

`fetchDescription` exists only on adapters whose listing has no description; it uses
`job.detailRef` (or `job.url`) to make one GET for that job. The refresh service decides when
to call it (§5).

`AsyncGenerator` is an `AsyncIterable` whose **return value** carries the `FetchOutcome`. The
refresh service drains it with `.next()` (not `for await`) to read that value.

`FetchContext` (see `types.ts`) gives the adapter: `http`, `signal`, effective `keywords`,
effective `maxPages`, `knownExternalIds`, `now`. Adapters read keywords and page caps **from
ctx, never from the recipe**, so verify/full/incremental modes need no branching in adapters.

### Shared paging helper (`adapters/paginate.ts`)

Each paged adapter supplies `fetchPage(query, pageIndex) → PageResult { jobs, hasMore }`.
The helper owns the rules, so no adapter re-implements them:

1. Run one query per keyword in `ctx.keywords` (or one with no keyword).
2. Per query, request pages until `hasMore` is false (`stopReason: "end"`) or `ctx.maxPages`
   pages were fetched (`"page-cap"`).
3. **Early stop:** only if `recipe.fetch.pagination.sortedNewestFirst` is true and
   `knownExternalIds` is non-empty – stop a query after the first page whose jobs are **all**
   known (`"known-ids"`). One reposted old job does not trigger it.
4. Yield jobs as pages arrive; de-duplicate by `externalId` across queries.
5. Return `{ complete, stopReason, pagesFetched }`; `complete` is true only if every query
   ended with `"end"`.

Single-call ATSs (greenhouse, ashby, workable) return everything in one response and always
return `complete: true`.

### Per-ATS notes (typical patterns – confirm each against a real fixture in Step 5)

| ATS | Listing request | Keyword | Location | Paging | Description in list? |
|---|---|---|---|---|---|
| greenhouse | `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | – | – | none | yes |
| lever | `GET api.lever.co/v0/postings/{site}?mode=json` | – | `location=` | `skip`/`limit` | yes |
| ashby | `GET api.ashbyhq.com/posting-api/job-board/{name}` | – | – | none | yes |
| smartrecruiters | `GET api.smartrecruiters.com/v1/companies/{id}/postings` | `q=` | `country=` | `offset`/`limit` | no → detail |
| workable | `GET apply.workable.com/api/v1/widget/accounts/{account}` | – | – | none | partial |
| workday | `POST {host}/wday/cxs/{tenant}/{site}/jobs` | `searchText` | facets in body | `offset`/`limit` (≤ 20) | no → detail |
| eightfold | `GET {host}/api/apply/v2/jobs?domain=…` | `query=` | `location=` | `start`/`num` | partial |
| oracle-hcm | `GET {host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber=…` | `keyword=` in finder | `locationId` in finder | `offset`/`limit` in finder | partial |
| successfactors | Career-site search page (HTML), e.g. `/search/?q=&locationsearch=` | `q=` | `locationsearch=` | `startrow` | no → detail |
| google-careers | Results page HTML with embedded JSON – **checked live 2026-11-21**, see below | `q=` | `location=India` | `page=` (20/page) | yes |
| generic | `fetch.url` + `fieldMap` | `{{keyword}}` | in url/body | `pagination.type` | via `fieldMap.description` |

ATSs without server-side keyword search ignore `ctx.keywords`; relevance scoring filters
instead. "partial" means a short summary only; Step 5 decides per ATS whether it is good
enough or the adapter also implements `fetchDescription`.

### google-careers (checked live on 2026-11-21)

- Request: `GET https://www.google.com/about/careers/applications/jobs/results?location=India&q=<keyword>&sort_by=date&page=<n>`
  (`page` starts at 1). Plain GET, no cookies, HTTP 200, about 1 MB of HTML per page.
- The page embeds the data in `AF_initDataCallback({key: 'ds:1', hash: '…', data: <JSON>, sideChannel: {}})`.
  `data[0]` = jobs on this page, `data[2]` = total matches, `data[3]` = page size (20). A
  query with no matches returns `[null, null, 0, 20]`.
- Each job is a positional array: `[0]` id, `[1]` title, `[3][1]` responsibilities HTML,
  `[4][1]` qualifications HTML, `[7]` company name (Google, YouTube, DeepMind, …), `[9]`
  locations as `[name, [address], city, zip, state, countryCode]`, `[10][1]` description
  HTML, `[12]`–`[14]` timestamps as `[epochSeconds, nanos]`. Step 5 picks which timestamp is
  "posted" by comparing with the date the site shows.
- Public job URL: `https://www.google.com/about/careers/applications/jobs/results/<id>`
  (returns 200; index `[2]` is a sign-in/apply link, don't use it).
- With `sort_by=date` the results came back newest first, so `sortedNewestFirst: true`.
- Positional arrays can change without notice: the adapter checks the shape and throws a
  clear error rather than yielding wrong fields. The "all jobs invalid → failed" rule (§5)
  catches silent breakage.

### Adapter notes (Step 5a, checked live on 2026-11-21)

- **workday** – `total` is only sent with the first page (0 afterwards), so the adapter remembers it
  per keyword. Page size ≤ 20. Job ID = `bulletFields[0]` (requisition ID), else `externalPath`.
  Public URL = `https://<host>/<site><externalPath>`. `fetchDescription` GETs
  `/wday/cxs/<tenant>/<site><externalPath>` (`jobPostingInfo.jobDescription`). Only `searchText`,
  `limit` and `offset` of the recipe body are overridden.
- **eightfold** – overrides `query`, `start`, `num` (max 10; larger values are rejected) and, when set,
  `location` from `filters.location`. The listing's `job_description` is empty, so
  `fetchDescription` GETs `/api/apply/v2/jobs/<id>?domain=…`. `t_create` = epoch seconds. Some tenants
  answer 403 `Not authorized for PCSX` (e.g. Starbucks) – those are `needs-manual`.
- **oracle-hcm** – limit, offset, keyword and `locationId` (= `filters.location`) are edited inside the
  raw `finder` text. The response's own `hasMore` describes the single search item, so paging uses
  `TotalJobsCount`. The URL needs `expand=requisitionList.secondaryLocations` (the adapter adds it
  if missing). The short summary (`ShortDescriptionStr`) is the description; no detail requests.
  Job URL = `<host>/hcmUI/CandidateExperience/en/sites/<siteNumber>/job/<Id>`.
- **successfactors** – parses `tr.data-row` rows (cheerio): `a.jobTitle-link`, `.jobLocation`
  (without its "+N more" marker). Job ID = the numeric last path segment. Total comes from
  "Results 1 – 25 of N"; `startrow` = rows received so far. No date in the listing (`postedAt`
  null); `fetchDescription` reads `itemprop="description"` from the job page. Some sites (e.g.
  jobs.sap.com) sit behind a Cloudflare challenge – those are `needs-manual`.
- **google-careers** – "posted" = `[12]` (creation time, epoch seconds), the earliest of the three
  timestamps; the page shows no date to compare with. Shape errors throw.
- **generic** – paging parameters: GET = query parameter names, POST = dot paths into the body.
  With `fieldMap.totalPath` it pages until the total; without one it pages until a short or empty page
  (bounded by the page cap). `{{keyword}}` is replaced with `""` when there are no keywords.
  Month-name dates ("November 16, 2026") are parsed by `lib/dates.ts`.

### Adapter notes (Step 5b, checked live on 2026-11-21)

- **lever** – `GET api.lever.co/v0/postings/<site>?mode=json`; adds `skip`/`limit` (default 100) and,
  when set, `location` from `filters.location`. Lever matches `location` **exactly against a posting's
  location name** ("Bangalore, Karnataka"), not a country, so `"India"` returns nothing; leave it empty
  unless the board has one India location name. Lever has no keyword search: `ctx.keywords` is ignored
  (one query, not one per keyword). Postings are not sorted by date: never set `sortedNewestFirst`.
  Description = `description` HTML + `lists`. `createdAt` (epoch ms) is the posted time. The text
  location often has no country, so `country: "IN"` appends "India" and `workplaceType: "remote"`
  appends "Remote". EU boards use `api.eu.lever.co` (put it in `fetch.url`).
- **ashby** – one GET, always complete; descriptions (`descriptionHtml`) are in the listing. No keyword
  or location parameters. Location = location name + secondary locations, each with the address country
  appended unless the name already has it. Jobs with `isListed: false` are skipped.
- **smartrecruiters** – `GET api.smartrecruiters.com/v1/companies/<id>/postings`; adds `q` (keyword),
  `country` (= `filters.location`, a lower-case ISO code such as `in`), `offset`, `limit` (max 100).
  Results come newest first, so `sortedNewestFirst: true` is right. The listing has no URL or
  description: URL = `https://jobs.smartrecruiters.com/<id>/<postingId>` (checked: 200), and
  `fetchDescription` GETs `<postings url>/<postingId>` (`jobAd.sections.jobDescription` +
  `qualifications`; the company boilerplate section is left out). `fullLocation` ("Hyderabad, , India") is
  cleaned of empty parts; `location.remote` appends "Remote".
- **workable** – the public widget API, `GET apply.workable.com/api/v1/widget/accounts/<account>`; one call,
  always complete. Use `?details=true` in `fetch.url` to get descriptions. No keyword or location
  parameters (a newer `POST /api/v3/accounts/<account>/jobs` has them but no descriptions; not used).
  Unknown accounts answer 200 with `{"jobs": []}`, so an empty result does not prove the account name is
  right. Location = each `locations[]` entry as "city, region, country", plus "Remote" when
  `telecommuting`. ID = `shortcode`; `published_on` is the posted date.
- Shared helpers in `adapters/shared.ts`: `withCountry`, `joinAddressParts`, `joinLocations`.

### Registry

`adapters/index.ts` exports an `AdapterRegistry` (`Partial<Record<FetchableAts, Adapter>>`;
all twelve fetchable ATSs now have an adapter). A recipe whose ATS has no adapter fails that company
only, with message `"no adapter for <ats>"`. Company specifics stay in recipe files; adapters
have no per-company branches.

## 4. SQLite schema

`db/migrations.ts` holds an ordered list of SQL strings; `PRAGMA user_version` records how many
ran. On open: `journal_mode = WAL`, `foreign_keys = ON`. Booleans are `0/1`, arrays are JSON
text, timestamps ISO text.

```sql
CREATE TABLE companies (
  slug              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,
  ats               TEXT NOT NULL,
  status            TEXT NOT NULL,          -- mirrored from the recipe file
  last_attempt_at   TEXT,
  first_success_at  TEXT,                   -- fetch time of the first successful fetch (baseline)
  last_success_at   TEXT,                   -- fetch time of the latest successful fetch
  last_refresh_error TEXT
);

CREATE TABLE jobs (
  id                  TEXT PRIMARY KEY,
  company_slug        TEXT NOT NULL REFERENCES companies(slug) ON DELETE CASCADE,
  external_id         TEXT NOT NULL,
  title               TEXT NOT NULL,
  url                 TEXT NOT NULL,
  location_raw        TEXT NOT NULL,
  cities_json         TEXT NOT NULL,        -- JSON array of canonical names
  is_india            INTEGER NOT NULL,
  is_remote           INTEGER NOT NULL,
  posted_at           TEXT,
  first_seen_at       TEXT NOT NULL,
  last_seen_at        TEXT NOT NULL,
  closed_at           TEXT,
  description_snippet TEXT NOT NULL,
  relevance_score     REAL NOT NULL,
  relevance_tier      TEXT NOT NULL CHECK (relevance_tier IN ('high','medium','low','none')),
  matched_keywords_json TEXT NOT NULL,
  UNIQUE (company_slug, external_id)
);
CREATE INDEX jobs_company_open ON jobs (company_slug, closed_at);
CREATE INDEX jobs_rank        ON jobs (relevance_tier, relevance_score DESC);
CREATE INDEX jobs_first_seen  ON jobs (first_seen_at);

CREATE TABLE job_status (
  job_id     TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  status     TEXT CHECK (status IN ('saved','applied','interviewing','rejected','ignored')),
  notes      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE refresh_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL CHECK (status IN ('running','finished','aborted')),
  company_slug TEXT,                        -- NULL = all companies
  full         INTEGER NOT NULL
);

CREATE TABLE refresh_company_results (
  run_id        INTEGER NOT NULL REFERENCES refresh_runs(id) ON DELETE CASCADE,
  company_slug  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ok','failed','skipped')),
  mode          TEXT NOT NULL CHECK (mode IN ('incremental','full')),
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  jobs_fetched  INTEGER NOT NULL DEFAULT 0,
  jobs_new      INTEGER NOT NULL DEFAULT 0,
  jobs_closed   INTEGER NOT NULL DEFAULT 0,
  jobs_invalid  INTEGER NOT NULL DEFAULT 0,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  details_fetched INTEGER NOT NULL DEFAULT 0,
  details_failed  INTEGER NOT NULL DEFAULT 0,
  stop_reason   TEXT,
  message       TEXT,
  PRIMARY KEY (run_id, company_slug)
);
```

- `job_status` is a separate table so refresh upserts never touch user data. No row = no
  status. A row may have `status NULL` with notes only.
- Run totals (`RefreshRunSummary.totals`) are computed from `refresh_company_results`, not stored.
- **Company sync:** `syncCompanies()` upserts one `companies` row per valid recipe file on
  server start, before each refresh, and after any recipe write. It never deletes rows, so a
  temporarily invalid file can't wipe jobs or statuses. Only `DELETE /api/companies/:slug`
  removes a company row (and, by cascade, its jobs), and only when none of its jobs has a
  status or notes (§7).
- On server start, runs still `running` are set to `aborted`.

## 5. Refresh flow

`refresh/service.ts` exposes `createRefreshService(deps).startRefresh({ company?, full })` →
`{ runId, invalidFiles, done }`, used by both the API and the CLI (`done` resolves with the run
summary). Only one run at a time; a second request throws `RefreshAlreadyRunningError` (the API
maps it to 409 with the active `runId`); an unknown company throws `UnknownCompanyError`. The
run starts one microtask after `startRefresh` returns, so callers can subscribe to events first.

```
startRefresh
 ├─ syncCompanies(); insert refresh_runs(status=running)
 ├─ pick companies: the one slug, or all with status in REFRESHABLE_STATUSES (verified, broken)
 │    others → result "skipped" with a reason (only when a single slug was requested)
 └─ run up to 4 companies concurrently; for each company:
      1. load + validate recipe; invalid → "failed"
      2. mode = full if requested, else incremental (no automatic full runs)
      3. fetchedAt = now (one timestamp for the whole company fetch)
      4. ctx = { http, signal: 120 s budget, keywords, maxPages,
                 knownExternalIds: incremental ? open external IDs : ∅, now: fetchedAt }
      5. drain adapter into memory; dedupe by externalId; drop and count invalid jobs
      6. if raw jobs > 0 and all invalid → "failed" (parser is broken)
      7. description requests for qualifying jobs (below)
      8. normalize (location, dates, snippet, score)
      9. ONE transaction: upsert jobs, close unseen (§6), update companies row,
         insert refresh_company_results(status=ok)
      on any error: no job writes (transaction not started or rolled back);
                    write result "failed" + companies.last_refresh_error, last_attempt_at
      emit company-started / company-finished events
 └─ set refresh_runs finished; emit run-finished
```

### Description requests

For ATSs whose listing has no description (adapter has `fetchDescription`), the service makes
one extra GET per job, only when **all** of these hold:

1. The listing's `description` is `""`.
2. The job's location parses as India (or the recipe has `indiaFiltered`).
3. The title matches a core keyword or alias – `titleMatchesCore(title, profile)` from
   `scoring/relevance.ts`, the same matcher scoring uses.
4. The job is not already stored with a non-empty snippet (so each job costs at most one
   detail request over its lifetime).

At most 20 detail requests per company per run (`config.ts`); the rest are picked up on the
next refresh. A failed detail request is counted in `detailsFailed` and the job is kept and
scored on title only; it never fails the company. After a profile change, newly matching
titles get their description on the next refresh (re-scoring itself never fetches).

- **Isolation:** each company runs in its own try/catch with its own abort signal; a failure is
  recorded and the run continues. Jobs are buffered and written in one transaction, so a failed
  fetch never leaves partial data.
- **Concurrency:** 4 companies in parallel is safe because the rate limit is per host and
  better-sqlite3 writes are synchronous.

### HTTP client (`lib/http.ts`)

- One process-wide instance. Per-hostname limiter: at most one request **start** per 1000 ms
  per host (a promise chain per host). Retries count as requests.
- Timeout 15 s per attempt (`AbortSignal.timeout`, combined with the company signal).
- 2 retries (3 attempts) on network errors, timeouts, 429 and 5xx; backoff 1 s then 3 s, plus
  up to 250 ms jitter; honour `Retry-After` up to 10 s. No retry on other 4xx.
- Non-2xx after retries throws `HttpError { status, url }`. Responses over 5 MB fail.
- Fixed browser-like `User-Agent` with a `india-cx-ai-job-tracker` suffix; `Accept` set per
  request. No cookie jar, never sends cookies.
- Tests inject a fake `HttpClient`; no test touches the network.

### Progress via Server-Sent Events

`GET /api/refresh/:runId/events` (`text/event-stream`):

1. On connect, send `snapshot` with the run, all company results so far (**read from SQLite**) and
   `running` (the companies that started but have not finished, from the service's in-memory set,
   empty for an ended run). This handles page reloads and late subscribers with no replay buffer.
2. If the run is still running, forward live `company-started`, `company-finished` and
   `run-finished` events from an in-process `EventEmitter`.
3. After `run-finished` (or immediately, if the run had already ended) the server closes the
   stream.
4. A `: ping` comment every 15 s keeps the connection open.

Format: `event: <type>\ndata: <JSON RefreshEvent>\n\n`. The web client uses `EventSource`.

## 6. New and closed jobs

Per company, per successful fetch with timestamp `fetchedAt`:

- **Insert** unseen `(company_slug, external_id)`: `first_seen_at = last_seen_at = fetchedAt`.
- **Update** seen jobs: listing fields, location, snippet, score; `last_seen_at = fetchedAt`;
  `closed_at = NULL` (a reappearing job reopens; it keeps its original `first_seen_at`).
  `posted_at` is replaced only when the new value is non-null.
- **Close:** only when `FetchOutcome.complete` is true – every open job of that company not in
  the fetched set gets `closed_at = fetchedAt`. Rows are never deleted by refresh.
  - Guard: if a complete fetch returned 0 jobs while the company has open jobs, close nothing
    and set the result `message` to `"empty complete fetch – not closing"`.
  - Incremental runs that stopped early (`known-ids`) close nothing.
  - A fetch that hit the page cap (`page-cap`) cannot prove a job is gone, so it closes only the
    jobs not returned **and** not seen for `STALE_JOB_DAYS` (14). Without this, capped keyword
    recipes (Accenture, HCLTech, Wipro) would keep jobs open forever. A job that drops out of the
    capped window but is still live is closed after 14 days and reopens when it returns. The
    result `message` says "page cap reached" so a too-small `maxPages` is visible.
  - There is no automatic full run. In practice:
    - Single-call ATSs (greenhouse, ashby, workable) always reach the end, so closures are
      always detected.
    - Paged ATSs reach the end whenever the matching jobs fit under the page cap. Early stop
      only happens on recipes with `sortedNewestFirst: true`.
    - For those, closures are caught when you tick **Full refresh** in the UI or run
      `npm run refresh -- --full`. Full mode only switches off the early stop; the page cap
      still applies.
- `companies.last_success_at = fetchedAt`; `first_success_at = fetchedAt` if it was null.

**"New"** = `first_seen_at` is after the company's *previous* successful fetch, i.e. the job
first appeared in the company's latest successful fetch. **A company's first successful
fetch marks nothing as new** – it is the baseline. Because `first_seen_at`, `first_success_at`
and `last_success_at` all use the same `fetchedAt`, this is:

```sql
is_new = jobs.first_seen_at >= companies.last_success_at
     AND jobs.first_seen_at >  companies.first_success_at
```

Failed fetches don't move `last_success_at`, so "new" survives a failed refresh.

## 7. REST API

Express on `127.0.0.1:3001`; Vite proxies `/api`. JSON bodies, zod-validated (schemas in
`types.ts`). Errors are `ApiError`: 400 `validation` (with zod issues in `details`),
403 `forbidden` (Host check), 404 `not-found`, 409 `conflict`, 500 `internal`.

Local-only hardening (cheap): bind to 127.0.0.1, reject requests whose `Host` isn't
`localhost`/`127.0.0.1`/`[::1]` (DNS rebinding), and require `Content-Type: application/json` on
POST/PUT/PATCH/DELETE, **even when there is no body** (blocks cross-site simple-form posts). No
CORS headers.

**Built so far (Steps 9a-9c):** `GET /api/jobs`, `PATCH /api/jobs/:id/status`, `POST /api/refresh`,
`GET /api/refresh/:runId/events`, `GET /api/refresh/latest`, `GET /api/companies`,
`GET/POST/PUT/DELETE /api/companies[/:slug]`, `POST /api/companies/import-curl`,
`POST /api/companies/:slug/verify`, `GET/PUT /api/profile`, `GET /api/stats`, `GET /api/health`.
Still to build: `GET /api/export.csv`.
`DELETE` also needs the JSON content type, like every write.
`GET /api/companies` returns `runtime.openJobs`/`newJobs` as counts of **open India jobs**.

| Method & path | Request | Response |
|---|---|---|
| `GET /api/jobs` | query `JobsQuerySchema` | `Page<JobListItem>` |
| `PATCH /api/jobs/:id/status` | `JobStatusUpdateSchema` | `JobStatusRecord` |
| `POST /api/refresh` | `RefreshRequestSchema` | 202 `RefreshStarted` · 409 `{ details: { runId } }` · 404 unknown company |
| `GET /api/refresh/latest` | – | `RefreshRunSummary` or `null` (lets the UI rejoin a running run after a reload) |
| `GET /api/refresh/:runId/events` | – | SSE of `RefreshEvent` |
| `GET /api/companies` | – | `CompanyList` |
| `GET /api/companies/:slug` | – | `CompanySummary` |
| `POST /api/companies` | `CompanyRecipe` | 201 `CompanySummary` · 409 if slug exists |
| `PUT /api/companies/:slug` | `CompanyRecipe` (full replace; slug must match) | `CompanySummary` |
| `DELETE /api/companies/:slug` | – | 204 (deletes file, row, jobs) · 409 if any of its jobs has a status or notes – use `disabled` instead |
| `POST /api/companies/import-curl` | `ImportCurlRequestSchema` | `ImportCurlResponse` |
| `POST /api/companies/:slug/verify` | `VerifyRequestSchema` | `VerifyResult` |
| `GET /api/profile` | – | `Profile` |
| `PUT /api/profile[?dryRun=true]` | `Profile` | `ProfileSaveResponse` |
| `GET /api/export.csv` | same query as `/api/jobs`, no paging | `text/csv` |
| `GET /api/stats` | – | `Stats` |

### `GET /api/jobs` details

- Defaults: `india=true`, `includeClosed=false`, `sort=relevance`, `page=1`, `pageSize=50`
  (max 200). Without `status`, `ignored` jobs are hidden; `status=none` = no status set.
- Comma lists: `company`, `category`, `tier` (e.g. `tier=high,medium`).
- `q`: case-insensitive `LIKE` over title, company name, `location_raw`, snippet.
- `city`: `EXISTS (SELECT 1 FROM json_each(cities_json) WHERE value = ?)`.
- Sorts: `relevance` = score desc, then `first_seen_at` desc; `posted` = `posted_at` desc
  nulls last; `firstSeen` = `first_seen_at` desc. All tie-break on `id`.

### Writes

- `PATCH .../status`: upserts `job_status`; `status: null` clears the status, `notes: ""` clears
  notes. 404 if the job doesn't exist.
- Recipe writes (`POST`/`PUT`/`DELETE`, verify) go through one `recipes/store.ts` that
  validates, writes pretty JSON (2 spaces, schema key order, trailing newline) atomically
  (temp file + rename), then calls `syncCompanies()`.
- `import-curl`: parses "Copy as cURL (bash)" or "Copy as fetch". Keeps only `accept`,
  `accept-language` and `content-type` headers; lists every other stripped header name (never
  values). Runs ATS detection on the URL. Returns a draft with `status: "unverified"`. It makes
  no network call.
- `verify` with a `recipe` body = dry run (no file or DB writes); without a body = verify the
  stored recipe and update its file. Both run the same verify routine as the CLI (§8).
- `PUT /api/profile`: validates, then in one transaction re-runs location parsing and scoring
  on every stored job from `location_raw`, title and snippet (no re-fetch) and writes the file.
  Each company's `indiaFiltered` flag applies, and company boilerplate (§11.3) is found from its
  open jobs' stored descriptions, as a refresh would. `dryRun=true` computes the same without
  writing anything (it is computed in memory, not rolled back). `before`/`after` are tier counts of
  **open India jobs**, using the stored values and the new profile's classification. Saving is
  refused with 409 while a refresh runs (the run scores with the profile it loaded at its start);
  a dry run is always allowed. The first save rewrites `profile.json` with `JSON.stringify`
  (2 spaces), so its hand-formatted layout changes once.

### CSV export

Columns: `id, company, category, title, url, location, cities, is_india, is_remote,
posted_at, first_seen_at, last_seen_at, closed_at, tier, score, matched_keywords, status,
notes`. RFC 4180: CRLF line ends, every field quoted, `"` doubled. Lists joined with `"; "`.
UTF-8 with BOM (Excel). Cells starting with `=`, `+`, `-` or `@` are prefixed with `'`
(spreadsheet formula injection).

### Stats

See `Stats` in `types.ts`. `newPerDay` covers the last 30 days by `first_seen_at` in the
machine's local time zone (`date(first_seen_at, 'localtime')`), always 30 entries (zeros included),
only open India jobs first seen after the company's baseline fetch. `perCompany` lists companies
with open India jobs, most high + medium first. `funnel` counts every job with a status (open or
closed, all five statuses). `tiers` counts open India jobs.

## 8. CLI scripts

Run from the repo root (`npm run <script> -- <args>`), implemented in `server/src/cli/`, using
the same modules as the server (no duplicate logic).

- **`detect:ats <url>`** – `lib/detect-ats.ts`. First matches the URL itself (e.g.
  `*.myworkdayjobs.com`, `jobs.lever.co`, `boards.greenhouse.io`, `jobs.ashbyhq.com`,
  `*.smartrecruiters.com`, `apply.workable.com`, `*.eightfold.ai`, `*.oraclecloud.com`
  `/hcmUI/CandidateExperience`, `*.successfactors.*`, `google.com/about/careers`); if no
  match, GETs the page once and looks for the same hosts in links, iframes and scripts.
  Prints `DetectAtsResult` as JSON. `candidateApiUrl` is built only from tokens present in
  the URL/HTML, else null. Exit 0 if detected, 1 if not.
- **`verify:company <slug>` / `--all`** – runs the adapter with `keywords = []`,
  `maxPages = 1`, no known IDs (proves endpoint + parsing, independent of how many relevant
  jobs exist today). Passes if ≥ 1 job is valid (externalId, title, absolute url). If the
  adapter has `fetchDescription`, it also fetches one sample description; a failure there is a
  warning, not a verify failure. Prints the count and 3 sample titles. Updates the recipe file per §2 (`verified` + `verifiedOn` today +
  clears `lastError`; or `lastError` + `broken`/stays `unverified`). Writes no jobs. `--all`
  verifies every recipe except `needs-manual`/`disabled`. Exit 1 if any failed.
- **`refresh [--company <slug>] [--full]`** – calls `startRefresh`, prints one line per company
  (`ok/failed/skipped`, fetched/new/closed, ms), then totals. Exit 0 unless the run aborted.

## 9. Folder structure

```
package.json                 # workspaces: server, web; scripts: dev typecheck lint test refresh detect:ats verify:company
server/
  data/
    companies/<slug>.json    # recipes (git)
    profile.json             # profile (git)
    jobs.sqlite              # gitignored
  src/
    types.ts                 # contracts (this doc)
    config.ts                # constants + env overrides (PORT, DATA_DIR, DB_PATH)
    app.ts                   # createApp(deps) – used by index.ts and supertest
    index.ts                 # start server
    db/          connection.ts migrations.ts companies.ts jobs.ts job-queries.ts job-status.ts refresh-runs.ts stats.ts
    lib/         http.ts location.ts phrases.ts dates.ts text.ts job-id.ts concurrency.ts zod-error.ts
                 dot-path.ts csv.ts detect-ats.ts parse-curl.ts
    recipes/     store.ts write-rules.ts   # load, validate, writeRecipe, writeVerification, syncCompanies; client write rules
    profile/     store.ts
    scoring/     compile-profile.ts relevance.ts
    adapters/    index.ts drain.ts paginate.ts greenhouse.ts lever.ts ashby.ts smartrecruiters.ts workable.ts
                 workday.ts eightfold.ts oracle-hcm.ts successfactors.ts google-careers.ts generic.ts
    refresh/     service.ts normalize.ts events.ts verify.ts
    api/         jobs.ts companies.ts refresh.ts profile.ts export.ts stats.ts errors.ts local-only.ts
    cli/         detect-ats.ts verify-company.ts refresh.ts
  tests/
    fixtures/    <ats>.json | <ats>.html, relevance-golden.json, curl/*.txt, SOURCES.md
    *.test.ts    # mirrors src/ (adapters/, lib/, refresh/, api/, ...)
web/
  src/
    api/         client.ts (fetch wrapper) hooks.ts (TanStack Query) events.ts (EventSource)
                 refresh-controller.ts (start a run, follow it, panel state)
    lib/         job-filters.ts (URL <-> filters) refresh-progress.ts (SSE reducer) format.ts labels.ts
                 recipe-draft.ts (Add-company form <-> recipe) job-boards.ts company-outcome.ts
    pages/       JobsPage (9a) CompaniesPage (9b) DashboardPage ProfilePage (9c)
    components/  Layout FilterBar MultiSelect JobsTable NotesDrawer RefreshPanel Pagination Toast ...
                 CompaniesTable AddCompanyDialog ManualChecks
  tests/         vitest, pure logic only (filters, progress reducer, formatting)
```

`web` imports contracts with `import type { … } from "@server/types"` (tsconfig path alias);
type-only imports keep zod out of the web bundle.

`config.ts` holds every tuning constant in one place: rate limit 1000 ms, timeout 15 000 ms,
retries 2, company concurrency 4, company budget 120 s, detail requests 20 per company per
run, max response 5 MB, default page cap 5.

## 10. Test strategy

`npm test` runs vitest with **no network**. All tests use an in-memory SQLite (`:memory:`) and
a temp `DATA_DIR` where files are written.

- **Golden set** – `tests/scoring/relevance-golden.test.ts` runs `it.each` over
  `fixtures/relevance-golden.json` (`cases[]`, type `RelevanceGoldenCase`); each case asserts
  `relevanceTier` and `isIndia` against the real `server/data/profile.json`. Any
  profile/scoring change must keep it green; new mistakes are added as cases first (Step 10).
  See §11.8.
- **Adapters** – one test per adapter with a fake `HttpClient` serving a saved real response
  (`fixtures/<ats>.json|.html`, trimmed to 3–5 jobs; source URL and date in
  `fixtures/SOURCES.md`). Assert: field mapping, absolute URLs, page requests built correctly
  (keyword, offset), page cap, early stop only when `sortedNewestFirst`, `FetchOutcome`.
- **paginate.ts** – synthetic pages: end / page-cap / known-ids / multi-keyword merge and dedupe.
- **Refresh service** – fake adapters: first fetch marks nothing new, second fetch marks only
  added jobs new, update/lastSeen, close on complete only, no close on early stop or page cap,
  empty-fetch guard, reopen, failed company isolated (others succeed, no partial writes),
  invalid-job counting. Description requests: only for qualifying jobs (all 4 rules), cap of
  20, a failure keeps the job, never repeated for a stored snippet.
- **lib** – location (aliases, multi-location, `indiaFiltered`), dates (ISO, epoch, relative),
  text (snippet ≤ 12 000), http (rate-limit spacing, retry/backoff, timeout – fake fetch + fake
  timers), csv (quoting, BOM, formula prefix), parse-curl (cURL and fetch samples with fake
  cookies/tokens → stripped), detect-ats (URL and HTML samples).
- **Recipe data** – a test loads every `server/data/companies/*.json` and requires it to pass
  `CompanyRecipeSchema` and match its file name. Catches researcher mistakes in CI.
- **API** – supertest against `createApp()` for every route: happy path, validation error,
  404/409 (including DELETE blocked by statuses). SSE: snapshot on connect, then live events,
  then close.

## 11. Relevance

`scoring/relevance.ts` scores a job from its `title` and `descriptionSnippet` (the whole posting
text, up to 12 000 chars, not a short excerpt);
`lib/location.ts` parses `locationRaw`. Both are pure functions of their inputs and
`server/data/profile.json` (`ProfileSchema` in `types.ts`): no I/O, no randomness, no LLM.
The profile is compiled once per refresh/rescore (phrases tokenized and sorted), not per job.

```ts
scoreJob(title: string, description: string, profile: CompiledProfile): RelevanceResult
titleMatchesCore(title: string, profile: CompiledProfile): boolean   // used by §5 description requests
parseLocation(raw: string, indiaFiltered: boolean, profile: CompiledProfile): ParsedLocation
```

### 11.1 Profile at a glance

| Field | Purpose |
|---|---|
| `candidate` | Experience (5–8 y), target levels, preferred cities (Pune, Mumbai, Remote), relocation. **Not used in scoring.** The UI uses `preferredCities` as a quick filter. Experience is expressed in scoring only through the `entry level` penalty. |
| `keywords.core` | The target stack (Dialogflow, CCAI, Agent Assist, GECX, CX Agent Studio, virtual agent, voicebot, chatbot, IVR …). |
| `keywords.adjacent` | Neighbouring stacks (Genesys, NICE CXone, Five9, Amazon Connect/Lex, Twilio Flex, Kore.ai, Yellow.ai, Rasa, NLU, LLM agents, RAG, prompt engineering, contact center, conversation design, speech …). |
| `weights` | core 10 title / 4 description; adjacent 6 / 2; `roleBonus` 6; `descriptionCap` 12. |
| `roleTerms` | Title words that mark a builder role: engineer, developer, architect, consultant, lead, … |
| `negativeTerms` | Penalties for sales, BPO/support-agent, telecaller, non-technical, customer-success, entry-level and product/program-manager titles. |
| `tiers` | high ≥ 16, medium ≥ 8, low ≥ 4, else none. |
| `cities`, `indiaTerms`, `remoteTerms`, `remoteRegionTerms`, `foreignCountryTerms` | Location parsing (§11.6). |

Each keyword entry is a **concept**: `term` plus `aliases` (synonyms, spellings, plurals of
multi-word forms). Prompt keywords that name the same product are one concept, so a title like
"CCAI (Contact Center AI) Engineer" is not counted twice: `CCAI` ⊃ "Contact Center AI";
`Gemini Enterprise for CX` ⊃ "GECX". "Conversational designer" is an alias of the adjacent
concept `conversation design` (design role, not engineering).

### 11.2 Text matching

1. **Normalize** with `normalizeForMatching` (exported from `types.ts`, the only normalizer):
   NFKD, drop accents, lowercase, every run of non-`[a-z0-9]` becomes one space. So
   `Kore.ai`→`kore ai`, `CCAI-P`→`ccai p`, `Pre-Sales`→`pre sales`, `Remote – APAC`→`remote apac`.
   Then split into tokens.
2. **A phrase matches** where its tokens appear consecutively in the text tokens (whole
   tokens only: `sales` does not match `salesforce`, `IND` does not match `Indiana`). The last
   token may carry one extra `s` (`chatbots`, `virtual agents`, `IVRs`).
3. **Longest phrase wins.** All positive phrases (core and adjacent, terms and aliases) are
   tried longest first (by token count); a match consumes its tokens so shorter phrases can't
   reuse them. "Dialogflow CX" therefore doesn't also count as "Dialogflow", "Contact Center
   AI" doesn't also count as adjacent "contact center", "Vertex AI Agent Builder" doesn't count
   "AI agent", and "Power Virtual Agent" (Copilot Studio) doesn't count "virtual agent".
4. A concept counts **once per field**, however often it appears. The schema rejects a phrase
   that normalizes the same in two concepts, so matching never depends on list order.
5. Title and description are matched separately. Negative terms and role terms are matched on
   the normalized text independently of the consumed tokens.

### 11.3 Score

```
T  = set of concepts matched in the title
D  = concepts matched in the description that are NOT in T

title       = Σ over T: weights[kind].title                (core 10, adjacent 6)
roleBonus   = weights.roleBonus (6) if T has a core concept AND the title has a role term, else 0
description = min(Σ over D: weights[kind].description, weights.descriptionCap)   (core 4, adjacent 2, cap 12)
penalties   = Σ penalty of each negative concept that matches (once per concept)

relevanceScore = max(0, title + roleBonus + description − penalties)
```

Why it is shaped this way:

- **Title dominates.** A core keyword in a builder title ("Dialogflow CX Developer",
  "Chatbot Developer", "CCAI Architect") reaches high on its own: 10 + 6 = 16.
- **Role bonus only for core titles.** "Genesys Engineer" (6) stays medium even when its
  description mentions IVR and contact center (6 + 4 + 2 = 12). Adjacent stacks are relevant
  but not the target.
- **Description is capped at 12**, below `high`. A generic "Senior Software Engineer" whose
  description is all Dialogflow CX/Agent Assist lands in medium; a generic title can only reach
  high when the title itself has an adjacent signal ("AI Engineer – Contact Center": 6 + 12).
- **Penalties cancel title points.** They are sized so a matching penalty pulls a core title
  out of high/medium: sales 15, support-agent/telecaller 20, BPO and voice-process 12,
  customer-success 12, non-technical 10, product/program manager 10, entry level 18
  (intern, trainee, fresher, junior, associate engineer – too junior for 5–8 years).
- Scores are integers (all weights are integers); clamping at 0 keeps "none" jobs at 0 rather
  than ranking them by how negative they are.

#### Company boilerplate

Wording that every posting of a company repeats ("About us ... contact center ... LLM agents")
says nothing about one job. `scoring/boilerplate.ts` finds, per company, the concepts that appear
in the descriptions of at least `BOILERPLATE_MIN_SHARE` (50 %) of its jobs, only when at least
`BOILERPLATE_MIN_JOBS` (10) jobs have a description. `scoreJob` gives those concepts no
description points; a title match still counts. The corpus is the fetched jobs plus the company's
other open stored jobs, so a short incremental fetch gets the same answer as a full one. Small
boards are left alone on purpose: shared wording there may be a real focus of the company.
Stored scores are recomputed on the next refresh of that company (a profile rescore without a
fetch does not apply this rule yet).

### 11.4 Negative terms

- `scope: "title"` (default) checks the title only. `"titleAndDescription"` is used only for
  strong BPO hiring signals (`voice process`, `chat process`, `non voice`, `typing speed`,
  `12th pass`). `telecaller` is title-only on purpose: an automation job may say "automate
  telecalling" in its description (golden case `core-07`).
- `except` phrases are removed from the text before that negative term is matched:
  `sales` has `pre sales`, `sales engineer`, `sales engineering`, `sales cloud`,
  `sales automation`, so "Pre-Sales Solution Consultant – Conversational AI" is not
  penalized, while "Inside Sales Executive – Conversational AI SaaS" is.
- Negative matches are not listed in `matchedKeywords`.

### 11.5 Tier and outputs

- `relevanceTier`: `high` if score ≥ `tiers.high` (16), `medium` ≥ 8, `low` ≥ 4, else `none`.
  Tier ignores location; the UI's `india=true` default does the location filtering.
- `matchedKeywords`: concept `term`s (never aliases), title matches first, then description
  matches, each in profile order (core, then adjacent). Shown as chips in the UI.
- `titleMatchesCore(title)`: true when the title matches any core concept (same matcher, §11.2).

Worked examples (from the golden set):

| Title | Title | Role | Desc | Penalty | Score | Tier |
|---|---|---|---|---|---|---|
| Dialogflow CX Developer (desc: CCAI, virtual agents) | 10 | 6 | 8 | 0 | 24 | high |
| AI Engineer – Contact Center (desc: Dialogflow CX, Agent Assist, LLM agents, RAG) | 6 | 0 | 12 (cap) | 0 | 18 | high |
| Genesys Engineer (desc: IVR, contact center) | 6 | 0 | 6 | 0 | 12 | medium |
| Conversational Designer (desc: Dialogflow CX, virtual agents) | 6 | 0 | 8 | 0 | 14 | medium |
| Senior Software Engineer (desc: Dialogflow CX, Agent Assist, virtual agents) | 0 | 0 | 12 | 0 | 12 | medium |
| Product Manager, Conversational AI (desc: virtual agent) | 10 | 0 | 4 | 10 | 4 | low |
| Agent Assist Specialist (non-tech) (desc: contact center) | 10 | 0 | 2 | 10 | 2 | none |
| Junior Chatbot Developer (desc: Dialogflow) | 10 | 6 | 4 | 18 | 2 | none |
| Customer Support Executive – Voice (desc: voice process) | 0 | 0 | 0 | 32 | 0 | none |

### 11.6 Location

Using the same normalization and phrase matcher on `locationRaw`:

1. `cities` = every `profile.cities` entry whose `name` or an alias matches, in profile order,
   de-duplicated. "Gurgaon (NCR)" → `["Delhi NCR", "Gurugram"]`.
2. `isRemote` = any `remoteTerms` phrase matches. "Hybrid" is not remote. If remote,
   `"Remote"` is appended to `cities`.
3. The string is split on `|`, `;` and newlines; each part is judged alone, and the job is India
   when **any** part is. A part is India when any of these hold:
   - the recipe has `filters.indiaFiltered: true` (the request itself restricts to India);
   - an `indiaTerms` phrase matches ("India", "IND", "Pan India", state names);
   - it matches an India city, or is remote and a `remoteRegionTerms` phrase matches ("APAC", "Asia
     Pacific", "Worldwide", "Anywhere") – **unless** a `foreignCountryTerms` phrase also matches
     ("Hyderabad, Pakistan", "Taguig, NCR, Philippines", "Remote (Asia - Japan)",
     "Remote - Anywhere in the US"). Decision: "Remote – APAC" counts as India because India is in APAC.
   - Region terms are checked after the remote phrases are blanked, so "anywhere" inside "Work from
     anywhere" is not a region. A part that is not India contributes no city (only `"Remote"`).
4. Otherwise `isIndia` is false. Notably: bare `"Remote"`, `"Remote – US"`, `"Remote - EMEA"`,
   `"Singapore"` and `""` are not India. Multi-location strings are India if any part is
   ("London, United Kingdom | Bengaluru, India").

### 11.7 Changing the profile

`PUT /api/profile` re-scores every stored job (§7) – no re-fetch. To tune:

- A job missed entirely → add an alias or concept (check §11.2: whole tokens, longest wins).
- A job ranked too high → add a negative term or an `except`, not a lower core weight.
- Keep `descriptionCap` < `tiers.high`, so that a job never reaches high from its
  description alone.

### 11.8 Golden set

`server/tests/fixtures/relevance-golden.json` – `{ about, cases: RelevanceGoldenCase[] }`,
71 cases (60 from Step 2, 11 `fn-*`/`fp-*` from Step 10): 28 high, 12 medium, 15 low, 16 none; 64 India, 7 not. Fields: `id`, `title`,
`description`, `location`, optional `indiaFiltered`, `expected { tier, isIndia }`, `why`.
Ids are grouped `core-*`, `med-*`, `low-*`, `none-*`, `loc-*` (location edge cases). Tricky
cases covered: Customer Support Executive – Voice, Conversational Designer, Genesys Engineer,
Chatbot Developer, AI Engineer – Contact Center, Agent Assist Specialist (non-tech), pre-sales vs
sales, "automate telecalling", junior/intern titles, US-only roles, Remote – APAC/US/EMEA,
bare Remote, Workday "2 Locations" with `indiaFiltered`, multi-location strings.

The test scores each case against the real `server/data/profile.json`, so it guards both the
algorithm and the profile. During Step 2 every case was checked against a throw-away
implementation of §11.2–§11.6 (60/60 pass); Step 4 writes the real one, test first.

## Decisions that differ from the Step 1 prompt

1. Adapters yield `FetchedJob` (raw fields), not "NormalizedJob without scores". `id`,
   location, dates, snippet and timestamps are derived once in `normalize.ts`.
2. Added recipe status `unverified`, so every recipe passes verify at least once before refresh uses it.
3. Added `closedAt` to `NormalizedJob` and `filters.indiaFiltered` to recipes.
4. Jobs are closed only after a *complete* fetch. No automatic full fetch.
5. (Step 2) `filters.indiaFiltered: true` makes every job of that recipe India, not only jobs
   with unparseable locations – the request already restricts to India, and this avoids
   guessing what "unparseable" means.
6. (Step 2) Synonymous prompt keywords are merged into one concept ("Contact Center AI" is an
   alias of `CCAI`, "GECX" of `Gemini Enterprise for CX`); all prompt keywords are still matched.

## Resolved questions (user, 2026-11-21)

| # | Question | Decision |
|---|---|---|
| 1 | `unverified` status | Keep. A recipe must pass verify at least once before refresh uses it (§2). |
| 2 | First fetch marks jobs new? | No – the first successful fetch is the baseline (§6). |
| 3 | Descriptions for list-only ATSs | One detail request per qualifying job, capped (§5). |
| 4 | Keyword fan-out | One query per keyword, max 6. |
| 5 | Deleting a company | Blocked (409) when any of its jobs has a status or notes (§7). |
| 6 | Automatic full refresh | Not wanted. Full refresh is manual only (§6). |
| 7 | google-careers | Checked live: public embedded-JSON listing works (§3). |
| 8 | Profile schema | Finalized in Step 2 (§11, `ProfileSchema` in `types.ts`). |

## Open questions

None. All Step 1 questions are resolved.
