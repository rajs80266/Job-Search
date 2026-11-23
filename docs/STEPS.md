# Build Steps – India CX-AI Job Tracker

How to use this file:

1. Open OpenCode in this folder and start a **new session for every step**. This keeps context
   small, which is the biggest cost saver.
2. Select the agent and model listed for the step, then paste the prompt.
3. Each step ends by updating `docs/PROGRESS.md`. The next session reads it, so you never need
   to paste old chat history.
4. Don't start a step until the previous step's "Done when" is true.

## Models and when to use them

Prices are per 1M input/output tokens on Amazon Bedrock.

| Model | ID | Price | Use for |
|---|---|---|---|
| Claude Opus 5.5 | `amazon-bedrock/global.anthropic.claude-opus-5-5` | $4 / $20 (cache read $0.20) | Decisions that are expensive to get wrong: architecture, scoring rules, reviews. Short outputs. |
| Claude Sonnet 5.5 | `amazon-bedrock/global.anthropic.claude-sonnet-5-5` | $2 / $10 (cache read $0.10) | Main coding: server, adapters, API, UI, debugging. |
| Claude Haiku 5.5 | `amazon-bedrock/global.anthropic.claude-haiku-5-5` | $0.10 / $0.50, or $0.50 / $2.50 above 100k context | High-volume repetitive work: company research batches, follow-a-pattern adapters, docs. |
| Qwen3 Coder Next (optional) | `amazon-bedrock/qwen.qwen3-coder-next` | $0.50 / $1.20 | Optional cheap alternative to Haiku for boilerplate. Check its output carefully. |
| GPT-6.2 Sol (optional) | `amazon-bedrock/us.openai.gpt-6.2-sol` | $2.20 / $11 | Optional second-opinion reviewer from a different model family, for Step 11 only. |

Rules of thumb:

- **Opus thinks, Sonnet builds, Haiku repeats.**
- Effort variant: use `#low` for scaffolding, `#medium` for normal coding, and `#high` only for
  architecture and reviews.
- Escalate when stuck: Haiku → Sonnet after 2 failed tries, and Sonnet → Opus only for a design
  or root-cause question, not for writing code.
- The app itself makes **no LLM calls**, so running it costs nothing.

## Agents

| Agent file | Default model | Writes |
|---|---|---|
| `.opencode/agents/architect.md` | Opus 5.5 `#high` | `docs/**`, `server/src/types.ts`, `server/data/profile.json`, golden set |
| `.opencode/agents/builder.md` | Sonnet 5.5 `#medium` | All code |
| `.opencode/agents/company-researcher.md` | Haiku 5.5 `#medium` | `server/data/companies/**`, `docs/research/**` |
| `.opencode/agents/reviewer.md` | Opus 5.5 `#high` | `docs/reviews/**` only (read-only for code) |

To run the builder on a cheaper model for one step, keep the builder agent and switch the model
in the model picker for that session.

---

## Step 1 – Architecture and contracts

**Agent:** architect | **Model:** Opus 5.5 `#high` | **Cost:** low (mostly reading and short docs)

