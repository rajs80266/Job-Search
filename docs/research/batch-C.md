# Batch C research (Indian conversational-AI and voice-AI companies)

Run on 2026-11-21. Result: **4 verified, 13 needs-manual** (17 companies).

Jobs = count on the first page from `verify:company` (no keywords, one page), not the full board size. Sample titles are from that unfiltered first page, so they are not relevance-checked.

| company | ATS | status | jobs returned | sample titles (first page, unfiltered) | notes |
|---|---|---|---|---|---|
| Bolna | ashby | verified | 5 | AI Solutions Engineer; Enterprise Lead | Ashby job board `bolna` (from detect:ats). |
| CoRover | manual | needs-manual | – | – | No ATS host on two careers URLs. |
| Convin | manual | needs-manual | – | – | Re-checked 2026-11-21: still 404; only job link is LinkedIn (not scraped). |
| Engati | manual | needs-manual | – | – | Careers page TLS handshake fails in the detect tool. |
| Gnani.ai | manual | needs-manual | – | – | No ATS host on the careers page. |
| Gupshup | manual | needs-manual | – | – | No ATS host on `/careers` (`/company/careers` returns 404). |
| Haptik | manual | needs-manual | – | – | No ATS host on the careers page. |
| Kore.ai | manual | needs-manual | – | – | No ATS host on the careers page. |
| LimeChat | manual | needs-manual | – | – | Careers are a Notion page (no adapter). |
| Observe.AI | greenhouse | verified | 10 | AI Agent Engineer, Client Facing; AI Agent Experience Designer | Greenhouse board `observeai` (from detect:ats). |
| Rezo.ai | manual | needs-manual | – | – | No ATS host on the careers page. |
| Sarvam AI | ashby | verified | 42 | Engagement Manager, Chanakya; Data Scientist - Evaluations, Chanakya | Ashby job board `sarvam` (from detect:ats). |
| Senseforth | manual | needs-manual | – | – | Site certificate has expired; careers page cannot be read. |
| Skit.ai | manual | needs-manual | – | – | No ATS host on the careers page. |
| Uniphore | workday | verified | 5 | Senior IT Infrastructure Lead; Director, Security Engineering | Workday `uniphore` (wd503). India facet `locations`: Bangalore, Chennai. |
| Verloop.io | manual | needs-manual | – | – | Careers page returns 403 to automated requests. |
| Yellow.ai | manual | needs-manual | – | – | No ATS host on the careers page; `/careers/` returns 404. |

## Checks run

- `detect:ats` on all 17 careers URLs. For the 13 without an endpoint, a second attempt checked the homepage for careers links and scanned for known ATS hosts. Where the homepage gave a different careers URL, `detect:ats` ran on that too.
- Uniphore India facet: read from the unfiltered Workday listing (`locations`: Bangalore, Chennai).
- `verify:company` passed on the four verified recipes on the first attempt.
- `npm test`: 24 files, 307 tests pass (includes the recipe-schema test).

## Follow-ups

- Samples are unfiltered, so relevance is not confirmed yet. Observe.AI's "AI Agent Engineer, Client Facing" looks on-target.
- Sarvam AI's first page is mostly one project ("Chanakya"); the 42 jobs are a single board, so this is a large-ish board to watch against the 5 MB cap.
- Thirteen companies still need a manual check. Several (Gnani.ai, Haptik, Kore.ai, Rezo.ai, Skit.ai, CoRover) show no ATS in static HTML. Their career lists may load through JavaScript; a browser check of the job request would confirm this.
