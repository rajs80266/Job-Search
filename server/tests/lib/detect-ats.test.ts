import { describe, expect, it } from "vitest";
import { detectAts, detectAtsFromHtml, detectAtsFromUrl } from "../../src/lib/detect-ats";
import { fakeHttp, textResponse } from "../helpers";

describe("detectAtsFromUrl", () => {
  it.each([
    [
      "https://boards.greenhouse.io/acme",
      "greenhouse",
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
    ],
    [
      "https://job-boards.greenhouse.io/acme/jobs/123",
      "greenhouse",
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
    ],
    [
      "https://boards.greenhouse.io/embed/job_board?for=acme",
      "greenhouse",
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
    ],
    [
      "https://jobs.lever.co/acme/abc-123",
      "lever",
      "https://api.lever.co/v0/postings/acme?mode=json",
    ],
    [
      "https://jobs.eu.lever.co/acme",
      "lever",
      "https://api.eu.lever.co/v0/postings/acme?mode=json",
    ],
    [
      "https://jobs.ashbyhq.com/acme",
      "ashby",
      "https://api.ashbyhq.com/posting-api/job-board/acme",
    ],
    [
      "https://jobs.smartrecruiters.com/Acme1/743999",
      "smartrecruiters",
      "https://api.smartrecruiters.com/v1/companies/Acme1/postings",
    ],
    [
      "https://apply.workable.com/acme/",
      "workable",
      "https://apply.workable.com/api/v1/widget/accounts/acme",
    ],
    [
      "https://acme.workable.com/",
      "workable",
      "https://apply.workable.com/api/v1/widget/accounts/acme",
    ],
    [
      "https://acme.wd3.myworkdayjobs.com/en-US/External/job/Pune/Engineer_R1",
      "workday",
      "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs",
    ],
    [
      "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/jobs",
      "workday",
      "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/jobs",
    ],
    [
      "https://acme.eightfold.ai/careers?domain=acme.com",
      "eightfold",
      "https://acme.eightfold.ai/api/apply/v2/jobs?domain=acme.com",
    ],
    [
      "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs",
      "oracle-hcm",
      "https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=CX_1001,limit=25,offset=0",
    ],
    [
      "https://career5.successfactors.eu/career?company=acme",
      "successfactors",
      "https://career5.successfactors.eu/search/?q=&locationsearch=",
    ],
    [
      "https://www.google.com/about/careers/applications/jobs/results?location=India",
      "google-careers",
      "https://www.google.com/about/careers/applications/jobs/results?location=India&sort_by=date",
    ],
  ])("detects %s", (url, ats, candidateApiUrl) => {
    expect(detectAtsFromUrl(url)).toMatchObject({ ats, candidateApiUrl });
  });

  it("detects the ATS but gives no API URL when a needed token is missing", () => {
    expect(detectAtsFromUrl("https://acme.eightfold.ai/careers")).toMatchObject({
      ats: "eightfold",
      candidateApiUrl: null,
    });
    expect(detectAtsFromUrl("https://acme.wd3.myworkdayjobs.com/")).toMatchObject({
      ats: "workday",
      candidateApiUrl: null,
    });
    expect(
      detectAtsFromUrl("https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/"),
    ).toMatchObject({
      ats: "oracle-hcm",
      candidateApiUrl: null,
    });
  });

  it("returns null for unknown hosts and garbage", () => {
    expect(detectAtsFromUrl("https://careers.example.com/jobs")).toMatchObject({
      ats: null,
      candidateApiUrl: null,
    });
    expect(detectAtsFromUrl("not a url")).toMatchObject({ ats: null });
  });
});

describe("detectAtsFromHtml", () => {
  it("finds ATS links, iframes and scripts, including escaped and protocol-relative URLs", () => {
    const html = `
      <a href="https://example.com/about">About</a>
      <script src="//boards.greenhouse.io/embed/job_board/js?for=acme"></script>
      <iframe src="https://jobs.lever.co/other"></iframe>
      <script>var cfg = "https:\\/\\/acme.wd5.myworkdayjobs.com\\/Careers";</script>`;

    const detections = detectAtsFromHtml(html);

    expect(detections.map((detection) => detection.ats)).toEqual([
      "greenhouse",
      "lever",
      "workday",
    ]);
    expect(detections[0]?.candidateApiUrl).toBe(
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
    );
    expect(detections[2]?.candidateApiUrl).toBe(
      "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/jobs",
    );
  });

  it("decodes HTML entities in URLs", () => {
    const html = '<a href="https://acme.eightfold.ai/careers?a=1&amp;domain=acme.com">Jobs</a>';

    expect(detectAtsFromHtml(html)[0]?.candidateApiUrl).toBe(
      "https://acme.eightfold.ai/api/apply/v2/jobs?domain=acme.com",
    );
  });

  it("recognises markers that name an ATS without a usable URL", () => {
    const detections = detectAtsFromHtml('<a href="/jobs/engineer?gh_jid=4012345">Apply</a>');

    expect(detections).toEqual([
      { ats: "greenhouse", evidence: "marker gh_jid / Grnhse", candidateApiUrl: null },
    ]);
  });

  it("finds nothing in an ordinary page", () => {
    expect(
      detectAtsFromHtml("<html><body><a href='https://example.com'>x</a></body></html>"),
    ).toEqual([]);
  });
});

describe("detectAts", () => {
  it("does not touch the network when the URL itself identifies the ATS", async () => {
    const { client, requests } = fakeHttp(() => textResponse(""));

    const result = await detectAts("https://jobs.lever.co/acme", client);

    expect(result).toMatchObject({
      ats: "lever",
      candidateApiUrl: "https://api.lever.co/v0/postings/acme?mode=json",
    });
    expect(requests).toHaveLength(0);
  });

  it("fetches the page once and detects from its HTML", async () => {
    const { client, requests } = fakeHttp(() =>
      textResponse(
        '<iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe>',
        "https://acme.example/careers",
      ),
    );

    const result = await detectAts("https://acme.example/careers", client);

    expect(requests).toHaveLength(1);
    expect(result).toMatchObject({
      ats: "greenhouse",
      candidateApiUrl: "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
    });
    expect(result.evidence[0]).toContain("boards.greenhouse.io");
  });

  it("uses the final URL after a redirect to an ATS", async () => {
    const { client } = fakeHttp(() =>
      textResponse("<html></html>", "https://acme.wd3.myworkdayjobs.com/en-US/External"),
    );

    const result = await detectAts("https://acme.example/careers", client);

    expect(result).toMatchObject({
      ats: "workday",
      candidateApiUrl: "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs",
    });
  });

  it("reports no ATS when nothing matches", async () => {
    const { client } = fakeHttp(() =>
      textResponse("<html>custom careers</html>", "https://acme.example/careers"),
    );

    expect(await detectAts("https://acme.example/careers", client)).toEqual({
      inputUrl: "https://acme.example/careers",
      ats: null,
      evidence: [],
      candidateApiUrl: null,
    });
  });
});
