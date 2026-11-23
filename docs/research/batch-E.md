# Batch E research (product and BFSI companies with in-house CX AI)

Run on 2026-11-21. Result: **4 verified, 11 needs-manual** (15 companies).

Jobs = count on the first page from `verify:company` (no keywords, one page), not the full board size. Sample titles are from that unfiltered first page, so they are not relevance-checked.

| company | ATS | status | jobs returned | sample titles (first page, unfiltered) | notes |
|---|---|---|---|---|---|
| Airtel | manual | needs-manual | – | – | No ATS host or careers links on the homepage or careers page. |
| Axis Bank | manual | needs-manual | – | – | No ATS host on the careers page. |
| Flipkart | manual | needs-manual | – | – | No ATS host on the careers page or homepage. |
| HDFC Bank | manual | needs-manual | – | – | Careers page returns 403 to automated requests. |
| ICICI Bank | manual | needs-manual | – | – | Careers portal `icicicareers.com` has no ATS host detected; `icicibank.com/careers` returns 404. |
| Jio | manual | needs-manual | – | – | No ATS host on the careers page or homepage. |
| Kotak Mahindra Bank | oracle-hcm | verified | 25 | Team Sales Manager - SARAL LOANS; Elite Banker - Inbound | Oracle HCM site `CX` on `hcbt.fa.em2.oraclecloud.com`, linked from the careers page. Covers the whole site. |
| MakeMyTrip | manual | needs-manual | – | – | No ATS host detected; the homepage timed out on the second check. |
| Meesho | lever | verified | 48 | AM/Manager - Risk & Decision Science; AM/M - Risk Analytics | Lever board `meesho`. The careers page (`careers.meesho.com`) returned 503, but the board's own API answers. |
| Myntra | manual | needs-manual | – | – | Careers portal `careers.myntra.com` has no ATS host detected (two checks). |
| Paytm | lever | verified | 100 | Ad Sales (KAM) Manager - Paytm Ads; AM / DM - Non IT Purchase | Lever board `paytm` (from detect:ats). Whole board on the first page. |
| PhonePe | manual | needs-manual | – | – | No ATS host on the careers page or homepage. |
| Razorpay | greenhouse | verified | 29 | AI Builder (Senior Product Designer); Analyst, Banking Alliances | Greenhouse board `razorpaysoftwareprivatelimited` (from detect:ats). |
| Swiggy | manual | needs-manual | – | – | No ATS host on the careers page or homepage. |
| Zomato | manual | needs-manual | – | – | No ATS host on the careers page or homepage. |

## Checks run

- `detect:ats` on all 15 careers URLs. For the 11 without an endpoint, a second check looked at the homepage for careers links and ran detect on the new URLs (Myntra, ICICI, Kotak's careers portal) and on Meesho's Lever board page.
- Meesho: the careers page returned 503 on the first check. The Lever board page and API both answered on the second check, so the recipe uses the board API.
- `verify:company` passed for Paytm, Razorpay, Meesho and Kotak on the first attempt.
- `npm test`: 24 files, 307 tests pass (includes the recipe-schema test).

## Follow-ups

- Paytm's board returned 100 jobs on the first page with no keyword filter. A full fetch could be large, so it is a candidate for the 5 MB cap check.
- Meesho's Lever API response is about 800 KB and verify took about 15 seconds. Both are within limits, but worth watching.
- Samples are unfiltered and mostly non-target roles (sales, risk, banking). Relevance is not confirmed until the first refresh.
- Kotak's recipe covers the whole Oracle site; the first page is mostly banking sales roles.
- Eleven companies still need a manual check. Several (Flipkart, Swiggy, Zomato, PhonePe, Jio, Airtel) show no ATS host in static HTML and may load their job lists through JavaScript.
