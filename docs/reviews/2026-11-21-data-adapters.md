# Review – data and adapters (Step 7), 2026-11-21

Scope: `server/src/adapters/**`, `server/src/refresh/**` (plus `lib/http.ts`, `lib/concurrency.ts`),
15 recipes, relevance golden set. `npm test`: 24 files, 307 tests pass.

Live checks (read-only listing GETs and the Workday search POST, ≥1 s apart): Paytm (Lever), Freshworks
and WNS (SmartRecruiters, with and without `q`), Accenture and Zendesk (Workday), KPMG and Zensar (Oracle),
Verint (Ashby), Talkdesk, Observe.AI and Razorpay (Greenhouse), Foundever (SuccessFactors), Google.

## High

### H1. Scoring on the 1000-char snippet misses core matches; scoring full text adds boilerplate false positives
- Evidence: `refresh/normalize.ts:61-63` scores `toSnippet(description)` (max 1000 chars). Scored live
  Greenhouse boards both ways (snippet vs full plain text):
  - Observe.AI: "AI Agent Engineer, Client Facing" **low 6 → high 16**, "AI Agent Experience Designer"
    **low 6 → high 18** (India company, target roles). 6 of 10 jobs change tier.
  - Talkdesk: 27 of 38 jobs change tier. Full text also lifts "Marketing Operations Specialist",
    "Director, EMEA Regional Marketing", "SOC Engineer" etc. to **low** via company boilerplate
    ("contact center", "LLM agents" in every posting).
- The golden test (`tests/scoring/relevance-golden.test.ts:21`) scores the raw short description, not the
  production path, so it cannot catch this.
- Fix: score the full plain-text description at fetch time (store `matchedKeywords`/score, keep the
  snippet for display). Suppress company boilerplate deterministically: ignore a description-only phrase
  for a company when it occurs in ≥ 50 % of that company's fetched jobs in the run. Add golden cases with
  long HTML descriptions (keyword after char 1000; boilerplate-only match) and run them through
  `normalizeJob`, not `scoreJob` directly. Also consider "AI agent" as a title alias (Observe.AI titles).

### H2. Paytm board is cut in half
- Evidence: `server/data/companies/paytm.json` has `maxPages: 1`; Lever page size is 100 (`lever.ts:12`).
  Live: `skip=100` returns 99 more postings, `skip=200` returns 0 → 199 jobs, only 100 fetched. Every run
  ends `page-cap`, so nothing ever closes either.
- Fix: `maxPages: 3` (or 5) for Paytm; check every single-page Lever/generic recipe the same way.

### H3. Page-capped keyword recipes never close jobs
- Evidence: `paginate.ts:54-57` → `complete=false`; `service.ts:332` closes only on `complete`. Keyword
  search is OR-matched on several ATSs, so the cap is hit every run: Accenture "Conversational AI" with the
  India facet returns `total: 2000` (5 × 20 read); HCLTech 2073 (PROGRESS); Wipro same API. `--full` keeps the
  page cap, so there is no way to close these jobs. Stale jobs stay "open" forever.
- Fix: deterministic staleness rule – when a company's fetch is incomplete, close jobs whose `last_seen_at`
  is older than N successful runs/days (e.g. 14 days). Separately, send multi-word keywords as quoted
  phrases where the ATS supports it (check Workday `searchText` with quotes live) to cut result counts.

### H4. Workday location is empty or a placeholder on some tenants
- Evidence: `workday.ts:56` reads only `locationsText`. Live Accenture: `locationsText` is absent on every
  posting; the city is in `bulletFields[1]` ("Pune", "Bengaluru") → `locationRaw = ""`, no cities, so the
  Pune/Mumbai preference never applies. Zendesk returns `"2 Locations"` for multi-location jobs. Both recipes
  are `indiaFiltered`, so isIndia survives, but any non-filtered Workday recipe would mark them non-India.
- Fix: fall back to `bulletFields.slice(1)` when `locationsText` is missing; for `"<n> Locations"` take
  `jobPostingInfo.location` + `additionalLocations` from the detail response when it is fetched, else keep
  `""` (unknown) instead of the placeholder text. Add an Accenture-shaped fixture.

## Medium

### M1. A missing total is read as "end", giving a false complete fetch that closes jobs
- `oracle-hcm.ts:138` uses `TotalJobsCount ?? 0` → `hasMore=false` after page 1.
- `successfactors.ts:8,68` falls back to 25 rows/page, but Foundever serves 10 rows/page (live label
  "Results 1 – 10 of 25"); if the label is missing, page 1 (10 rows) looks like the last page.
- Either case returns `complete: true` and `closeUnseenJobs` closes everything beyond page 1.
- Fix: when the total is missing, use the size of the first page as the page size and continue while a page is
  full; never report `complete` from a heuristic alone (return `hasMore` true until an empty/short page).

