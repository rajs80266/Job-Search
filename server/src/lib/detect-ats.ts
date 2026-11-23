import type { Ats, DetectAtsResult, HttpClient } from "../types";
import { decodeHtmlEntities } from "./text";

interface Detection {
  ats: Ats;
  evidence: string;
  /** Built only from tokens present in the matched URL; null when a needed token is missing. */
  candidateApiUrl: string | null;
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][A-Za-z]{2})?$/;

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

function validToken(value: string | undefined): string | null {
  return value !== undefined && TOKEN.test(value) ? value : null;
}

function hostIs(url: URL, domain: string): boolean {
  return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
}

function detectGreenhouse(url: URL): Detection | null {
  if (!hostIs(url, "greenhouse.io")) return null;

  const [first, second, third] = pathSegments(url);
  let token: string | null;
  if (url.hostname.startsWith("boards-api.")) {
    token = first === "v1" && second === "boards" ? validToken(third) : null;
  } else {
    token = validToken(url.searchParams.get("for") ?? undefined);
    if (token === null && first !== "embed" && first !== "v1") token = validToken(first);
  }
  return {
    ats: "greenhouse",
    evidence: `url ${url.hostname}`,
    candidateApiUrl:
      token && `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
  };
}

function detectLever(url: URL): Detection | null {
  const isEu = url.hostname === "jobs.eu.lever.co" || url.hostname === "api.eu.lever.co";
  if (!isEu && url.hostname !== "jobs.lever.co" && url.hostname !== "api.lever.co") return null;

  const segments = pathSegments(url);
  const site = validToken(url.hostname.startsWith("api.") ? segments[2] : segments[0]);
  const apiHost = isEu ? "api.eu.lever.co" : "api.lever.co";
  return {
    ats: "lever",
    evidence: `url ${url.hostname}`,
    candidateApiUrl: site && `https://${apiHost}/v0/postings/${site}?mode=json`,
  };
}

function detectAshby(url: URL): Detection | null {
  if (url.hostname !== "jobs.ashbyhq.com" && url.hostname !== "api.ashbyhq.com") return null;

  const segments = pathSegments(url);
  const name = validToken(url.hostname.startsWith("api.") ? segments[2] : segments[0]);
  return {
    ats: "ashby",
    evidence: `url ${url.hostname}`,
    candidateApiUrl: name && `https://api.ashbyhq.com/posting-api/job-board/${name}`,
  };
}

function detectSmartRecruiters(url: URL): Detection | null {
  if (!hostIs(url, "smartrecruiters.com")) return null;

  const segments = pathSegments(url);
  const id = validToken(url.hostname.startsWith("api.") ? segments[2] : segments[0]);
  return {
    ats: "smartrecruiters",
    evidence: `url ${url.hostname}`,
    candidateApiUrl: id && `https://api.smartrecruiters.com/v1/companies/${id}/postings`,
  };
}

function detectWorkable(url: URL): Detection | null {
  if (!hostIs(url, "workable.com")) return null;

  const segments = pathSegments(url);
  const subdomain = url.hostname.split(".")[0];
  const fromSubdomain = subdomain && !["www", "apply", "careers"].includes(subdomain);
  const accountFromPath = segments[0] === "api" ? segments[4] : segments[0];
  const account = validToken(fromSubdomain ? subdomain : accountFromPath);
  return {
    ats: "workable",
    evidence: `url ${url.hostname}`,
    candidateApiUrl: account && `https://apply.workable.com/api/v1/widget/accounts/${account}`,
  };
}

function detectWorkday(url: URL): Detection | null {
  const host = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i.exec(url.hostname);
  if (!host) return null;

  const segments = pathSegments(url);
  const isApiPath = segments[0] === "wday" && segments[1] === "cxs";
  const site = isApiPath
    ? segments[3]
    : segments.find((segment) => !LOCALE_SEGMENT.test(segment) && segment !== "job");
  const tenant = host[1];
  return {
    ats: "workday",
    evidence: `url ${url.hostname}`,
    candidateApiUrl:
      tenant && site ? `https://${url.hostname}/wday/cxs/${tenant}/${site}/jobs` : null,
  };
}

function detectEightfold(url: URL): Detection | null {
  if (!hostIs(url, "eightfold.ai")) return null;

  const domain = url.searchParams.get("domain");
  return {
    ats: "eightfold",
    evidence: `url ${url.hostname}`,
    candidateApiUrl:
      domain && validToken(domain)
        ? `https://${url.hostname}/api/apply/v2/jobs?domain=${domain}`
        : null,
  };
}