```text
Read AGENTS.md, docs/PROGRESS.md and docs/COMPANY_SEED.md.

Write docs/ARCHITECTURE.md and server/src/types.ts for the India CX-AI job tracker. Cover:
1. NormalizedJob type: id (stable hash of companySlug + externalId), companySlug, externalId,
   title, url, locationRaw, cities[], isIndia, isRemote, postedAt (ISO or null), firstSeenAt,
   lastSeenAt, descriptionSnippet (max 1000 chars), relevanceScore, relevanceTier
   (high/medium/low/none), matchedKeywords[].
2. CompanyRecipe JSON schema (zod), one file per company in server/data/companies/<slug>.json:
   slug, name, category (google-partner | cx-vendor | india-ai | bpo | product-bfsi), careersUrl,
   ats (greenhouse | lever | ashby | smartrecruiters | workable | workday | eightfold | oracle-hcm |
   successfactors | google-careers | generic | manual), fetch {url, method, headers, body,
   pagination}, fieldMap (for generic), filters {keywords[], location}, manualSearchUrl,
   status (verified | needs-manual | broken | disabled), verifiedOn, lastError, notes.
3. Adapter interface: fetchJobs(recipe, ctx) -> AsyncIterable<NormalizedJob-without-scores>,
   with paging caps and early stop when known IDs are reached.
4. SQLite schema: companies, jobs, job_status (saved | applied | interviewing | rejected |
   ignored, notes, updatedAt), refresh_runs, refresh_company_results.
5. Refresh flow: per-company isolation, rate limit 1 req/s per host, 15 s timeout, 2 retries,
   progress reporting to the UI via Server-Sent Events.
6. "New" definition: firstSeenAt after the previous successful refresh of that company.
   Jobs missing from later fetches are marked closed (closedAt), not deleted.
7. REST API shapes: GET /api/jobs (filters, pagination), PATCH /api/jobs/:id/status,
   POST /api/refresh, GET /api/refresh/:runId/events (SSE), CRUD /api/companies,
   POST /api/companies/import-curl, POST /api/companies/:slug/verify, GET/PUT /api/profile,
   GET /api/export.csv, GET /api/stats.
8. CLI scripts: detect:ats <url>, verify:company <slug>, refresh [--company slug].
9. Folder structure, and test strategy using fixtures and the golden set.

Keep it to the simplest design that meets these needs. List open questions at the end.
Update docs/PROGRESS.md with "Next: Step 2".
```

**Done when:** `docs/ARCHITECTURE.md` and `server/src/types.ts` exist, and you have answered
the open questions.

---

## Step 2 – Profile and relevance golden set

**Agent:** architect | **Model:** Opus 5.5 `#high` | **Cost:** low

Before running this step, fill in the `<...>` placeholders in the prompt with your own details.

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md.

My profile: <years of experience>, target levels <e.g. Senior Engineer / Lead / Architect /
Consultant>, preferred cities <e.g. Bengaluru, Hyderabad, Pune, Remote-India>, open to <relocation yes/no>.

1. Create server/data/profile.json with:
   - core keywords (weight 10 in title, 4 in description): Conversational AI, CX Agent Studio,
     GECX, Gemini Enterprise for CX, Customer Engagement Suite, Dialogflow CX, Dialogflow ES,
     Dialogflow, Agent Assist, CCAI, Contact Center AI, CCAI Platform, Conversational Insights,
     Conversational Agents, Vertex AI Agent Builder, virtual agent, voicebot, chatbot, IVR.
   - adjacent keywords (lower weight): Genesys, NICE CXone, Five9, Amazon Connect, Lex,
     Twilio Flex, Kore.ai, Yellow.ai, Rasa, NLU, LLM agents, RAG, prompt engineering, contact center.
   - synonyms and spelling variants (e.g. "Dialog flow", "CCAI-P", "conversational designer").
   - negative terms that lower the score (e.g. "sales", "inside sales", "BPO voice process",
     "customer support executive", "telecaller") so non-engineering CX jobs are excluded.
   - tier thresholds for high, medium and low.
   - India cities with aliases (Bangalore=Bengaluru, Gurgaon=Gurugram, NCR, etc.).
2. Create server/tests/fixtures/relevance-golden.json with 60 realistic labeled examples
   (title + short description + location -> expected tier and isIndia). Include tricky cases:
   "Customer Support Executive – Voice", "Conversational Designer", "Genesys Engineer",
   "Chatbot Developer", "AI Engineer – Contact Center", "Agent Assist Specialist (non-tech)",
   US-only roles, "Remote – APAC".
3. Document the scoring algorithm in docs/ARCHITECTURE.md (section "Relevance").

Update docs/PROGRESS.md with "Next: Step 3".
```

**Done when:** you have checked 10 or more of the golden labels and agree with them.

---

## Step 3 – Scaffold the project

**Agent:** builder | **Model:** Sonnet 5.5 `#low` (or Haiku 5.5 `#high` to save more) | **Cost:** low

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md (folder structure section only).