### M2. A partly broken parser closes the unreadable jobs
- `service.ts:238` fails only when **all** jobs are invalid; `service.ts:336-337` then closes every stored job
  that came back unreadable (dropped as invalid).
- Fix: skip closing when `jobsInvalid > 0` (record a message like the empty-fetch guard).

### M3. Budget overrun throws away the whole company fetch
- `service.ts:229` 120 s `AbortSignal`; `paginate.ts:36` throws; `service.ts:181-188` records `failed`, nothing
  stored. Accenture-type recipes do 6 keywords × 5 pages + 20 detail GETs = 50 serial requests on one host;
  at ~2 s Workday latency that is ~100 s, and one retry (15 s timeout + 1 s/3 s backoff, `http.ts:150` sleep
  not abortable) pushes it over. Same-host companies (SmartRecruiters, Lever) also share the 1 req/s slot.
- Fix: catch the budget abort in `paginate` and return `{ complete: false, stopReason: "budget" }` so the
  jobs already fetched are stored; skip remaining detail requests when the signal is aborted.

### M4. "Verified" recipes whose notes say verify was not run
- `kpmg.json`, `zensar.json`, `google.json` notes: "verify:company not run", but `status: verified` with
  `verifiedOn: 2026-11-21`. PROGRESS says Batch A was verified. The endpoints do answer today (KPMG 13 jobs,
  Zensar 219 India jobs, Google 200 OK), so they are not invented, but the record contradicts AGENTS.md.
- Fix: re-run `npm run verify:company -- kpmg|zensar|google` and correct the notes.

## Low

- **L1 KPMG recipe returns nothing.** The CX_3001 site has 13 jobs titled like "Senior-KDNI"; keywords
  "Conversational AI" and even "AI" return 0, so 6 requests per run yield 0 jobs. Fix: no keywords (one
  page covers the board) and score on `ShortDescriptionStr`.
- **L2 Wipro `filters.location: "India"` is ignored** – the generic adapter never reads `filters.location`
  (`generic.ts:98-108`); the real filter is `body.location`. Remove it or document that generic ignores it.
- **L3 Run-level isolation edge.** If the DB write inside the failure `catch` (`service.ts:184-187`) throws,
  `mapWithConcurrency` (`concurrency.ts:17`, `Promise.all`) rejects: the run is marked aborted and
  `activeRunId` cleared while other workers keep running, so a second run can start. Fix: `Promise.allSettled`
  or catch per item.

## Recipe sample (15)

accenture, zendesk (workday) · verint (ashby) · cisco, wipro, sutherland (generic) · kpmg, zensar, hexaware
(oracle-hcm) · foundever (successfactors) · freshworks (smartrecruiters) · google (google-careers) · paytm
(lever) · talkdesk (greenhouse) · searce (manual).

- No invented endpoints: every fetchable sampled recipe answered live with parseable jobs.
- India filters present where the ATS supports them (Workday facets, SR `country=in`, Oracle `locationId`,
  SF `locationsearch`, Phenom `selected_fields.country`, Google `location=India`); KPMG/Kotak/EXL/HCLTech have
  none (known, noted in PROGRESS).
- No `verified` without `verifiedOn` (the schema enforces it). Only `verified` and `needs-manual` exist in the
  repo; no recipe uses `eightfold` or `workable`.
- SmartRecruiters `sortedNewestFirst: true` is correct: results stay newest first with `q` (checked WNS).

## Relevance golden set

60/60 pass (tier and isIndia); no false positives or negatives in the set, and the snippet path gives the same
tiers for all 60 (descriptions are short). Fragile: 4 cases sit exactly on the high threshold 16 (core-15,
core-17, loc-02, loc-03), 2 on medium 8 (med-03, med-06), 3 on low 4 (low-02, low-03, low-04).

Probes outside the set (need user labels before adding):
- Likely FP: "Contact Center Operations Manager" with CCAI/Agent Assist in the description → **medium 14**.
- Likely FN: "Customer Engineer, AI/ML" (Customer Engagement Suite) → **low 4**; real-world H1 cases above.
- Borderline: "Technical Account Manager – CCAI" → none; "Sales Engineer – Conversational AI" → high.

## Checked and fine

`paginate` early stop (only `sortedNewestFirst`, page fully known, per query), cross-query dedupe and
`complete` rule match ARCHITECTURE §3; per-host rate limit reserves slots synchronously (`http.ts:84-89`);
15 s timeout, 2 retries with backoff and capped Retry-After, retries only on 0/429/5xx; cookies never sent;
every adapter passes `ctx.signal`; a failing company is recorded and the run continues.
