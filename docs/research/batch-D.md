# Batch D research (BPO and CX services running CCAI programs)

Run on 2026-11-21. Result: **10 verified, 4 needs-manual** (14 companies).

Jobs = count on the first page from `verify:company` (no keywords, one page), not the full board size. Sample titles are from that unfiltered first page, so they are not relevance-checked.

| company | ATS | status | jobs returned | sample titles (first page, unfiltered) | notes |
|---|---|---|---|---|---|
| Concentrix | workday | verified | 20 | Specialist, FAO; Analyst, Real Time Management | Workday `cnx` / `external_global`. India facet `locationCountry` (86 jobs). |
| Conduent | generic | verified | 50 | – | Phenom People: public POST `careers.conduent.com/widgets` (refineSearch), `selected_fields.country=India` → 169 India jobs. Re-checked 2026-11-21. |
| EXL | oracle-hcm | verified | 25 | Manager; Senior Executive | Oracle HCM site `CX_2` (from detect:ats). Covers the whole site, not India only. |
| Firstsource | successfactors | verified | 25 | – | Real site `careers.firstsource.com` (linked from `/careers/job-opening`), HTML search with `locationsearch=India` → 59 jobs. |
| Foundever | successfactors | verified | 10 | – | Real career site is `jobs.foundever.com` (SuccessFactors table layout), India filter `locationsearch=India` (25 jobs). Re-checked 2026-11-21. |
| HGS | generic | verified | 8 | – | Real career site is `careers.joinhgs.com`; POST `/services/recruiting/v1/jobs` with `brand: "India"` returns the 8 India jobs. Re-checked 2026-11-21. |
| IBEX | manual | needs-manual | – | – | React app on headless WordPress; careers cover Pakistan, Jamaica, Nicaragua (no India page); no job endpoint in the JS bundle. |
| Infosys BPM | manual | needs-manual | – | – | Careers page returns 403 to automated requests. |
| Movate | manual | needs-manual | – | – | Simple Job Board plugin, HTML cards only; `/wp-json` needs auth. `manualSearchUrl` now the site's India filter. |
| Sutherland | generic | verified | 438 | – | Shazamme: the site's public GET `shazamme.io/Job-Listing/src/php/actions?dudaSiteID=76755cce&action=Get Jobs` returns all jobs (3 MB, 51 India) with descriptions. |
| TaskUs | workday | verified | 20 | – | `jobs.taskus.com` lists Workday jobs: tenant `taskus`, site `Careers`, India facet `locationCountry` (140 jobs). |
| Teleperformance | generic | verified | 100 | – | tp.com's public GET `/Umbraco/Api/Careers/GetCareersBase?node=1780&country=India` (Workday-sourced, ~1,190 India jobs, 100/page). |
| TTEC | manual | needs-manual | – | – | Careers page returns 403 to automated requests. |
| WNS | smartrecruiters | verified | 69 | – | `wnscareers.com/global-location/india` links SmartRecruiters company `WNSGlobalServices144`; `country=in`. |

## Checks run

- `detect:ats` on all 14 careers URLs. For the 12 without an endpoint, a second attempt checked the homepage for careers links and ran `detect:ats` on the new URL where one was found (Conduent, HGS, Movate, Sutherland, Teleperformance, WNS), plus a check of the SuccessFactors hosts linked from Foundever and HGS.
- Concentrix India facet: `locationCountry` = `c4f78be1a8f14da0ab49ce1162348a5e`, read from the unfiltered Workday listing.
- `verify:company` passed for Concentrix and EXL on the first attempt.
- `npm test`: 24 files, 307 tests pass (includes the recipe-schema test).

## Follow-ups

- EXL's recipe has no India filter (the site covers all countries), so the first page is mixed. Scoring handles location, but the India location id could narrow the fetch if EXL's volume becomes a problem.
- Samples are unfiltered; relevance is not confirmed until the first refresh.
- BPO boards are mostly operations roles, so few are likely to match the CCAI keywords. Expect low counts for Concentrix and EXL.
- Four companies still need a manual check: IBEX, Infosys BPM (403), Movate and TTEC (403). Eight were fixed on 2026-11-21 by following redirects and the sites' own search calls (Conduent, Firstsource, Foundever, HGS, Sutherland, TaskUs, Teleperformance, WNS).