function detectOracleHcm(url: URL): Detection | null {
  if (!hostIs(url, "oraclecloud.com")) return null;
  if (!/\/hcmUI\/CandidateExperience|\/hcmRestApi\//i.test(url.pathname)) return null;

  const segments = pathSegments(url);
  const siteNumber = validToken(segments[segments.indexOf("sites") + 1]);
  return {
    ats: "oracle-hcm",
    evidence: `url ${url.hostname}`,
    candidateApiUrl:
      segments.includes("sites") && siteNumber
        ? `https://${url.hostname}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=${siteNumber},limit=25,offset=0`
        : null,
  };
}

function detectSuccessFactors(url: URL): Detection | null {
  if (!/(^|\.)(successfactors\.(com|eu)|sapsf\.(com|eu|cn))$|^jobs2web\./i.test(url.hostname)) {
    return null;
  }
  return {
    ats: "successfactors",
    evidence: `url ${url.hostname}`,
    candidateApiUrl: `${url.origin}/search/?q=&locationsearch=`,
  };
}

function detectGoogleCareers(url: URL): Detection | null {
  const isGoogle = url.hostname === "google.com" || url.hostname === "www.google.com";
  if (!isGoogle || !url.pathname.startsWith("/about/careers/applications")) return null;

  return {
    ats: "google-careers",
    evidence: `url ${url.hostname}${url.pathname}`,
    candidateApiUrl:
      "https://www.google.com/about/careers/applications/jobs/results?location=India&sort_by=date",
  };
}

const URL_DETECTORS = [
  detectGreenhouse,
  detectLever,
  detectAshby,
  detectSmartRecruiters,
  detectWorkable,
  detectWorkday,
  detectEightfold,
  detectOracleHcm,
  detectSuccessFactors,
  detectGoogleCareers,
];

/** Page markers that name an ATS without a URL we can build an API URL from. */
const HTML_MARKERS: { ats: Ats; pattern: RegExp; evidence: string }[] = [
  {
    ats: "greenhouse",
    pattern: /[?&]gh_jid=\d+|Grnhse\.Iframe/,
    evidence: "marker gh_jid / Grnhse",
  },
  { ats: "successfactors", pattern: /jobs2web|SuccessFactors/i, evidence: "marker SuccessFactors" },
];

const URL_IN_HTML = /(?:https?:)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s"'<>\\)]*/gi;

function detectFromUrl(rawUrl: string): Detection | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  for (const detect of URL_DETECTORS) {
    const detection = detect(url);
    if (detection) return detection;
  }
  return null;
}

/** Matches the page's own URL against known ATS hosts and path patterns. */
export function detectAtsFromUrl(rawUrl: string): DetectAtsResult {
  const detection = detectFromUrl(rawUrl);
  return toResult(rawUrl, detection ? [detection] : []);
}

/** Every ATS URL and marker found in the page, in page order. */
export function detectAtsFromHtml(html: string): Detection[] {
  const text = decodeHtmlEntities(html.replace(/\\u002F|\\\//gi, "/"));
  const detections: Detection[] = [];

  for (const match of text.matchAll(URL_IN_HTML)) {
    const raw = match[0].startsWith("//") ? `https:${match[0]}` : match[0];
    const detection = detectFromUrl(raw);
    if (detection) detections.push({ ...detection, evidence: `link ${raw.slice(0, 120)}` });
  }
  for (const marker of HTML_MARKERS) {
    if (marker.pattern.test(text)) {
      detections.push({ ats: marker.ats, evidence: marker.evidence, candidateApiUrl: null });
    }
  }
  return detections;
}

const MAX_EVIDENCE = 5;

function toResult(inputUrl: string, detections: Detection[]): DetectAtsResult {
  const [primary] = detections;
  if (!primary) return { inputUrl, ats: null, evidence: [], candidateApiUrl: null };

  const sameAts = detections.filter((detection) => detection.ats === primary.ats);
  return {
    inputUrl,
    ats: primary.ats,
    evidence: [...new Set(sameAts.map((detection) => detection.evidence))].slice(0, MAX_EVIDENCE),
    candidateApiUrl:
      sameAts.find((detection) => detection.candidateApiUrl)?.candidateApiUrl ?? null,
  };
}

/** URL first (no network); otherwise one GET of the page, checking the final URL and its HTML. */
export async function detectAts(inputUrl: string, http: HttpClient): Promise<DetectAtsResult> {
  const fromUrl = detectAtsFromUrl(inputUrl);
  if (fromUrl.ats) return fromUrl;

  const response = await http.request({
    url: inputUrl,
    headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
  });
  const finalDetection = response.url === inputUrl ? null : detectFromUrl(response.url);
  const detections = finalDetection ? [finalDetection] : detectAtsFromHtml(response.text);
  return toResult(inputUrl, detections);
}