Scaffold the project:
- Root package.json with npm workspaces server/ and web/, and root scripts: dev (runs both),
  typecheck, lint, test, refresh, detect:ats, verify:company.
- server/: TypeScript (strict), Express, better-sqlite3, zod, vitest, tsx for dev, eslint, prettier.
- web/: Vite React TypeScript, Tailwind, TanStack Query, React Router, eslint, prettier.
- A /api/health endpoint, and a web page that calls it.
- .gitignore (node_modules, server/data/jobs.sqlite, .env) and git init.

Do not implement features yet. Run npm install, then typecheck, lint and test, and fix until
they pass. Update docs/PROGRESS.md with "Next: Step 4".
```

**Done when:** `npm run dev` shows the health check on the web page.

---

## Step 4 – Core server (DB, HTTP client, scoring, refresh engine, CLI tools)

**Agent:** builder | **Model:** Sonnet 5.5 `#medium` | **Cost:** medium

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md.

Implement in server/src:
1. db/: schema and migrations, plus typed query functions for companies, jobs, job_status and
   refresh runs.
2. lib/http.ts: fetch wrapper with per-host rate limit (1 req/s), 15 s timeout, 2 retries with
   backoff, and a normal User-Agent. No cookies.
3. lib/location.ts: parse locationRaw to cities[], isIndia and isRemote using the city aliases
   in profile.json.
4. scoring/relevance.ts: deterministic scoring from profile.json. It must pass every case in
   tests/fixtures/relevance-golden.json; write that test first.
