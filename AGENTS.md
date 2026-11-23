# India CX-AI Job Tracker – Project Rules

Local app that pulls the latest job openings from company careers sites in India and ranks them
against one profile: Conversational AI, CX Agent Studio, GECX, Dialogflow CX, Agent Assist, Google
CCAI and similar roles.

Read `docs/PROGRESS.md` first in every session. It is the hand-off between steps. Do not rely on
chat history from other sessions.

## Stack

- npm workspaces: `server/` (Node 20+, TypeScript, Express, better-sqlite3, zod, vitest) and
  `web/` (React, TypeScript, Vite, TanStack Query, Tailwind).
- SQLite (`server/data/jobs.sqlite`) is the source of truth. CSV is export-only.
- Runs on localhost only. No auth, no cloud, no scheduler – refresh is a manual button.

## Cost rules (the app itself)

- No LLM calls at runtime. Relevance scoring is deterministic (keywords + weights in
  `server/data/profile.json`). Running the app costs nothing.
- Fetch only what is needed: use the ATS's own keyword/location filters where available, cap
  pages, and stop paging when known job IDs are reached.

## Accuracy rules

- A company entry is `verified` only after a live test call returned parseable jobs
  (`npm run verify:company -- <slug>`). Never mark it verified by reasoning alone.
- Never invent careers URLs, board tokens, Workday facet IDs or API endpoints. If not found,
  set `status: "needs-manual"` with a `manualSearchUrl` and a short `notes` reason.
- Every adapter has tests against a saved real response in `server/tests/fixtures/`.
- Relevance scoring must pass the golden set in `server/tests/fixtures/relevance-golden.json`.

## Fetching etiquette

- Only read job listings. Allowed: GET, and the POST "search" calls that ATS job boards
  themselves use for listing (e.g. Workday `/jobs`). Never submit applications or forms.
- Max 1 request/second per host, 15 s timeout, 2 retries with backoff, identify with a normal
  User-Agent. One failing company must never stop a refresh.
- Do not scrape LinkedIn, Naukri, Indeed, Glassdoor or Instahyre. Only generate prefilled search
  links for them.
- Never store cookies, session tokens or personal credentials in the repo.

## Code standards

- Clear names over comments; comment only non-obvious business rules or workarounds.
- One adapter per ATS in `server/src/adapters/`, all returning `NormalizedJob` from
  `server/src/types.ts`. Company specifics live in data files, not in `if (name === ...)` code.
- No duplicated logic – extract shared helpers (HTTP client, pagination, location parsing).
- Typecheck, lint and tests must pass before a step is considered done:
  `npm run typecheck && npm run lint && npm test`.

## Data layout

- `server/data/companies/<slug>.json` – one file per company (fetch recipe, status, verifiedOn).
- `server/data/profile.json` – keywords, weights, cities, excluded terms.
- `docs/COMPANY_SEED.md` – candidate company list (input for research).
- `docs/ARCHITECTURE.md` – contracts and decisions (written in Step 1).

## End of every step

Append to `docs/PROGRESS.md`: step number, what was done, files touched, open issues, and the
exact next step. Keep it short.
