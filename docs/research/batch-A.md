# Batch A research (Google and Google Cloud partners)

Run on 2026-11-21. Result: **8 verified, 16 needs-manual** (24 companies).

Jobs = count on the first page from `verify:company` (no keywords, one page), not the total board size.

| company | ATS | status | jobs returned | relevant sample title | notes |
|---|---|---|---|---|---|
| Accenture | workday | verified | 20 | AADC-Industry & Function-AI & Data-FS Insurance-Consultant | India facet is `locationCountry` (first try with `locationMainGroup` returned HTTP 400). |
| Capgemini | manual | needs-manual | – | – | Custom job-stream API; no ATS host in the static HTML (detect:ats: none). |
| Cloud4C | manual | needs-manual | – | – | Custom portal `careers.cloud4c.com`; no ATS found. |
| Coforge | manual | needs-manual | – | – | Careers page is a JS shell; no ATS or job data in HTML. |
| Cognizant | manual | needs-manual | – | – | HTTP 403 to automated requests. |
| Deloitte | manual | needs-manual | – | – | Custom South Asia portal; no ATS found. |
| EY | manual | needs-manual | – | – | Job board is Yello (`eyglobal.yello.co`), no adapter. |
| Genpact | workday | verified | 20 | Sr. Data Engineer 4B | 48 India location ids; facet key is `locations` (`locationMainGroup` returned HTTP 400). |
| Google | google-careers | verified | 20 | AI Outcome Customer Engineer, FDE, Google Cloud | `location=India`, `q=<keyword>`. |
| HCLTech | generic | verified | 10 | – | SuccessFactors Career Site Builder; its own search POSTs `/services/recruiting/v1/jobs` (JSON, no cookies). Re-checked 2026-11-21. |
| Hexaware | oracle-hcm | needs-manual | – | – | Oracle HCM host seen (`fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com`), but the site number is not in the static HTML. |
| Infosys | manual | needs-manual | – | – | HTTP 403 to automated requests. |
| KPMG | oracle-hcm | verified | 13 | Senior-KDNI | Covers only the KDN India site (`CX_3001`), not other KPMG India sites. |
| LTIMindtree | manual | needs-manual | – | – | RippleHire board (`ltimindtree.ripplehire.com`), no adapter. |
| Mphasis | manual | needs-manual | – | – | Custom portal `careers.mphasis.com`; no ATS found. |
| Netenrich | manual | needs-manual | – | – | No ATS host or job data in the fetched HTML. |
| Persistent Systems | manual | needs-manual | – | – | Zwayam-powered site, no adapter. |
| PwC | manual | needs-manual | – | – | HTTP 403 to automated requests. |
| Quantiphi | workday | verified | 20 | Technical Architect - Platform - Migration | 5 India office ids (Bengaluru, Trivandrum, Mumbai ×3); facet key is `locations`. |
| Searce | manual | needs-manual | – | – | Careers URL returns 404 (`/careers` and `/careers/`). `manualSearchUrl` is a Google fallback, not a careers page; replace it once the real careers page is found. |
| TCS | manual | needs-manual | – | – | HTTP 403 to automated requests. |
| Tech Mahindra | manual | needs-manual | – | – | Custom careers site; no ATS found. |
| Wipro | generic | verified | 10 | – | Same SuccessFactors CSB search API as HCLTech (`/services/recruiting/v1/jobs`); body `location: "India"` filters server-side. Re-checked 2026-11-21. |
| Zensar | oracle-hcm | verified | 25 | Senior Java Dev | Site `CX_1`; India location id from a real response. Sample titles are unfiltered, so relevance is not yet confirmed. |

## Checks run

- Attempt 1 failed for Accenture, Genpact and Quantiphi (HTTP 400). Attempt 2 used the facet key read from the board's own unfiltered listing response; all three then verified.
- `detect:ats` ran for all 18 `needs-manual` companies. The 16 with no usable ATS are marked needs-manual after a second check of the careers page for known ATS hosts (Cognizant, Infosys, PwC and TCS returned 403, Searce 404).
- `npm test`: 24 files, 307 tests pass (includes the recipe-schema test).

## Follow-ups

- Batch A stays a `needs-manual` list until a working endpoint is found. Several (Cognizant, Infosys, PwC, TCS) need a different way in, because automated requests get 403.
- The 5 MB response cap is untested for full boards: Accenture and Genpact were checked only on their first page (20 jobs), so the cap question stays open for full refreshes.
- The company-researcher agent could not run `detect:ats` or `verify:company` (shell denied in its session), so the verify steps were run from the main session.