5. recipes/: load and validate server/data/companies/*.json with zod.
6. refresh/service.ts: run all or one company with per-company isolation; upsert jobs, set
   firstSeenAt, lastSeenAt and closedAt; record refresh_company_results; emit progress events.
7. Adapter registry with ONE adapter for now: greenhouse (public boards API). Test it against
   a fixture.
8. CLI scripts:
   - detect:ats <url>: fetch the page and detect the ATS from URLs and markers in the HTML
     (greenhouse, lever, ashby, smartrecruiters, workable, myworkdayjobs, eightfold,
     oraclecloud, successfactors). Print the ATS and candidate API URL.
   - verify:company <slug>: run the recipe live and print the job count and 3 sample titles.
     Only on success, set status=verified and verifiedOn=today; on failure, write lastError.
   - refresh [--company slug].

Unit-test location, scoring, dedup/new/closed logic and the greenhouse adapter.
typecheck, lint and test must pass. Update docs/PROGRESS.md with "Next: Step 5".
```

**Done when:** all tests pass, including the golden set.

---

## Step 5 – Remaining ATS adapters

Split this step to save cost:

- **5a:** builder, Sonnet 5.5 `#medium`: workday, eightfold, oracle-hcm, successfactors,
  google-careers, generic. These have tricky POST bodies, paging and field mapping.
- **5b:** builder, Haiku 5.5 `#high`: lever, ashby, smartrecruiters, workable. These are simple
  public JSON APIs that follow the greenhouse pattern.

```text
Read AGENTS.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (adapter section) and
server/src/adapters/greenhouse.ts as the reference pattern.

Implement these adapters: <list for 5a or 5b>.
For each adapter:
- Use the ATS's own keyword and India location filters when supported.
- Cap pages (from recipe.fetch.pagination) and stop early when known IDs are reached.
- Map to NormalizedJob, with absolute job URLs and ISO postedAt when available.
- Save one small real response as server/tests/fixtures/<ats>.json, fetched from a public
  board via the verify script or a one-off fetch. Strip it to 3 to 5 jobs. Do not invent
  fixture data.
- Write a test using that fixture.
The generic adapter handles custom JSON APIs using recipe.fieldMap (dot paths), like
the original index.js getValue logic.
Register all adapters. typecheck, lint and test must pass. Update docs/PROGRESS.md.
```

**Done when:** every ATS has an adapter with a passing fixture test.

---

## Step 6 – Company research (one batch per session)

**Agent:** company-researcher | **Model:** Haiku 5.5 `#medium` | **Cost:** very low per company

Run one session per batch, A to E, from `docs/COMPANY_SEED.md`. You can run 2 or 3 batches in
parallel in separate sessions.

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md (CompanyRecipe section).

Research Batch <A|B|C|D|E> from docs/COMPANY_SEED.md, companies in A-Z order.
For each company follow your agent instructions: find the official careers page, run
detect:ats, write server/data/companies/<slug>.json, then run verify:company.
Use India location filters and profile keywords where the ATS supports them.
Max 2 attempts per company, then mark it needs-manual with a manualSearchUrl and a reason.
Write docs/research/batch-<X>.md with the summary table. Update docs/PROGRESS.md.
```

**Escalation:** for companies left `needs-manual` that matter to you (large Workday, Oracle or
custom sites), start a builder session on Sonnet 5.5 `#medium` with this prompt:

```text
Read AGENTS.md, docs/PROGRESS.md and server/data/companies/<slug>.json.
Find a working public job-listing endpoint for <company> (inspect the careers page network
requests via its HTML/JS bundle). Update the recipe and run verify:company. Do not use cookies or
session tokens. If no stable public endpoint exists, keep needs-manual and improve manualSearchUrl.
```

**Done when:** every seed company is either `verified` or `needs-manual` with a reason.

---

## Step 7 – Data and adapter review

**Agent:** reviewer | **Model:** Opus 5.5 `#high` | **Cost:** low to medium

```text
Read AGENTS.md and docs/PROGRESS.md. Review:
1. server/src/adapters/** and server/src/refresh/** for correctness, early-stop logic,
   paging caps, rate limiting and failure isolation.
2. A sample of 15 server/data/companies/*.json recipes (all ats types, all statuses) for
   invented endpoints, missing India filters, wrong status, or verified without verifiedOn.
3. Run `npm test`. Check relevance-golden results and list any false positives or negatives.
Write docs/reviews/<date>-data-adapters.md. Report the top findings only.
```

Then run a **builder, Sonnet 5.5 `#medium`** session to fix the findings:

```text
Read AGENTS.md, docs/PROGRESS.md and docs/reviews/<file>.md. Fix all Critical and High findings,
add tests for each, and run typecheck, lint and test. Update docs/PROGRESS.md.
```

---

## Step 8 – REST API

**Agent:** builder | **Model:** Sonnet 5.5 `#medium` | **Cost:** medium

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md (API section).

Implement every API route in docs/ARCHITECTURE.md with zod validation:
jobs list (filters: q, company, category, tier, city, status, isNew, includeClosed, sort,
pagination), job status/notes update, refresh start plus SSE progress, companies CRUD,
import-curl (parse a pasted cURL or "Copy as fetch" into a recipe draft, stripping cookies and
auth headers), verify company, profile get/put (re-score existing jobs on save, with no
re-fetch), CSV export (proper quoting), stats (new per day, per company, status funnel).
Add supertest tests for each route. typecheck, lint and test must pass. Update docs/PROGRESS.md.
```

---

## Step 9 – React UI

**Agent:** builder | **Model:** Sonnet 5.5 `#medium` | **Cost:** medium to high (the largest build step)

To control cost, split this into 9a (Jobs page and Refresh), 9b (Companies, Add company,
Manual-check list) and 9c (Dashboard and Profile), with one session each.

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md (API section). Load the
ce-frontend-design skill.

Build <9a | 9b | 9c> in web/:
9a Jobs page: table with title, company, city, tier badge, matched keywords, posted, first
   seen, status. Filters as in the API, a "New" toggle, search, row actions (open, save,
   applied, ignore, notes drawer). Refresh button with a live per-company progress panel
   (SSE) and an error list.
9b Companies page: list with category, ATS, status, last fetch, job count, enable/disable and
   Verify now. "Add company" flow: paste a cURL/fetch -> preview the parsed recipe -> test ->
   save. "Check manually" section listing needs-manual companies and job-board links
   (LinkedIn/Naukri/etc. prefilled with profile keywords + India).
9c Dashboard: new roles per day, top companies, application funnel. Profile page: edit
   keywords, weights, cities and negative terms, with a live preview of how tiers change.
Use clean, dense, accessible UI. Handle loading, empty and error states.
typecheck, lint and test must pass. Check it in the browser. Update docs/PROGRESS.md.
```

---

## Step 10 – End-to-end run and accuracy tuning

**Agent:** builder | **Model:** Sonnet 5.5 `#medium` | **Cost:** low to medium

```text
Read AGENTS.md and docs/PROGRESS.md. Run a full refresh (npm run refresh) and then:
1. Report: companies succeeded/failed, total jobs, jobs per tier, India vs non-India.
2. List the top 30 high/medium jobs and 30 random "none"/"low" jobs whose titles contain
   AI, bot, conversational, contact center or CX. These are possible false negatives.
3. Propose profile.json changes to fix wrong tiers. Add each corrected case to
   relevance-golden.json, and only then change the weights/keywords until the golden set passes.
4. Fix any failing company recipes (or mark them broken with a reason).
Update docs/PROGRESS.md with results.
```

Show me the lists in item 2. If the tiers look wrong in ways that are hard to fix, ask the
**architect on Opus 5.5** to redesign the scoring with this prompt:
`Read the Step 10 results in docs/PROGRESS.md and propose scoring changes`.

---

## Step 11 – Final review

**Agent:** reviewer | **Model:** Opus 5.5 `#high`. You can also run the same prompt once on
GPT-6.2 Sol for a second opinion. | **Cost:** low to medium

```text
Read AGENTS.md and docs/PROGRESS.md. Do a full review of the repository: correctness, accuracy
of India/relevance classification, refresh resilience, API validation, UI error handling, CSV
export quoting, any runtime LLM or unnecessary network cost, secrets/cookies in the repo, and
AGENTS.md rule violations. Run typecheck, lint and test.
Write docs/reviews/<date>-final.md ranked by severity. Report the top findings only.
```

Then run a **builder, Sonnet 5.5** session to fix the findings, using the fix prompt from Step 7.

---

## Step 12 – README and maintenance guide

**Agent:** builder | **Model:** Haiku 5.5 `#medium` | **Cost:** very low

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md. Write README.md covering: setup,
npm run dev, using the Refresh button, adding a company (cURL paste and recipe file), re-verifying
recipes (verify:company), fixing a broken company, editing the profile, exporting CSV, and
backing up server/data/jobs.sqlite. Keep it concise. Update docs/PROGRESS.md.
```

---

# Part 2 – Role tracks (add your own roles)

**Goal:** add roles from the UI without code changes. Each role is its own track with its own
keywords, negative terms and tiers, and every job gets a score for each role. The existing
Conversational AI profile becomes the first role, `conversational-ai`, and must behave exactly
as it does today. The first new roles are Software Engineer, Software Developer, Frontend
Engineer and Backend Engineer.

**Why this needs care:**

- **Volume:** software-engineering titles are 10 to 50 times more common than CCAI titles.
  Search terms and page caps decide how many requests each refresh makes.
- **Overlap:** Software Engineer and Software Developer are close to synonyms, and both overlap
  Frontend and Backend. A job can match several roles.
- **Seniority:** for generic titles, the level matters more than for CCAI roles. Your profile is
  5–8 years, so Senior, Lead and Staff count, and intern, fresher and junior do not.
- **"New" flooding:** a new search term finds thousands of jobs on its first refresh, and they
  must not all show as "New".
- **Company list:** the seed list was chosen for CX-AI, so many strong software employers in
  India are missing. Step R6 is optional for that.

**Estimated cost of Part 2:** about $20–32, or about $24–37 with R6.

## Step R0 – Commit the current app (you, no model)

```sh
git add -A && git commit -m "feat: India CX-AI job tracker v1"
```

**Done when:** `git status` is clean. Every R-step can then be reviewed with `git diff` and
rolled back.

---

## Step R1 – Design role tracks

**Agent:** architect | **Model:** Opus 5.5 `#high` | **Cost:** about $1.5–2

```text
Read AGENTS.md, docs/PROGRESS.md, docs/ARCHITECTURE.md (§2, §4, §5, §6, §7, §11) and
server/src/types.ts.

Design "role tracks" so the user can add, edit and disable roles from the UI with no code change.
The current profile becomes role "conversational-ai" and must keep identical scores and tiers
(golden 78/78). The first new roles are: Software Engineer, Software Developer, Frontend Engineer,
Backend Engineer. The candidate has 5-8 years of experience (targets Senior / Lead / Consultant).

Decide and document:
1. Files: shared settings (cities, India/remote/foreign-country terms, generic role words) vs
   server/data/roles/<id>.json: id, name, enabled, searchTerms (sent to careers sites), core and
   adjacent concepts, roleTerms (if they differ per role), negativeTerms, seniority rules, tiers.
   A migration that splits profile.json with no change in behaviour.
2. Seniority: how a role prefers levels (e.g. senior/lead/staff bonus, intern/fresher/junior/
   graduate penalty) and how it reads experience text in the description ("3+ years"), kept
   deterministic.
3. Overlap: Software Engineer vs Software Developer (separate roles, or one role with aliases? 
   recommend one and say why). A job can score in several roles; define its "best role/tier".
4. Search terms and cost: company filters.keywords becomes an optional override; default = the
   union of enabled roles' searchTerms, deduped. Set a total cap and a per-term page cap for
   high-volume terms. Estimate requests per refresh before/after for the 26 keyword-filtered
   recipes. Prefer few broad terms ("Software Engineer" also finds "Senior Software Engineer").
   Lever/Ashby/Workable/Greenhouse fetch everything and need no terms.
5. DB migration v2: job_scores(job_id, role_id, score, tier, matched_json, PK(job_id, role_id)),
   move current scores to "conversational-ai" with no data loss; keep or drop the jobs score
   columns (decide); indexes for "best tier" sorting; job_status stays per job (not per role).
6. "New" rule: jobs first fetched because of a newly added search term or a new role are a
   baseline for that role, not New. Define it exactly.
7. Rescore: per role and all roles; share tokenization across roles (today's dry run is 1.8 s
   for 3,200 jobs with one role; the job count may grow to 10-20k).
8. API: GET/POST/PUT/DELETE /api/roles[/:id] with ?dryRun=true (tier counts before/after and the
   top 20 matched stored jobs), role filter on GET /api/jobs (one role or "best"), per-role
   GET /api/stats, PUT /api/profile limited to shared settings. Job-board links take a role.
9. Golden sets: server/tests/fixtures/golden/<role-id>.json; a role without one is allowed but
   shown as "untested". The test runs every golden file it finds.
10. UI: Roles page, role switcher on Jobs and Dashboard, role chips per job (short list only;
    the builder designs the details).

Update docs/ARCHITECTURE.md (new section "Role tracks", plus changes in §2, §4, §6, §7, §11)
and server/src/types.ts. List open questions at the end; I will answer them in this session.
Update docs/PROGRESS.md with "Next: Step R2a".
```

**Done when:** the "Role tracks" section exists and you have answered the open questions.

---

## Step R2a – Server: roles data, migration and scoring

**Agent:** builder | **Model:** Sonnet 5.5 `#medium` | **Cost:** about $4–6

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md ("Role tracks" and the sections it
changed). Work only on R2a; the API is R2b.

Implement:
1. Split server/data/profile.json into shared settings + server/data/roles/conversational-ai.json
   (exact same values), with the loader, zod validation and a store (read/write/delete role files,
   id validated like slugs – no path traversal).
2. DB migration v2 (job_scores and the decided column changes) with a test on a copy of a v1 DB:
   every job keeps its score/tier/matches under "conversational-ai", and job_status is untouched.
3. Scoring per enabled role, sharing tokenization across roles; seniority rules; "best role/tier".
   Refresh, normalize, boilerplate and rescore use it.
4. Search-term resolution: recipe override or the enabled roles' union, with the caps from the
   design. Remove filters.keywords from recipes whose list only repeats the old default; keep
   real overrides. Every changed recipe still passes the recipe-schema test.
5. The "New" baseline rule for new search terms and new roles, with tests.
6. Move the golden set to server/tests/fixtures/golden/conversational-ai.json; the test runs
   every golden file and must still pass 78/78.
7. Update AGENTS.md "Data layout" and the project description (not CX-AI only any more).

typecheck, lint and test must pass. Do not run a live refresh in this step. Update
docs/PROGRESS.md with "Next: Step R2b".
```

**Done when:** all tests pass, golden is 78/78, and the migration test shows no data loss.

---

## Step R2b – Server: roles API and role-aware jobs and stats

**Agent:** builder | **Model:** Sonnet 5.5 `#medium` | **Cost:** about $3–4

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md ("Role tracks", §7).

Implement the API from the design:
- GET/POST/PUT/DELETE /api/roles[/:id] with zod validation; ?dryRun=true returns tier counts
  before/after and the top 20 matched stored jobs, and writes nothing. Saving re-scores stored jobs
  for that role only, in one transaction with the file write; 409 while a refresh runs.
  DELETE removes the role's scores, never jobs or job_status.
- The response for a new or changed role includes the extra requests per refresh that its search
  terms cause (from the design's estimate rule).
- GET /api/jobs: role filter (one role id or "best"); each job returns its per-role tiers.
- GET /api/stats: per role or best. PUT /api/profile: shared settings only.
- Job-board link data uses the chosen role's searchTerms.
supertest tests for every route, including path traversal on :id, dryRun writing nothing, and the
409 during a refresh. typecheck, lint and test must pass. Update docs/PROGRESS.md with "Next: Step R3a".
```

---

## Step R3a – UI: Roles page

**Agent:** builder | **Model:** Sonnet 5.5 `#medium` | **Cost:** about $3–5

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md ("Role tracks", roles API). Reuse the
existing Profile page editors (web/src/components/profile/) instead of writing new ones.

Build a Roles page (nav item):
- List: name, enabled, untested/tested badge, open India jobs per tier, search terms.
- "Add role": type a role name -> prefilled draft (name and spelling variants as a core concept,
  the name as a search term, the default seniority rules) -> edit -> live preview (dryRun: tier
  counts and the top 20 stored jobs it would match, plus the extra requests per refresh) -> Save.
- Edit, enable/disable and delete (confirm) a role. Delete explains that jobs and statuses are kept.
- The Profile page keeps only the shared settings (cities, preferred cities, weights if shared).
Loading, empty and error states. typecheck, lint and test must pass (add unit tests for draft and
validation logic). Check it in the browser. Update docs/PROGRESS.md with "Next: Step R3b".
```

---

## Step R3b – UI: role switcher on Jobs and Dashboard

**Agent:** builder | **Model:** Sonnet 5.5 `#medium` | **Cost:** about $3–4

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md (roles API, jobs/stats role filter).

- Jobs page: a role switcher ("Best match" plus each enabled role), kept in the URL like the other
  filters. The tier badge and sort follow the selected role; each row shows small chips for the
  other roles the job matches (medium or higher).
- Dashboard: the same switcher; tier strip, new per day and top companies follow it.
- Check manually: job-board links use the selected role's search terms.
Keep the existing default view for "conversational-ai" users unchanged. typecheck, lint and test
must pass. Check it in the browser. Update docs/PROGRESS.md with "Next: Step R4a".
```

---

## Step R4 – Add the software roles, refresh and set accuracy (two sessions)

**Agent:** builder | **Model:** Sonnet 5.5 `#medium` | **Cost:** about $2–3 per session

- **R4a:** Software Engineer and Software Developer, or the single merged role if R1 chose that.
- **R4b:** Frontend Engineer and Backend Engineer.

```text
Read AGENTS.md, docs/PROGRESS.md and docs/ARCHITECTURE.md ("Role tracks").

Roles for this session: <R4a: Software Engineer, Software Developer | R4b: Frontend Engineer,
Backend Engineer>.
1. Create them through the API (same path as the UI): concepts with aliases (e.g. SDE, SWE,
   "Full Stack" only where it belongs; Frontend: React, Angular, UI Engineer; Backend: Java,
   Node.js, Go, Python backend, microservices, API), negative terms (QA/test-only, support,
   intern, fresher, sales engineer where wrong), seniority for 5-8 years, search terms within the cap.
2. Show me the dryRun preview, then save and run `npm run refresh`. Report: requests made,
   duration, jobs per tier per role, and anything that hit page caps or timeouts.
3. List the top 30 high/medium jobs and 30 near-misses (low/none whose title has engineer,
   developer, frontend, backend, SDE, full stack) per role. I will label 20-30 per role.
4. Write my labels to server/tests/fixtures/golden/<role-id>.json first, then tune the role until
   its golden set passes. The conversational-ai golden set must still pass 78/78.
typecheck, lint and test must pass. Update docs/PROGRESS.md.
```

**Done when:** every new role has a golden set that passes, and the refresh time is acceptable
to you.

---

## Step R5 – Review role tracks

**Agent:** reviewer | **Model:** Opus 5.5 `#high` | **Cost:** about $2–3, plus about $1–2 for fixes

```text
Read AGENTS.md and docs/PROGRESS.md. Review the role-tracks change (git diff since the v1
commit): migration safety and rollback, per-role score correctness and "best tier", seniority
rules, search-term caps and request cost per refresh, the "New" baseline rule, golden sets for all
roles, roles API validation (id path traversal, dryRun writes nothing, 409 during refresh), UI
role switcher and URL state, and rule violations in AGENTS.md. Run typecheck, lint and test.
Write docs/reviews/<date>-roles.md ranked by severity. Report the top findings only.
```

Then run a **builder on Sonnet 5.5 `#medium`** to fix the findings:

```text
Read AGENTS.md, docs/PROGRESS.md and docs/reviews/<date>-roles.md. Fix all Critical and High
findings, add tests for each, and run typecheck, lint and test. Update docs/PROGRESS.md.
```

---

## Step R6 (optional) – Companies for the software roles

Two sessions:

- **R6a:** architect, **Opus 5.5 `#medium`**, about $0.5–1, to build the list.
- **R6b:** company-researcher, **Haiku 5.5 `#medium`**, about $3–5, to research it. Use one
  session per batch of about 10 companies.

R6a prompt:

```text
Read AGENTS.md, docs/PROGRESS.md and docs/COMPANY_SEED.md. Add a "Batch F – Software
engineering employers in India" section (A-Z, about 40 names) with strong India engineering
centres that hire Senior/Lead Software, Frontend and Backend engineers (product companies, GCCs,
well-funded startups). Skip companies already in server/data/companies/. Mark it UNVERIFIED.
Update docs/PROGRESS.md.
```

R6b prompt: the Step 6 prompt with `Batch F`. Use at most about 10 companies per session so the
context stays under 100k, where Haiku is cheaper.

---

## Maintenance later (monthly)

- **Haiku 5.5 company-researcher:** `Run verify:company for all recipes. Re-research only
  the broken ones (max 2 attempts each) and update docs/research/maintenance-<date>.md.`
- **Haiku 5.5 company-researcher:** `Research these new companies: <list>.`

## Cost-saving checklist

- Start a new session per step. Don't continue a long session into the next step.
- Point the model at specific files and sections, never "read the whole repo".
- Use Opus only for Steps 1, 2, 7 and 11 (and optional scoring redesign). It mostly reads and
  writes short docs.
- Use Haiku for research (Step 6), simple adapters (5b), docs (12) and maintenance.
- If a Haiku session fails twice on the same thing, switch that session to Sonnet instead of
  retrying.
- Keep fixtures small (3 to 5 jobs) so tests and context stay small.
