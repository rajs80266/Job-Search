# India CX-AI Job Tracker

A local app that pulls open roles from company careers sites in India and ranks them against one
profile (Conversational AI, CX Agent Studio, GECX, Dialogflow CX, Agent Assist, Google CCAI and
similar). It runs on your machine only, makes no LLM calls, and refreshes when you press a button.

## Setup

Requirements: Node 20+ and npm.

```sh
npm install
```

## Run

```sh
npm run dev
```

- Web UI: http://localhost:5174 (Vite moves to the next free port if this one is taken)
- API: http://127.0.0.1:3001

The data lives in `server/data/jobs.sqlite`, created on first start.

## Refresh jobs

On the Jobs page, click **Refresh**. The panel shows progress per company, plus any errors and
warnings. Use **Full refresh** only when you want closed jobs detected for companies with paged
fetches (it switches off the early stop; the page cap still applies).

- Only companies with status `verified` or `broken` are fetched. One failing company does not stop the run.
- The first successful fetch of a company is a baseline: nothing is marked new.
- The CLI does the same: `npm run refresh`, or `npm run refresh -- --company <slug>`.

## Add a company

Only companies with a working public endpoint can be added. Start from the careers page and
run `npm run detect:ats -- <careers-url>` to see which ATS it uses.

### Option 1: paste a cURL (or fetch) from the browser

1. Open the company's job listing in Chrome, with DevTools open on the Network tab.
2. Filter by the job-list request, then right-click it and choose **Copy as cURL (bash)** (or
   **Copy as fetch**).
3. On the **Companies** page, click **Add company** and paste it.
4. Check the detected ATS, the removed headers and the editable fields (name, keywords, location).
5. Click **Test** (a dry run that writes nothing), then **Save**. Save writes the recipe as
   `unverified` and runs a real verify, so a passing company becomes `verified` in one step.

Cookies, tokens and other credential headers are dropped. Only the header names are shown, never
the values.

### Option 2: write a recipe file

Create `server/data/companies/<slug>.json` (the file name must equal `slug`). Copy the request from
a real listing call, set `"status": "unverified"`, and leave out `verifiedOn`. Then verify it (below).
The schema is `CompanyRecipeSchema` in `server/src/types.ts`; examples are in `docs/ARCHITECTURE.md` §2.

## Re-verify recipes

A recipe is refreshed only after it has passed verify. Re-verify after a site or API change:

```sh
npm run verify:company -- <slug>   # one company
npm run verify:company -- --all    # every recipe except needs-manual and disabled
```

A passing run sets `verified` and `verifiedOn`; a failing run sets `broken` (or keeps `unverified`).
Exit code is 1 if any company failed.

## Fix a broken company

1. Run `npm run verify:company -- <slug>` and read the error.
2. Check the careers page and the request in DevTools again; if the endpoint moved, update
   `server/data/companies/<slug>.json`. Then run **Verify now** on the Companies page, or the
   verify command above.
3. If the site has no usable public endpoint anymore, set `"status": "needs-manual"` with a
   `manualSearchUrl` and a short `notes` reason. Never guess URLs, tokens or endpoints.
4. Run `npm run refresh -- --company <slug>` to confirm.

## Edit the profile

The profile is `server/data/profile.json` (keywords, weights, tiers, cities, negative terms).

- Easiest: the **Profile** page. The "Effect on your jobs" preview shows the tier counts before you
  save. **Save and re-score** updates the stored jobs immediately.
- By hand: edit the file, then run `npm test`. The golden set (`server/tests/fixtures/relevance-golden.json`)
  must still pass. Stored scores update on the next refresh of each company.

## Export CSV

Not built yet. The CSV export (`GET /api/export.csv`) is specified in `docs/ARCHITECTURE.md` §7
but has no route in the code. Until it is added, copy from the Jobs table or query
`server/data/jobs.sqlite` directly.

## Back up the database

Back up with SQLite's own backup command, which is safe while the app is running (the database
uses WAL mode, so copying only `jobs.sqlite` can miss recent changes):

```sh
mkdir -p ~/Backups/job-tracker
sqlite3 server/data/jobs.sqlite ".backup '$HOME/Backups/job-tracker/jobs-$(date +%Y-%m-%d).sqlite'"
```

To restore, stop `npm run dev`, copy the backup over `server/data/jobs.sqlite`, and delete any
`jobs.sqlite-wal` and `jobs.sqlite-shm` files next to it. Then start the app again.

`server/data/jobs.sqlite` is git-ignored; the recipes and `profile.json` are tracked in git.

## Tests and checks

```sh
npm run typecheck && npm run lint && npm test
```

## More

- `AGENTS.md` – project rules (cost, accuracy, fetching etiquette)
- `docs/ARCHITECTURE.md` – contracts, adapters, API, scoring
- `docs/PROGRESS.md` – step log and open issues
