export interface BoardLink {
  id: string;
  name: string;
  url: string;
  /** False when the site has no search URL we can fill in; the link opens its search page. */
  prefilled: boolean;
}

/** "Dialogflow CX" -> "dialogflow-cx". */
export function slugifyKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const GLASSDOOR_INDIA_PREFIX = "india-";

/**
 * Search links for the boards we never scrape (AGENTS.md): the user opens them. Formats were
 * checked against real result URLs; Instahyre, Wellfound and Cutshort have no keyword URL we
 * can rely on, so those open the board's search page.
 */
export function buildBoardLinks(keyword: string): BoardLink[] {
  const term = keyword.trim();
  const slug = slugifyKeyword(term);
  const query = encodeURIComponent(term);
  return [
    {
      id: "linkedin",
      name: "LinkedIn",
      url: `https://www.linkedin.com/jobs/search/?keywords=${query}&location=India`,
      prefilled: true,
    },
    {
      id: "naukri",
      name: "Naukri",
      url: `https://www.naukri.com/${slug}-jobs-in-india`,
      prefilled: true,
    },
    {
      id: "indeed",
      name: "Indeed",
      url: `https://in.indeed.com/jobs?q=${query}&l=India`,
      prefilled: true,
    },
    {
      id: "glassdoor",
      name: "Glassdoor",
      url: `https://www.glassdoor.co.in/Job/${GLASSDOOR_INDIA_PREFIX}${slug}-jobs-SRCH_IL.0,5_IN115_KO6,${GLASSDOOR_INDIA_PREFIX.length + slug.length}.htm`,
      prefilled: true,
    },
    {
      id: "instahyre",
      name: "Instahyre",
      url: "https://www.instahyre.com/search-jobs/",
      prefilled: false,
    },
    { id: "wellfound", name: "Wellfound", url: "https://wellfound.com/jobs", prefilled: false },
    { id: "cutshort", name: "Cutshort", url: "https://cutshort.io/jobs", prefilled: false },
  ];
}
