import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { createApp } from "../src/app";
import { PROFILE_PATH } from "../src/config";
import { openDatabase } from "../src/db/connection";
import { upsertJob } from "../src/db/jobs";
import { loadProfile } from "../src/profile/store";
import { createRefreshService } from "../src/refresh/service";
import type {
  Adapter,
  CompanyRecipe,
  FetchContext,
  FetchOutcome,
  FetchedJob,
  HttpClient,
  HttpRequest,
  HttpResponse,
  NormalizedJob,
  Profile,
} from "../src/types";

export const testProfile = loadProfile(PROFILE_PATH);

const temporaryDirs: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "job-tracker-test-"));
  temporaryDirs.push(dir);
  return dir;
}

export function recipeInput(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    slug,
    name: slug.toUpperCase(),
    category: "cx-vendor",
    careersUrl: `https://${slug}.example/careers`,
    ats: "greenhouse",
    fetch: { url: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true` },
    status: "verified",
    verifiedOn: "2026-11-01",
    ...overrides,
  };
}

export function writeRecipeFile(
  dir: string,
  slug: string,
  overrides: Record<string, unknown> = {},
): void {
  writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify(recipeInput(slug, overrides)));
}

export function makeJob(externalId: string, overrides: Partial<FetchedJob> = {}): FetchedJob {
  return {
    externalId,
    title: `Engineer ${externalId}`,
    url: `https://jobs.example/${externalId}`,
    locationRaw: "Pune, India",
    postedRaw: "2026-11-10T00:00:00Z",
    description: "",
    ...overrides,
  };
}

export interface Batch {
  jobs?: FetchedJob[];
  outcome?: Partial<FetchOutcome>;
  error?: Error;
}

/** An adapter whose listing comes from `nextBatch`, called once per fetch. */
export function scriptedAdapter(
  nextBatch: (recipe: CompanyRecipe, ctx: FetchContext) => Batch,
  extra: Partial<Adapter> = {},
): Adapter {
  return {
    ats: "greenhouse",
    async *fetchJobs(recipe, ctx) {
      await Promise.resolve();
      const batch = nextBatch(recipe, ctx);
      if (batch.error) throw batch.error;
      for (const job of batch.jobs ?? []) yield job;
      return { complete: true, stopReason: "end", pagesFetched: 1, ...batch.outcome };
    },
    ...extra,
  };
}

export function jsonResponse(body: unknown, url = "https://example.test/"): HttpResponse {
  const text = JSON.stringify(body);
  return { status: 200, url, text, json: <T>() => JSON.parse(text) as T };
}

export function textResponse(text: string, url = "https://example.test/"): HttpResponse {
  return { status: 200, url, text, json: <T>() => JSON.parse(text) as T };
}

export function fakeHttp(respond: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>) {
  const requests: HttpRequest[] = [];
  const client: HttpClient = {
    request: async (req) => {
      requests.push(req);
      return respond(req);
    },
  };
  return { client, requests };
}

export function readFixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
}

export function readJsonFixture<T>(name: string): T {
  return JSON.parse(readFixture(name)) as T;
}

export function fetchContext(
  http: HttpClient,
  overrides: Partial<FetchContext> = {},
): FetchContext {
  return {
    http,
    signal: new AbortController().signal,
    keywords: [],
    maxPages: 1,
    knownExternalIds: new Set(),
    now: new Date("2026-11-21T00:00:00Z"),
    ...overrides,
  };
}

export interface TestApp {
  app: ReturnType<typeof createApp>;
  /** Profiles the API saved, in order. */
  savedProfiles: Profile[];
  db: ReturnType<typeof openDatabase>;
  recipesDir: string;
}

/** The real app on an in-memory database; recipes are written to a temp folder. */
export function createTestApp(
  options: {
    slugs?: string[];
    adapter?: Adapter;
    now?: () => Date;
    http?: HttpClient;
  } = {},
): TestApp {
  const db = openDatabase(":memory:");
  const recipesDir = makeTempDir();
  for (const slug of options.slugs ?? ["acme"]) writeRecipeFile(recipesDir, slug);

  const adapter = options.adapter ?? scriptedAdapter(() => ({ jobs: [] }));
  const http =
    options.http ??
    fakeHttp(() => {
      throw new Error("tests must not use the network");
    }).client;
  const adapters = { greenhouse: adapter };
  let profile: Profile = testProfile;
  const savedProfiles: Profile[] = [];
  const saveProfile = (saved: Profile): void => {
    profile = saved;
    savedProfiles.push(saved);
  };
  const refreshService = createRefreshService({
    db,
    http,
    adapters,
    recipesDir,
    loadProfile: () => profile,
  });
  const app = createApp({
    db,
    refreshService,
    recipesDir,
    http,
    adapters,
    loadProfile: () => profile,
    saveProfile,
    ...(options.now && { now: options.now }),
  });
  return { app, db, recipesDir, savedProfiles };
}

/** upsertJob always opens a job; this stores it as given, closed or not. */
export function storeJob(db: TestApp["db"], job: NormalizedJob): void {
  upsertJob(db, job);
  if (job.closedAt)
    db.prepare("UPDATE jobs SET closed_at = ? WHERE id = ?").run(job.closedAt, job.id);
}
