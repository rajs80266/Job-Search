# Batch B research (contact-center and CX software vendors)

Run on 2026-11-21. Result: **7 verified, 10 needs-manual** (17 companies).

Jobs = count on the first page from `verify:company` (no keywords, one page), not the full board size. Sample titles are from that unfiltered first page, so they are not relevance-checked.

| company | ATS | status | jobs returned | sample titles (first page, unfiltered) | notes |
|---|---|---|---|---|---|
| Avaya | manual | needs-manual | – | – | Careers page points to SuccessFactors hosts (`career5` and `performancemanager5`, `.successfactors.eu`); both return 404 for the listing. |
| Cisco | generic | verified | 50 | – | Phenom People: public POST `careers.cisco.com/widgets` (refineSearch), `selected_fields.country=India` → 315 India jobs. Re-checked 2026-11-21. |
| Exotel | manual | needs-manual | – | – | No ATS host in the careers page HTML. |
| Five9 | manual | needs-manual | – | – | No ATS host in the careers page HTML. |
| Freshworks | smartrecruiters | verified | 30 | Senior Business Development Manager; Senior Account Executive - Inside Sales | Company id `Freshworks`; `country=in` filter, newest first. |
| Genesys | workday | verified | 16 | Senior Software Engineer (SIP / VOIP); Staff Software Engineer | India facet `locationCountry`. |
| Kapture CX | manual | needs-manual | – | – | Careers URL returns 404; site root returns 403 to automated requests. |
| LivePerson | manual | needs-manual | – | – | No ATS host in the careers page HTML. |
| NICE | manual | needs-manual | – | – | No ATS host in the careers page HTML. |
| Ozonetel | manual | needs-manual | – | – | No ATS host in the careers page HTML. |
| Salesforce | manual | needs-manual | – | – | Custom careers site; no ATS host in the static HTML. |
| Sprinklr | workday | verified | 15 | Support Platform Administrator; Internal Communications Manager | India facet `locationCountry`. |
| Talkdesk | greenhouse | verified | 38 | AI Customer Experience Manager; Applied AI Architect | Board token `talkdesk2` (from detect:ats). |
| Twilio | manual | needs-manual | – | – | Careers page loads Eightfold JavaScript only; no tenant host in the HTML. |
| Verint | ashby | verified | 20 | Account Executive, Canada; Director Regional Sales, Canada | Ashby job board id from detect:ats. Scoring handles India; first page includes non-India roles. |
| Zendesk | workday | verified | 17 | Senior Demo Platform Architect; Managed Shared Services Consultant | India facet `locationCountry`. |
| Zoho | manual | needs-manual | – | – | Careers page is thin, no ATS host (detect:ats: none). |

## Checks run

- `detect:ats` on all 17 careers URLs. For the 11 without a usable endpoint, a second check scanned the careers HTML for known ATS hosts (Eightfold, SuccessFactors, Phenom, Oracle, etc.).
- Workday India facet: read from the unfiltered listing of Genesys, Sprinklr and Zendesk. The India country value is `locationCountry` = `c4f78be1a8f14da0ab49ce1162348a5e`.
- Avaya: attempt 1 (`career5`) returned 404; attempt 2 (`performancemanager5`, the other detect host) also returned 404. Marked needs-manual.
- `npm test`: 24 files, 307 tests pass (includes the recipe-schema test).

## Follow-ups

- The first-page samples are unfiltered, so relevance is not confirmed for any verified company yet. The refresh with keywords will show it.
- Freshworks, Verint and Talkdesk first pages include non-India roles. Location scoring handles this, but it is worth checking once the first refresh runs.
- Cisco, Salesforce and Zoho are on custom or Phenom career sites. Adding a Phenom adapter would cover Cisco only if other companies use Phenom.
- Five9, LivePerson, NICE, Ozonetel and Exotel show no ATS host in static HTML. Their careers pages may load jobs through JavaScript; a browser check would show the job request.
