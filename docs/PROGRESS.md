# Progress Log

Hand-off between steps. Each step appends one entry. See `docs/STEPS.md` for the full plan.

## Step 0 – Setup files (done)

- Added `AGENTS.md`, `.opencode/agents/{architect,builder,company-researcher,reviewer}.md`,
  `docs/STEPS.md`, `docs/COMPANY_SEED.md`.
- No app code yet.
- Next: Step 1 (architect agent, Claude Opus 5.5).

## Step 1 – Architecture and contracts (done)

- Wrote `docs/ARCHITECTURE.md`: jobs pipeline, recipe schema and status lifecycle, adapter
  interface and shared paginate rules, SQLite schema, refresh flow, SSE, new/closed rules,
  REST API, CLI, folder layout, test strategy.
- Wrote `server/src/types.ts` (zod 4): enums, `FetchedJob`/`NormalizedJob`,
  `CompanyRecipeSchema` with cross-field rules, first-cut `ProfileSchema`, `HttpClient`,
  `Adapter`/`FetchContext`/`FetchOutcome`, refresh/SSE types, API request schemas and
  response types. It compiles under strict TS against zod 4.6.7 (checked in a scratch dir,
  since the project isn't scaffolded yet).
- Changes from the prompt (listed in the doc): adapters yield raw `FetchedJob`; new recipe
  status `unverified`; added `closedAt` and `filters.indiaFiltered`; jobs close only after a
  complete fetch, with an automatic full fetch every 7 days.
- Files: `docs/ARCHITECTURE.md`, `server/src/types.ts`, `docs/PROGRESS.md`.
- Open issues: 8 open questions at the end of `docs/ARCHITECTURE.md` need answers from the user.
  Step 2 owns the final `ProfileSchema` and the "Relevance" section.
- Answers applied (same session): first fetch is a baseline (nothing new); detail requests
  for list-only ATSs (title matches a core keyword, India, max 20 per company per run); keep 6
  keywords; DELETE blocked when jobs have statuses/notes; no automatic full refresh; Google
  careers checked live – the public results page embeds job JSON (`ds:1`), documented in §3.
  Only open question left: keep the `unverified` status.
- Confirmed: keep `unverified` – a recipe must pass verify at least once before refresh uses
  it; the schema now requires `verifiedOn` for `verified` and `broken`. No open questions remain.
- Next: Step 2 (architect, Opus 5.5): `server/data/profile.json`, relevance golden set, and
  the "Relevance" section in `docs/ARCHITECTURE.md`.

## Step 2 – Profile and relevance golden set (done)

- User profile: 5–8 years; targets Senior Engineer / Lead / Consultant; preferred Pune,
  Mumbai, Remote-India; open to relocation. Stored in `profile.candidate` (not used in scoring;
  experience is reflected by the `entry level` penalty).
- `server/data/profile.json`: 17 core concepts (all 19 prompt keywords; CCAI ⊃ Contact Center
  AI, Gemini Enterprise for CX ⊃ GECX), 20 adjacent concepts, aliases/spellings, role terms,
  9 negative concepts with `except` and `scope`, tiers high 16 / medium 8 / low 4, 25 India
  cities with aliases, India/remote/remote-region terms.
- `server/tests/fixtures/relevance-golden.json`: 60 cases (26 high, 12 medium, 9 low, 13 none;
  6 non-India), including all the tricky cases from the prompt.
- `docs/ARCHITECTURE.md` §11 "Relevance": matching, score formula, penalties, tiers,
  location rules, tuning, golden-set format. §1 `indiaFiltered` rule simplified (decision 5).
- `server/src/types.ts`: final `ProfileSchema` (candidate, roleBonus, descriptionCap,
  roleTerms, negative `except`/`scope`, remoteRegionTerms, duplicate-phrase and
  preferredCities checks), `normalizeForMatching`, `REMOTE_CITY`, `RelevanceGoldenCase`.
- Checked: types.ts compiles (strict, zod 4.6.7, scratch dir); profile.json passes the
  schema; a throw-away implementation of §11 passes 60/60 golden cases (not in repo).
- User reviewed 12 golden labels (core-07, core-09, core-13, core-16, med-01, med-02,
  med-04, low-04, none-02, none-07, loc-02, loc-07) and accepted them, including: "Remote –
  APAC" counts as India, bare "Remote" does not, Product Manager roles get low. No open issues.
- Next: Step 3 (builder, Sonnet 5.5 `#low`): scaffold the project per `docs/STEPS.md`.

## Step 3 – Scaffold the project (done)

- Root `package.json` (npm workspaces `server`, `web`; scripts `dev` via concurrently, `typecheck`,
  `lint`, `test`, `format`, `refresh`, `detect:ats`, `verify:company`), `.gitignore`,
  `.prettierrc.json`, `git init` (no commit yet).
- `server/`: ESM, TS strict (+ `noUncheckedIndexedAccess`), Express 5, better-sqlite3, zod 4,
  vitest + supertest, tsx, eslint (typescript-eslint type-checked) + prettier. `config.ts`
  (PORT 3001, DATA_DIR, DB_PATH), `app.ts` (`createApp()` with `GET /api/health`), `index.ts`,
  `tests/health.test.ts`. CLI files in `src/cli/` are stubs that exit 1 until Step 4+.
- `web/`: Vite 8 + React 19, Tailwind 4 (`@tailwindcss/vite`), TanStack Query, React Router,
  eslint + prettier. `HealthPage` calls `/api/health` via `api/client.ts` + `api/hooks.ts`; Vite
  proxies `/api` to the server; `@server/*` alias points to `server/src/*`.
- Checked: `npm run typecheck`, `lint`, `test` all pass; `npm run dev` serves `/api/health`
  through the Vite proxy; better-sqlite3 loads. TypeScript pinned to 6.x in both workspaces
  (7.x not yet supported by typescript-eslint). Prettier reformatted `server/src/types.ts`
  (formatting only).
- Open issues: none. Web has no tests yet. Dev ports: web 5174 (Vite moves to the next free port
  if taken), server 3001.
- Next: Step 4 (core server – DB, HTTP client, scoring, refresh engine, CLI tools).

## Step 4 – Core server (done)

- Built in `server/src`: `db/` (connection, migrations v1 = the §4 schema, typed queries for companies,
  jobs, job_status, refresh runs/results), `lib/` (`http.ts`, `location.ts`, `phrases.ts` shared
  phrase matcher, `dates.ts`, `text.ts`, `job-id.ts`, `concurrency.ts`, `zod-error.ts`,
  `detect-ats.ts`), `scoring/` (`compile-profile.ts`, `relevance.ts`), `profile/store.ts`,
  `recipes/store.ts` (load + validate, `writeVerification`, `syncCompanies`), `adapters/`
  (`greenhouse.ts`, registry + `resolveAdapter`, `drain.ts`), `refresh/` (`service.ts`,
  `normalize.ts`, `events.ts`, `verify.ts`), CLIs `detect-ats`, `verify-company [<slug>|--all]`,
  `refresh [--company <slug>] [--full]`. `config.ts` now holds all tuning constants.
- Golden test written first (`tests/scoring/relevance-golden.test.ts`): the real scoring passes
  60/60 with no profile changes. Tests: 12 files, 205 tests, no network. `npm run typecheck`,
  `lint`, `test` all pass.
- Fixture `server/tests/fixtures/greenhouse.json` is a real Databricks response trimmed to 4 jobs
  (source in `fixtures/SOURCES.md`).
- Checked live (then removed the temp recipes/DB): `detect:ats` on a Greenhouse URL and a
  non-ATS page; `verify:company` on the Airbnb board (202 jobs, wrote `verified` + `verifiedOn`);
  `refresh` twice (baseline, nothing new). No recipe files were added to `server/data/companies/`
  (that is Step 6).
- Deviations from the docs: `adapters/paginate.ts` is not built yet (greenhouse is single-call;
  Step 5 adds it with its tests). `startRefresh` returns `{ runId, invalidFiles, done }`
  (§5 updated). The 5 MB response cap is applied as written.
- Open issues:
  - **Large Greenhouse boards fail the 5 MB response cap with `content=true`**: Databricks is
    9.8 MB, Anthropic 9.6 MB, Stripe 6.1 MB (Airbnb 2.9 MB is fine). Decide for Step 5/6: raise
    `HTTP_MAX_RESPONSE_BYTES` (e.g. 15 MB, one constant in `config.ts`) or have those recipes use
    the URL without `content=true` (no descriptions, so scoring is title-only). I did not change it.
  - `detect:ats` cannot see JavaScript-rendered career pages (e.g. databricks.com careers
    returns no ATS); the researcher should then look at the page's network calls or use the
    ATS URL from a job link.
  - The CLI creates its own HTTP client; the server must create one shared client so the
    per-host rate limit holds across API calls (Step 8).
- Next: Step 5 (builder, Sonnet 5.5 `#medium`): remaining ATS adapters per `docs/STEPS.md`; start
  with `adapters/paginate.ts` + tests, using `adapters/greenhouse.ts` and `tests/adapters/greenhouse.test.ts`
  as the pattern.

## Step 5a – Workday, Eightfold, Oracle HCM, SuccessFactors, Google Careers, generic (done)

- Added adapters in `server/src/adapters/`: `workday`, `eightfold`, `oracle-hcm`, `successfactors`,
  `google-careers`, `generic`, all registered in `adapters/index.ts`. New shared code:
  `paginate.ts` (the §3 paging rules: per-keyword queries, page cap, early stop on all-known pages
  only for `sortedNewestFirst`, dedupe, `complete` only if every query reached its end),
  `shared.ts` (`UNREADABLE_JOB`, `requireFetchSpec`, `withQueryParams`; greenhouse now uses it),
  `lib/dot-path.ts` (`getPath`, `setPath`, `toText`, `renderTemplate`, `replaceInStrings`).
  `lib/dates.ts` now also parses "November 16, 2026" (Amazon). New dependency: `cheerio`.
- `fetchDescription` exists for workday, eightfold and successfactors (listing has no description);
  oracle-hcm and google-careers use what the listing gives.
- Fixtures (real responses, trimmed to 4 jobs, sources in `tests/fixtures/SOURCES.md`): `workday.json`,
  `workday-job.json`, `eightfold.json`, `eightfold-job.json`, `oracle-hcm.json`,
  `successfactors.html`, `successfactors-job.html`, `google-careers.html`, `generic.json` (Amazon).
  One test file per adapter plus `paginate.test.ts` and `lib/dot-path.test.ts`.
- Checked live (temp recipes outside the repo, then removed): `verify:company` passed for NVIDIA
  (workday), Netflix (eightfold), JPMorgan (oracle-hcm), EY (successfactors), Google careers and
  Amazon (generic); two `refresh` runs with keywords on a temp DB all ended `ok`. No recipe files were
  added to `server/data/companies/` (that is Step 6).
- Checked: `npm run typecheck`, `lint`, `test` pass (20 files, 276 tests, no network).
- Notes for Step 6 (details in ARCHITECTURE §3 "Adapter notes"):
  - Workday needs the India facet copied from the site's own `facets` (NVIDIA: `locationHierarchy1`).
  - Oracle HCM: India `locationId` comes from `locationsFacet` of an unfiltered response; put it in
    `filters.location`. SuccessFactors/Eightfold/Google take a location text in `filters.location`.
  - Eightfold tenants that answer 403 "Not authorized for PCSX" and SuccessFactors sites behind a
    Cloudflare challenge (jobs.sap.com) cannot be fetched: mark them `needs-manual`.
  - Only SuccessFactors table layouts (`tr.data-row`) are supported.
- Deviation: running `prettier --write` from the repo root also reformatted `fixtures/greenhouse.json`
  and `fixtures/SOURCES.md` (whitespace only, same data); run formatting through `npm run format`.
- Open issues: the 5 MB response cap vs large Greenhouse boards (Step 4) is still undecided.
- Next: Step 5b (Lever, Ashby, SmartRecruiters, Workable) – then Step 6, company research.

## Step 5b – Lever, Ashby, SmartRecruiters, Workable (done)

- Added adapters in `server/src/adapters/`: `lever` (skip/limit paging, exact `location`), `ashby`,
  `smartrecruiters` (`q`, `country`, offset/limit, newest first, `fetchDescription`), `workable` (widget
  API, `details=true`); all registered in `adapters/index.ts`. `shared.ts` gained `withCountry`,
  `joinAddressParts`, `joinLocations` (used to build `locationRaw` with the country, since several ATSs omit it).
  The generic adapter (`fieldMap` dot paths) was already done in Step 5a.
- Fixtures (real responses trimmed to 4 jobs, sources in `tests/fixtures/SOURCES.md`): `lever.json` (Meesho),
  `ashby.json` (Sarvam), `smartrecruiters.json` + `smartrecruiters-job.json` (ServiceNow), `workable.json`
  (Stadium). One test file per adapter (field mapping, absolute URLs, ISO-able dates, paging, page cap, early
  stop, bad entries, bad response).
- Test change: `tests/refresh/verify.test.ts` used Lever as the "no adapter" example; it now passes an empty registry.
- Checked live (temp recipes outside the repo, then removed): `verify:company --all` passed for Meesho (lever, 48),
  Sarvam (ashby, 42), ServiceNow India (smartrecruiters, 80) and Stadium (workable, 8); a `refresh` run ended `ok` for all four.
- Checked: `npm run typecheck`, `lint`, `test` pass (24 files, 307 tests, no network). No recipe files were added to
  `server/data/companies/` (Step 6).
- Notes for Step 6 (details in ARCHITECTURE §3 "Adapter notes (Step 5b)"):
  - Lever `filters.location` is an exact location name, not "India" – usually leave it empty (scoring/location parsing
    handles India). Lever has no keyword search.
  - SmartRecruiters recipes: `filters.location: "in"`, `indiaFiltered: true`, `sortedNewestFirst: true`.
  - Workable recipes need `?details=true` for descriptions; an unknown account returns an empty 200, so check the
    account name on `apply.workable.com/<account>` first.
  - Ashby and Workable have no server-side filters, so large boards are fetched whole (Ashby OpenAI ≈ 14 MB exceeds the
    5 MB cap – same open issue as large Greenhouse boards).
- Open issues: the 5 MB response cap vs very large boards (Greenhouse, Ashby) is still undecided.
## Step 6 – Company research, Batch A (done, in progress overall)

- Researched Batch A (Google and Google Cloud partners, 24 companies) from `docs/COMPANY_SEED.md`.
  Result: 6 verified (Accenture, Genpact, Google, KPMG, Quantiphi, Zensar), 18 needs-manual.
- Recipes written: `server/data/companies/<slug>.json` for all 24 companies. Table in
  `docs/research/batch-A.md`.
- Facet keys for Workday: India/city ids go under `appliedFacets.locations` (Genpact, Quantiphi) or
  `appliedFacets.locationCountry` (Accenture). `locationMainGroup` returned HTTP 400 for all three; the
  key is read from the board's own unfiltered listing response, not guessed.
- Checked: `npm run verify:company` for the 6 verified recipes; `detect:ats` for all 18 needs-manual
  companies; `npm test` passes (24 files, 307 tests), including the recipe-schema test.
- Files touched: `server/data/companies/*.json` (24 new files), `docs/research/batch-A.md`,
  `docs/PROGRESS.md`. Deleted a stray `server/data/companies/ey.json.tmp` written by the researcher
  (placeholder stub, not a recipe).
- Open issues:
  - The company-researcher agent's shell was denied, even though its permissions allow
    `npm run verify:company*` and `npm run detect:ats*`. The verify and detect steps were run from the
    main session. Fix the permission config before the next batch.
  - Searce: careers URL returns 404; `manualSearchUrl` is a Google fallback, not a careers page.
  - Cognizant, Infosys, PwC and TCS return 403 to automated requests; needs-manual is final for now.
  - HCLTech, Wipro, Hexaware: an ATS host appears but no company tenant or site number is in the static
    HTML (JS-rendered). Needs a browser network check to find the tenant.
  - LTIMindtree (RippleHire) and Persistent (Zwayam) have no adapter.
  - The 5 MB response cap is still untested for full boards (only first pages were checked).
- Next: Step 6 continues with Batch B (contact-center and CX software vendors), then C, D and E.
  Run the same flow: fix the researcher's shell permission first, then verify each `unverified` recipe.

## Step 6 – Company research, Batch B (done)

- Researched Batch B (contact-center and CX software vendors, 17 companies) from `docs/COMPANY_SEED.md`.
  Result: 6 verified (Freshworks, Genesys, Sprinklr, Zendesk, Talkdesk, Verint), 11 needs-manual.
- Recipes written: `server/data/companies/<slug>.json` for all 17 companies. Table in
  `docs/research/batch-B.md`.
- Workday India facet: `appliedFacets.locationCountry` = `c4f78be1a8f14da0ab49ce1162348a5e`, read from the
  unfiltered listing (Genesys, Sprinklr, Zendesk).
- Checked: `detect:ats` on all 17 careers URLs; `verify:company` on the 6 verified recipes; Avaya's two
  SuccessFactors hosts both return 404 (attempt 2), so Avaya is needs-manual; `npm test` passes
  (24 files, 307 tests).
- Files touched: `server/data/companies/*.json` (17 new files), `docs/research/batch-B.md`,
  `docs/PROGRESS.md`.
- Open issues:
  - The researcher agent's shell is still denied; this batch was run from the main session, as in Batch A.
  - First-page samples are unfiltered, so relevance is not confirmed yet (checked on the first refresh).
  - Freshworks, Verint and Talkdesk first pages include non-India roles; location scoring handles them.
  - Cisco is on Phenom (no adapter); Twilio is on Eightfold with no tenant visible; Avaya's SuccessFactors
    hosts return 404.
  - Exotel, Five9, LivePerson, NICE, Ozonetel and Zoho have no ATS host in static HTML. Their job lists may
    load through JavaScript (not checked in a browser).
- Next: Batch D (BPO / CX services running CCAI programs), then E. Same flow: detect, write, verify, and
  record in `docs/research/batch-<X>.md`.

## Step 6 – Company research, Batch C (done)

- Researched Batch C (Indian conversational-AI and voice-AI companies, 17 companies) from `docs/COMPANY_SEED.md`.
  Result: 4 verified (Bolna, Sarvam AI, Observe.AI, Uniphore), 13 needs-manual.
- Recipes written: `server/data/companies/<slug>.json` for all 17 companies (category `india-ai`). Table in
  `docs/research/batch-C.md`.
- Checked: `detect:ats` on all 17 careers URLs; a second attempt (homepage careers links, ATS host scan) for
  the 13 without an endpoint; `verify:company` passed for the 4 verified recipes on the first attempt;
  `npm test` passes (24 files, 307 tests).
- Uniphore India facet: `appliedFacets.locations` (Bangalore, Chennai) from the unfiltered Workday listing.
- Files touched: `server/data/companies/*.json` (17 new files), `docs/research/batch-C.md`,
  `docs/PROGRESS.md`.
- Open issues:
  - The researcher agent's shell is still denied; this batch was run from the main session, as in Batches A and B.
  - Samples are unfiltered; relevance is not confirmed until the first refresh.
  - Sarvam AI's board is large (42 on the first page); the 5 MB cap is still untested for full boards.
  - Convin (LinkedIn only), LimeChat (Notion page), Verloop (403), Engati (TLS error) and Senseforth (expired
    certificate) cannot be read by the detect tool. Gnani.ai, Gupshup, Haptik, Kore.ai, Rezo.ai, Skit.ai,
    CoRover and Yellow.ai show no ATS host in static HTML; a browser check of their job requests would confirm this.
## Step 6 – Company research, Batch D (done)

- Researched Batch D (BPO and CX services running CCAI programs, 14 companies) from `docs/COMPANY_SEED.md`.
  Result: 2 verified (Concentrix, EXL), 12 needs-manual.
- Recipes written: `server/data/companies/<slug>.json` for all 14 companies (category `bpo`). Table in
  `docs/research/batch-D.md`.
- Checked: `detect:ats` on all 14 careers URLs; a second attempt for the 12 without an endpoint (homepage
  careers links, detect on the new URLs, and the SuccessFactors hosts linked from Foundever and HGS);
  `verify:company` passed for Concentrix and EXL on the first attempt; `npm test` passes (24 files, 307 tests).
- Concentrix India facet: `appliedFacets.locationCountry` (86 India jobs) from the unfiltered Workday listing.
- Files touched: `server/data/companies/*.json` (14 new files), `docs/research/batch-D.md`, `docs/PROGRESS.md`.
- Open issues:
  - The researcher agent's shell is still denied; this batch was run from the main session, as in Batches A–C.
  - EXL's recipe covers the whole Oracle site (not India only); the first page is mixed.
  - Samples are unfiltered; relevance is not confirmed until the first refresh.
  - Foundever and HGS: SuccessFactors search pages return 404 on every host found; both need a manual check.
  - Infosys BPM and TTEC return 403; Conduent, Firstsource, IBEX, Movate, Sutherland, TaskUs, Teleperformance
    and WNS show no ATS host in static HTML.
- Next: all five seed batches are researched (A–E). See `docs/STEPS.md` for the step after company research.
  Before the first refresh: fix the researcher agent's shell permission and check the 5 MB cap.

## Step 6 – Company research, Batch E (done)

- Researched Batch E (product and BFSI companies with in-house CX AI, 15 companies) from `docs/COMPANY_SEED.md`.
  Result: 4 verified (Kotak Mahindra Bank, Meesho, Paytm, Razorpay), 11 needs-manual.
- Recipes written: `server/data/companies/<slug>.json` for all 15 companies (category `product-bfsi`). Table in
  `docs/research/batch-E.md`.
- Checked: `detect:ats` on all 15 careers URLs; a second attempt for the 11 without an endpoint (homepage
  careers links, detect on the new URLs, and Meesho's Lever board page); `verify:company` passed for Paytm,
  Razorpay, Meesho and Kotak on the first attempt; `npm test` passes (24 files, 307 tests).
- Meesho: the careers page returned 503 on the first check; the Lever board API answers, so the recipe uses it.
- Files touched: `server/data/companies/*.json` (15 new files), `docs/research/batch-E.md`, `docs/PROGRESS.md`.
- Open issues:
  - The researcher agent's shell is still denied; this batch was run from the main session, as in Batches A–D.
  - Paytm's board is large (100 on the first page); Meesho's response is about 800 KB. The 5 MB cap is still
    untested for full boards.
  - Kotak's recipe covers the whole Oracle site (not India only).
  - Samples are unfiltered; relevance is not confirmed until the first refresh.
  - Airtel, Axis Bank, Flipkart, HDFC Bank, ICICI Bank, Jio, MakeMyTrip, Myntra, PhonePe, Swiggy and Zomato
    are needs-manual (no ATS host in static HTML, or 403/timeout).


## Step 6 – Recipe fix: HCLTech (done)

- HCLTech was `needs-manual` because the SuccessFactors search page has no `tr.data-row` in static HTML. The page's own
  JS (`j2w.searchManager.min.js`) POSTs `{keywords, locale, location, pageNumber, sortBy}` to
  `https://careers.hcltech.com/services/recruiting/v1/jobs` (public, no cookies). Recipe is now `generic`
  (POST, `pageNumber` paging from 0, 10 jobs/page, `totalPath: totalJobs`); `verify:company hcltech` passed (10 jobs).
  Job URLs `/job/<urlTitle>/<id>-en_US/` return 200 (checked 3).
- Limits (also in the recipe notes): the listing has country only (no city, description or usable date;
  `unifiedStandardStart` is `M/D/YY`, not parsed), so scoring is title + country; the `location` param never matched
  (not even for "India"), so there is no India filter; multi-word keywords are OR-matched ("Conversational AI" = 2073
  hits), so only the first 5 pages (50 jobs) per keyword are read. `GECX` returns 0.
- A public RSS feed also exists (`/services/rss/job/?locale=en_US&keywords=...`) with full descriptions and dates, but
  no adapter reads RSS.
- Files touched: `server/data/companies/hcltech.json`, `docs/research/batch-A.md`, `docs/PROGRESS.md`.
  `typecheck`, `lint`, `test` pass (24 files, 307 tests).
- Open: the same API pattern (`/services/recruiting/v1/jobs`) probably works for Wipro and other SuccessFactors CSB
  sites with the same search JS; check them next. To keep cities, the generic `fieldMap.location` would need to accept
  several paths (not done; code change).

## Step 6 – Recipe fix: Wipro (done)

- Same SuccessFactors Career Site Builder search API as HCLTech: public POST
  `https://careers.wipro.com/services/recruiting/v1/jobs`, no cookies. Recipe is `generic` (page paging from 0,
  10 jobs/page, `totalPath: totalJobs`); `verify:company wipro` passed (10 jobs); 2 job URLs checked (200).
- Unlike HCLTech, `location: "India"` in the body works here (7164 jobs total vs 5611 India), so the recipe is
  `indiaFiltered: true`. The listing gives the city (`sfstd_jobLocation_obj`) and country, but no description or
  usable date (`M/D/YY`). `fieldMap.location` is the city only (one path allowed); it is safe because the request is
  India-filtered. `CCAI` and `GECX` return 0; multi-word keywords are OR-matched, so only the first 50 jobs per keyword are read.
- Files touched: `server/data/companies/wipro.json`, `docs/research/batch-A.md`, `docs/PROGRESS.md`.
  `typecheck`, `lint`, `test` pass (24 files, 307 tests).
- Open: other needs-manual SuccessFactors CSB sites (look for `j2w.searchManager.min.js` in the search page) may
  use the same endpoint; Foundever and HGS were reported as 404 on their SuccessFactors search pages, so check them first.

## Step 6 – Recipe fix: Foundever and HGS (done)

- Both were `needs-manual` because the earlier check used the wrong hosts (`career4`/`career10.successfactors.com`).
  The real career sites are on SuccessFactors Career Site Builder:
  - **Foundever**: `https://www.foundever.com/careers/` redirects to `jobs.foundever.com`. The JSON search API answers 401
    there, but the HTML search page works with the existing `successfactors` adapter (`/search/?q=&locationsearch=India`,
    10 rows/page, "of 25" total). Recipe: `ats: successfactors`, `filters.location: India`, no keywords (only 25 India jobs).
    `verify:company foundever` passed (10 jobs); one job URL returned 200.
  - **HGS**: `careers.joinhgs.com` is a multi-brand site. Public POST `/services/recruiting/v1/jobs` with `"brand": "India"`
    (the value in the India page's own `appParams`; no cookie or CSRF token needed) returns only the 8 India jobs;
    `location: "India"` returns 0 and without `brand` it returns all brands. Recipe: `generic`, `indiaFiltered: true`,
    location = `custState` (state only). `verify:company hgs` passed (8 jobs); 2 job URLs returned 200.
- Limits: HGS listing has no city, description or usable date; boards are small and mostly operations roles, so few CCAI matches are expected.
- Files touched: `server/data/companies/foundever.json`, `server/data/companies/hgs.json`, `docs/research/batch-D.md`,
  `docs/PROGRESS.md`. `typecheck`, `lint`, `test` pass (24 files, 307 tests).
- Open: other needs-manual companies whose "ATS host" was only a link on the careers page may have a separate career-site
  host (follow the careers redirect). Candidates: Conduent, Movate, Sutherland, Teleperformance, WNS, Firstsource, IBEX, TaskUs, Convin.

## Step 6 – Recipe fixes: second look at the "no ATS host in static HTML" companies (done)

Followed each careers page's redirects and links, then read the page's own search JS for the listing call.
Result: 7 more verified (`verify:company` passed; typecheck, lint, test pass: 24 files, 307 tests); Movate, IBEX and Convin stay needs-manual.

| company | how it is fetched | notes |
|---|---|---|
| Conduent | `generic`, Phenom People `POST careers.conduent.com/widgets` (refineSearch) | `selected_fields.country=India` → 169 jobs, size 50, `from` offset; teaser as description; job URL `/us/en/job/<jobSeqNo>` (200) |
| Cisco | same Phenom call on `careers.cisco.com/widgets` (`pageId page4`, `en_global`) | 315 India jobs; job URL `/global/en/job/<jobSeqNo>` (200) |
| WNS | `smartrecruiters`, company `WNSGlobalServices144` (found on `wnscareers.com/global-location/india`) | `country=in`, 69 jobs on page 1; company id `WNSGlobalServices` is empty |
| TaskUs | `workday`, tenant `taskus`, site `Careers` (found on `jobs.taskus.com`) | India facet `locationCountry` (140 jobs) |
| Firstsource | `successfactors` HTML on `careers.firstsource.com/search/` | `locationsearch=India` → 59 jobs; the JSON API answers 401 |
| Teleperformance | `generic`, `GET www.tp.com/Umbraco/Api/Careers/GetCareersBase?node=1780&country=India` | ~1,190 India jobs, 100/page, newest first, descriptions; location is an office name |
| Sutherland | `generic`, Shazamme `GET shazamme.io/Job-Listing/src/php/actions?dudaSiteID=76755cce&action=Get Jobs` | all 438 jobs in one ~3 MB response (cap 5 MB, watch growth); 51 India; full descriptions |

- Still needs-manual: **Movate** (server-rendered WordPress, no JSON; `manualSearchUrl` now the site's India filter),
  **IBEX** (no India careers page; no job endpoint), **Convin** (LinkedIn only).
- Open issues:
  - Sutherland has no server-side India filter, and its response is 3 MB of the 5 MB cap; if it grows past the cap the
    recipe fails (raise `HTTP_MAX_RESPONSE_BYTES` or use a different call).
  - Conduent, Cisco, Teleperformance, Sutherland and HCLTech/Wipro/HGS use `generic`, which can map only one location
    path and cannot parse `M/D/YY` dates (HCLTech/Wipro/HGS have no date mapped).
  - Phenom People is now a known pattern (`/widgets`, `refineSearch`); other Phenom sites could use it without a new adapter.
  - Not rechecked this round: Cognizant, Infosys, PwC, TCS, Infosys BPM, Verloop, Engati, Senseforth (403/TLS), and the
    other needs-manual companies from batches A, B, C and E.

## Step 7 – Data and adapter review (done)

- Reviewed adapters, refresh service, HTTP client, 15 recipes (all ATS types in use, both statuses present),
  golden set; live read-only checks on 12 boards. `npm test` passes (24 files, 307 tests); golden 60/60.
- Files: `docs/reviews/2026-11-21-data-adapters.md`, `docs/PROGRESS.md`. No code or recipe changes.
- Open: 4 High (snippet-only scoring misses core matches / boilerplate FPs; Paytm `maxPages: 1` reads 100 of
  199; page-capped keyword recipes never close jobs; Workday location empty on Accenture / "2 Locations"),
  4 Medium, 3 Low – see the review.
- Next: Step 8 – fix all Critical and High findings from `docs/reviews/2026-11-21-data-adapters.md`.

## Step 8 – Fix High findings from the data and adapter review (done)

Source: `docs/reviews/2026-11-21-data-adapters.md`. There were no Critical findings; all four High are fixed.

- **H1 scoring on a 1000-char snippet.** `DESCRIPTION_SNIPPET_MAX` is now 12 000 (longest of 77 sampled
  postings: 12.7k), so scoring sees the whole posting. New `scoring/boilerplate.ts`: a concept found in
  ≥ 50 % of a company's job descriptions (company has ≥ 10 with descriptions) earns no description
  points (`scoreJob` 4th argument; title matches still count). Corpus = fetched jobs + other open stored
  jobs. Constants in `config.ts`. Live check on 3 Greenhouse boards: Observe.AI "AI Agent Engineer" low → medium,
  "AI Agent Experience Designer" low → high; Talkdesk marketing/finance/security roles back to none.
- **H2 Paytm.** `paytm.json` `maxPages` 1 → 5 (board has 199 jobs, Lever pages of 100). A refresh that stops
  on the page cap now sets the result message `PAGE_CAP_MESSAGE`, so this kind of mistake shows up.
- **H3 capped fetches never closed jobs.** `closeUnseenJobs` takes `notSeenSince`; on `page-cap` the service
  closes unseen jobs not seen for `STALE_JOB_DAYS` (14). `known-ids` still closes nothing (jobs past the early stop
  are not re-read); empty capped fetches close nothing.
- **H4 Workday location.** Falls back to `bulletFields[1]` when `locationsText` is missing (Accenture); the
  "N Locations" placeholder becomes `""` (unknown). Fixtures: `workday-accenture.json`, `workday-zendesk.json`.
- Tests added (326 total, was 307): workday (2), boilerplate (5), relevance ignored concepts (2), toSnippet (2,
  one replaced), service capped fetches (4) and whole-description scoring (4), Paytm recipe (1).
  `npm run typecheck`, `lint`, `test` pass. Golden set unchanged, 60/60.
- Files: `server/src/{config,types}.ts`, `scoring/{boilerplate,relevance}.ts`, `refresh/{service,normalize}.ts`,
  `db/jobs.ts`, `adapters/workday.ts`, `data/companies/paytm.json`, tests and fixtures above,
  `docs/ARCHITECTURE.md` (§1, §6, §11), `docs/reviews` unchanged.
- Open / not done:
  - Multi-location Workday jobs ("2 Locations") stay without a location; the real places are only in the detail
    response, and `fetchDescription` returns text only. Needs an adapter-interface change.
  - `bulletFields[1]` is assumed to be the city when `locationsText` is missing; check this per new Workday tenant.
  - Boilerplate suppression applies when a company is refreshed; the future `PUT /api/profile` rescore from stored text
    must call `findBoilerplateConcepts` too (noted in ARCHITECTURE §11).
  - Existing databases keep scores computed from the old 1000-char text until the next refresh of each company.
  - Not done (needs your label, per the golden-set rule): the "AI agent" title alias, the "Contact Center Operations
    Manager" medium score, "Customer Engineer, AI/ML" low score. Medium findings M1–M4 and Low L1–L3 are still open.
- Next: Step 9 per `docs/STEPS.md` (Medium/Low review findings can be fixed before it).

## Step 9a – Jobs page, refresh panel and the API they need (done)

**Prerequisite found:** the REST API (STEPS.md Step 8) was never built – the "Step 8" above was the
review-fix step and `server/src/api/` did not exist. With your OK I built only the routes 9a needs.

- **Server** (`server/src/api/`, `db/job-queries.ts`, `app.ts` now `createApp(deps)`, `index.ts` wires the real
  app: one shared HTTP client, `abortRunningRuns`, `syncCompanies` at start):
  `GET /api/jobs` (all filters, sorts, paging; `%`/`_` escaped in search), `PATCH /api/jobs/:id/status`,
  `POST /api/refresh` (202 / 409 with `runId` / 404), `GET /api/refresh/:runId/events` (SSE),
  `GET /api/refresh/latest`, `GET /api/companies`, `GET /api/profile`. Error shape `ApiError`; Host check (403
  `forbidden`) and JSON content-type check on writes (§7).
- **Contract changes** (types.ts + ARCHITECTURE §5/§7): SSE `snapshot` now has `running: string[]` (otherwise a
  page reload could not show which companies are being fetched); `ApiError.error` gained `"forbidden"`;
  `GET /api/refresh/latest` added; `CompanyRuntime.openJobs/newJobs` = open **India** jobs.
- **Web** (`web/src`): `pages/JobsPage` + `components/` (FilterBar, MultiSelect, JobsTable, NotesDrawer,
  RefreshPanel, Pagination, Toast, Badges, StateViews), `api/` (client, hooks with optimistic status updates,
  `events.ts` SSE hook, `refresh-controller.ts`), `lib/` (job-filters, refresh-progress, format, labels).
  Filters live in the URL (same names as the API; default view = tiers High/Medium/Low, India, open, not
  ignored). Table: tier, title (+New/Closed), company, city, matches, posted, first seen, status, row actions
  (open, save, applied, ignore, notes drawer) with Undo toast. Refresh button + "Full refresh", live panel
  (progress bar, per-company state, Errors and Warnings lists), rejoins a running run after reload.
  Loading skeleton, empty states (no jobs yet / no match / nothing new), error state with retry.
  Look: warm paper, IBM Plex Sans/Mono (bundled via `@fontsource`, no CDN), one teal accent.
- **Tests:** server 363 (was 326; +37 in `tests/api/`: filters, new/baseline, sorts, paging, validation, status
  PATCH, host and content-type guards, companies, profile, POST refresh, SSE snapshot/live/closed/failure).
  Web has its first tests (38, vitest, pure logic: filters, SSE reducer, formatting). `npm run typecheck`,
  `lint`, `test` pass.
- **Checked in a browser** (headless Chrome driven with puppeteer-core from a temp folder, not added to the
  repo; the Chrome DevTools MCP could not attach): jobs table on real data from a temp DB, three full live
  refreshes of the 33 verified companies through the UI, progress and error panel, reload during a run,
  notes drawer (save, Esc), ignore + Undo, search/clear, New filter, sort by posted, narrow 1024 px, API down
  error state. Files: server `src/api/*`, `src/db/job-queries.ts`, `src/app.ts`, `src/index.ts`,
  `src/refresh/service.ts` (`getRunningCompanies`), tests; web as above; `docs/ARCHITECTURE.md`.
- **Seen in the live runs (not fixed, belongs to Step 10 / recipe work):**
  - Wipro and HCLTech fail with `Unexpected response: no jobs array at "jobSearchResult"`; their recipes passed
    verify earlier, so the API response changed or differs by request – recheck.
  - Paytm (199 jobs, ~58 s) and Foundever time out intermittently at the 15 s per-request limit.
  - Accenture and Genpact hit the page cap (warning shown in the panel).
  - Google titles keep HTML entities (`T&amp;I Partnership`): decode entities in titles in `normalize.ts`.
- **Open / not done:**
  - Still unbuilt API routes (STEPS Step 8): companies CRUD, import-curl, verify, `PUT /api/profile`, CSV export,
    stats. 9b needs companies write routes, import-curl and verify; 9c needs stats and `PUT /api/profile`.
  - The Tier "None" chip is off by default; clicking the last active tier chip does nothing (at least one stays on).
  - Dropping unsaved notes asks with `window.confirm`; no automated browser tests.
- **Next:** build the missing API routes for 9b (companies CRUD, import-curl, verify), then Step 9b.

## Step 9b – Companies page, Add company flow, manual-check list (done)

- **Server (the routes 9b needs):** `GET/POST/PUT/DELETE /api/companies[/:slug]`, `POST /api/companies/import-curl`,
  `POST /api/companies/:slug/verify` (body `{recipe}` = dry run, no body = verify the stored file and save the
  outcome). New: `lib/parse-curl.ts` (cURL bash incl. `$'..'`, `-b`, `-u`, and "Copy as fetch"; keeps only
  accept / accept-language / content-type; lists every dropped header by **name**; no network),
  `recipes/write-rules.ts` (client write rules, §2), `writeRecipe`/`deleteRecipeFile` in `recipes/store.ts`,
  `companyHasUserData`/`deleteCompany` in `db/companies.ts`. `createApp` deps gained `http` and `adapters`
  (one shared client for verify and refresh).
- **Rules worth knowing** (ARCHITECTURE §2 updated): the client can never set `verifiedOn`/`lastError`; a new
  company cannot arrive verified; editing ats/fetch/fieldMap/filters or asking for `unverified` drops the proof;
  DELETE is 409 when any job has a status or notes. "Enable" after "Disable" therefore sets `unverified` and the
  UI immediately runs verify.
- **Web:** `/companies` (`pages/CompaniesPage`, nav item added). Table: category, ATS, status, last fetch, open
  India jobs (+new), Verify now (inline result with sample titles and warnings), Disable/Enable; refresh and
  verify errors shown under the company name. Filters: search, category, status. "Add company" dialog: paste ->
  review (detected ATS, removed header names, warnings, editable identity/keywords/location/request JSON, field
  map for generic) -> Test (dry run) -> Save (needs a passing test of the current values; then a real verify).
  "Check manually" lists the 54 needs-manual companies (reason, search link, careers link) and a job-board
  panel with a keyword picker (profile core terms): LinkedIn, Naukri, Indeed and Glassdoor are prefilled (Glassdoor
  format checked against real result URLs); Instahyre, Wellfound and Cutshort have no keyword URL we could
  confirm, so they open the search page (with a "Copy keyword" button).
- **Tests:** server 414 (was 363: +51 in parse-curl, write-rules and the companies API, incl. no-network import and
  no-secret-in-output checks); web 58 (was 38: recipe-draft, job-boards). typecheck, lint, test pass.
- **Checked in the browser** (headless Chrome, recipes copied to a temp folder via `RECIPES_DIR`, real recipe
  files untouched): companies list on real data, Verify now (Meesho, 47 jobs), Disable then Enable (Bolna back to
  Verified through the automatic verify), full Add flow with a pasted cURL that contained a cookie and a CSRF
  token (Lever board: Test passed, Save wrote an unverified file, verify made it verified, no secret in the file).
- **Open / not done:**
  - No delete button in the UI (the API route exists and is tested); "Make a needs-manual company fetchable"
    is not offered (add it as a new company instead).
  - Wipro and HCLTech still show `no jobs array at "jobSearchResult"` on refresh (see 9a); the page now makes
    that visible per company, use Verify now to re-test after fixing the recipe.
  - The Add flow tests the first page only (verify rules); a keyword that returns nothing is not detected.
  - Instahyre/Wellfound/Cutshort keyword URLs are not confirmed (see above).
- **Next:** Step 9c needs `GET /api/stats` and `PUT /api/profile` (re-score stored jobs, dry run with
  before/after tier counts; must also apply the boilerplate rule, §11), then the Dashboard and Profile pages.

## Step 9c – Dashboard and Profile pages (done)

- **Server:** `GET /api/stats` (`db/stats.ts`: 30-day new-per-day with zero days filled, per-company counts,
  funnel, tier counts, last run) and `PUT /api/profile[?dryRun=true]` (`profile/rescore.ts`, `api/profile.ts`).
  The re-score runs from stored text with each company's `indiaFiltered` flag and the **company boilerplate rule**
  (this closes the Step 8 open item "a profile rescore does not apply boilerplate yet"). Save is one transaction
  with the file write, refused with 409 while a refresh runs; a dry run writes nothing and is always allowed.
  `writeProfile` added to `profile/store.ts`; `createApp` deps gained `saveProfile`. ARCHITECTURE §7 updated.
- **Dashboard** (`/dashboard`): tier strip (links to the Jobs list per tier), new roles per day (30 bars, accent =
  high/medium, with a "show as a table" alternative), top 10 companies by high + medium (links to Jobs filtered
  by company), application funnel by status (links to Jobs filtered by status). Loading, empty and error states.
- **Profile** (`/profile`): editors for weights and tiers, role words, core and adjacent keywords with aliases,
  negative terms (penalty, scope, aliases, except), cities with aliases and preferred cities (renaming or
  removing a city keeps `preferredCities` valid). A debounced dry run drives a live "Effect on your jobs" table
  (open India jobs per tier, now vs after, change). Schema errors from the server (e.g. `high > medium > low`,
  duplicate phrase) show in that panel and block Save. "Save and re-score" + Revert, unsaved-changes indicator.
  Not editable here: `indiaTerms`, `remoteTerms`, `remoteRegionTerms`, `candidate` fields other than preferred
  cities; they are kept as they are.
- **Tests:** server 432 (was 414: stats, profile PUT incl. dry run, 400/409, indiaFiltered, rescore with and
  without boilerplate, `writeProfile`); web 69 (was 58: chart, profile-edit helpers). `npm run typecheck`,
  `lint`, `test` pass.
- **Checked in the browser** (headless Chrome; profile and recipes were temp copies via `PROFILE_PATH` and
  `RECIPES_DIR`, real files untouched; DB was the temp one with 3,201 jobs): dashboard on real data; Profile:
  raising the High threshold previews High 9 -> 18 / Medium 24 -> 15, an invalid tier order shows the schema
  message and disables Save, Save re-scored 3,201 jobs and the dashboard then showed the new counts.
- **Open / not done:**
  - A dry run takes about 1.8 s for 3,200 jobs (text is tokenized twice per job: boilerplate, then scoring), so
    the preview lags about 2.5 s behind typing. Fine locally; share the tokens if the database grows a lot.
  - The first saved profile rewrites `server/data/profile.json` with plain `JSON.stringify` formatting (one-time
    diff). The golden set is not re-run on save: after tuning, run `npm test` before keeping the change.
  - `GET /api/export.csv` is still not built (STEPS Step 8), so there is no CSV download in the UI yet.
  - No automated browser tests; the pages are checked by hand and their logic by unit tests.
- **Next:** Step 10 (end-to-end run and accuracy tuning). Before it, decide on the Wipro / HCLTech recipe
  failures and the Google title `&amp;` decoding (see 9a), and build the CSV export if you want it for step 10's lists.

## Step 10 – First full refresh and accuracy tuning (done)

**Run 1 (baseline, nothing is "new")**: 33 verified companies, 31 ok / 2 failed (Wipro, HCLTech); 54 needs-manual not
fetched. 3,191 jobs, 2,708 India (85 %). Tiers (all / India): high 11 / 9, medium 31 / 24, low 80 / 45, none 3,069 / 2,630.
Page cap hit: Genpact (103), Accenture (243).

**After fixes (run 4, 33 ok / 0 failed)**: 3,464 open jobs, 2,963 India, 32 companies with jobs.

| tier | total | India | non-India |
|---|---|---|---|
| high | 13 | 11 | 2 |
| medium | 33 | 27 | 6 |
| low | 100 | 65 | 35 |
| none | 3,318 | 2,860 | 458 |

**Recipe fix (Wipro, HCLTech)**: SuccessFactors search omits `jobSearchResult` when a keyword has 0 hits (`CCAI`, `GECX`),
so the generic adapter threw. `adapters/generic.ts` now treats a missing jobs array as empty when `totalPath` reports 0
(test added). Both recipes stay `verified`; refresh gives Wipro 126 and HCLTech 145 jobs (both hit the 5-page cap).

**Misclassifications found** (218 none/low titles with AI/bot/conversational/contact center/CX were reviewed; most are
generic "AI / ML Engineer" roles, correctly none). Added as golden cases first (`fn-01..05` false negatives,
`fp-01..06` false positives; 71 cases now), then fixed in `server/data/profile.json`:
- Missed: "Google CX Developer" (EXL), "Google Customer Experience Practice Lead" (Accenture) → alias `Google CX`,
  `Google Customer Experience` on core *Customer Engagement Suite* (both now high). "Nice CX One" → alias of NICE CXone
  (low). "AI CX Solutions Consultant", "Customer Experience AI and Knowledge Architect" → new adjacent concept
  *AI customer experience* (aliases `AI CX`, `Customer Experience AI`, `CX AI`; low).
- Wrong high/medium: Observe.AI "Technical Support Engineer" and Paytm "General Manager – Business Operations" (vendor/
  support wording in the description), Sutherland "Product Delivery Manager", Cisco "AI & Agentic" networking/supply-chain
  roles → new title negatives `support engineer` (10), `general manager` (10), `delivery manager` (6),
  `networking`/`supply chain`/LTE/5G/MACsec (6).
- Result: those jobs left medium. Wipro now contributes 4 high (Voice AI Engineering Lead, Genesys Cloud CX IVR, NICE CXone IVA).
- Checked: golden 71/71; `npm run typecheck`, `lint`, `test` pass (server 444, web 69).

**Open issues**
- Accenture's listing has no description (length 0), so its jobs score on the title only (good for "CCAI", misses others).
- Not changed because it needs your label: "Technical Solution Architect – NICE CXone" (low; adjacent roles get no role
  bonus), "Contact Center Operations Manager" medium, "Customer Engineer, AI/ML" low (from Step 8).
- One Cisco row (Data Scientist – Agentic AI … Supply Chain) kept its old score 12 because the listing no longer returned
  it in run 4; it re-scores when seen again.
- Teleperformance has ~1,185 BPO voice-process rows (all none); Genpact, Accenture, Wipro and HCLTech hit the page cap.
- `profile.json` is not Prettier-formatted (inserted by hand, same style as the file).
- Next: review the new highs in the UI, label the open cases above, then add the CSV export if wanted.

## Step 11 – Final review (done)

- Full read-only review; `npm run typecheck`, `lint`, `test` pass (server 444, web 69, golden 71/71).
- Files: `docs/reviews/2026-11-23-final.md`, `docs/PROGRESS.md`. No code, recipe or data changes.
- Open: 3 High (slug path traversal can delete `profile.json`; India misclassification – "NCR" marks 37
  Philippines jobs India, "Work from anywhere" / foreign-country cities; refresh can end without
  `run-finished` so the UI stays "Refreshing…"), 10 Medium (incl. CSV export not built, wrong job closing,
  run isolation, CLI/server coordination, verify race, tokens in recipe URLs), 12 Low. Old M1–M4, L1–L3
  from the Step 7 review are still open.
- Next: builder session to fix Critical/High (then Medium) findings from `docs/reviews/2026-11-23-final.md`;
  add golden `loc-*` cases before changing location rules.

## Step 11b – Fix High findings from the final review (done)

Source: `docs/reviews/2026-11-23-final.md`. No Critical findings; all three High are fixed.

- **H1 slug path traversal.** `router.param("slug")` in `api/companies.ts` validates with `SlugSchema` (400);
  `recipes/store.ts#recipePath` also throws for an invalid slug, so no caller can leave the recipes folder.
  Tests: GET / DELETE / verify with `..%2F…` return 400 and leave the outside file alone; store-level guard.
- **H2 India classification.** `lib/location.ts` rewritten: the string is split on `| ; newline` and each part is
  judged alone (India if any part is); new `profile.foreignCountryTerms` (62 countries/regions, default `[]`;
  schema, `compile-profile.ts`, `profile.json`, ARCHITECTURE §11.6) vetoes a city or remote-region match when the
  part names another country and no India term; region terms are checked after blanking remote phrases, so
  "Work from anywhere" no longer matches "Anywhere"; a vetoed part adds no city. Golden cases added first
  (`loc-08..loc-14`, 78 total) and unit tests in `tests/lib/location.test.ts`.
- **H3 stuck "Refreshing…".** Server: an aborted run now publishes `run-finished` (status `aborted`) before
  rethrowing, so SSE ends. Web: `eventEndsRun` (also a snapshot of an ended run) triggers `refreshAfterRun`; a
  permanently closed stream also refetches the latest run; the panel shows "Connection to the server was lost"
  when the stream is closed but the run still says running (`isStreamLost`). Tests: service aborted-run event,
  `eventEndsRun`, `isStreamLost`.
- Checked: `npm run typecheck`, `lint`, `test` pass (server 460, web 72; golden 78/78).
- Files: `server/src/{types.ts,api/companies.ts,recipes/store.ts,lib/location.ts,scoring/compile-profile.ts,refresh/service.ts}`,
  `server/data/profile.json` (added `foreignCountryTerms`; re-serialized with 2-space JSON), `web/src/{api/events.ts,
  lib/refresh-progress.ts,components/RefreshPanel.tsx}`, tests and golden fixture, `docs/ARCHITECTURE.md`.
- Open / not done:
  - Existing rows in `jobs.sqlite` keep their old `is_india` (e.g. 37 Sutherland Philippines jobs) until each
    company is refreshed again; the stored location text is re-parsed only on refresh, not by profile save.
  - Medium M1–M10 and Low findings of the final review are open (CSV export not built, CORS/Origin check, job
    closing on incomplete fetches, run isolation, verify race, tokens in recipe URLs, UI mutation callbacks, …).
  - `foreignCountryTerms` is not editable on the Profile page (kept as is, like `indiaTerms`).
- Next: fix the Medium findings (start with M1 Origin/CORS, M2 closing rules, M3 run isolation, M6 CSV export).

## Step 12 – README (done)

- Wrote `README.md` (concise): setup, `npm run dev`, Refresh button, adding a company (cURL paste and
  recipe file), re-verifying (`verify:company`), fixing a broken company, editing the profile, CSV export,
  backing up `server/data/jobs.sqlite`.
- Files: `README.md`, `docs/PROGRESS.md`. No code or data changes.
- Open issues:
  - CSV export is not built: there is no `GET /api/export.csv` route (Step 11 finding M6). The README says so
    and does not describe a download that does not exist.
  - The backup steps use the `sqlite3` CLI (`.backup`). Check that it is installed on this Mac.
  - The Companies page has no delete button (API only), so the README does not mention deleting companies.
- Next: fix the Medium findings from `docs/reviews/2026-11-23-final.md`, starting with M6 (CSV export),
  then update the README's export section.

## Part 2 planned – Role tracks (not started)

- Decision (user, 2026-11-23): Option 2, role tracks. Each role has its own keywords, negatives and
  tiers, and each job has a score per role. The current profile becomes role `conversational-ai`.
  New roles: Software Engineer, Software Developer, Frontend Engineer, Backend Engineer.
- Steps R0–R6 with prompts are in `docs/STEPS.md`, under "Part 2 – Role tracks".
- Next: Step R0 (commit the current app), then Step R1 (architect, Opus 5.5 `#high`).
