import { describe, expect, it } from "vitest";
import { buildBoardLinks, slugifyKeyword } from "../src/lib/job-boards";

describe("slugifyKeyword", () => {
  it.each([
    ["Dialogflow CX", "dialogflow-cx"],
    ["  Contact Center AI ", "contact-center-ai"],
    ["Kore.ai", "kore-ai"],
  ])("%s -> %s", (keyword, slug) => {
    expect(slugifyKeyword(keyword)).toBe(slug);
  });
});

describe("buildBoardLinks", () => {
  const links = Object.fromEntries(buildBoardLinks("Dialogflow CX").map((link) => [link.id, link]));

  it("fills in the search URLs of the boards with a keyword URL, always for India", () => {
    expect(links["linkedin"]?.url).toBe(
      "https://www.linkedin.com/jobs/search/?keywords=Dialogflow%20CX&location=India",
    );
    expect(links["naukri"]?.url).toBe("https://www.naukri.com/dialogflow-cx-jobs-in-india");
    expect(links["indeed"]?.url).toBe("https://in.indeed.com/jobs?q=Dialogflow%20CX&l=India");
  });

  it("builds the Glassdoor keyword range from the slug length (as in real result URLs)", () => {
    expect(links["glassdoor"]?.url).toBe(
      "https://www.glassdoor.co.in/Job/india-dialogflow-cx-jobs-SRCH_IL.0,5_IN115_KO6,19.htm",
    );
    const realExample = buildBoardLinks("fully remote from anywhere").find(
      (link) => link.id === "glassdoor",
    );
    expect(realExample?.url).toContain(
      "india-fully-remote-from-anywhere-jobs-SRCH_IL.0,5_IN115_KO6,32.htm",
    );
  });

  it("marks the boards without a keyword URL as not prefilled", () => {
    expect(
      Object.values(links)
        .filter((link) => !link.prefilled)
        .map((link) => link.id),
    ).toEqual(["instahyre", "wellfound", "cutshort"]);
  });

  it("escapes characters that would break a query string", () => {
    const [linkedin] = buildBoardLinks("C&C++ #1");
    expect(linkedin?.url).toBe(
      "https://www.linkedin.com/jobs/search/?keywords=C%26C%2B%2B%20%231&location=India",
    );
  });
});
