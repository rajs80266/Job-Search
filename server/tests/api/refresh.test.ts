import { once } from "node:events";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Adapter,
  FetchedJob,
  RefreshCompanyResult,
  RefreshEvent,
  RefreshRunSummary,
} from "../../src/types";
import { type TestApp, createTestApp, makeJob } from "../helpers";

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function createGate(): Gate {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function openGate(): Gate {
  const gate = createGate();
  gate.open();
  return gate;
}

function gatedAdapter(gate: Gate, jobs: FetchedJob[] = [makeJob("1")]): Adapter {
  return {
    ats: "greenhouse",
    async *fetchJobs() {
      await gate.promise;
      for (const job of jobs) yield job;
      return { complete: true, stopReason: "end", pagesFetched: 1 };
    },
  };
}

const JSON_HEADERS = { "content-type": "application/json" };

function parseEvents(stream: string): RefreshEvent[] {
  return stream
    .split("\n\n")
    .filter((block) => block.includes("data: "))
    .map((block) => JSON.parse(block.split("data: ")[1] ?? "") as RefreshEvent);
}

function settledResults(events: RefreshEvent[]): RefreshCompanyResult[] {
  return events.flatMap((event) => {
    if (event.type === "snapshot") return event.results;
    return event.type === "company-finished" ? [event.result] : [];
  });
}

const servers: { close: () => void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function listen(test: TestApp): Promise<string> {
  const server = test.app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

async function startRefresh(base: string, body: object = {}): Promise<Response> {
  return fetch(`${base}/api/refresh`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

describe("POST /api/refresh", () => {
  it("starts a run (202), rejects a second one (409 with the run id) and reports the latest run", async () => {
    const gate = createGate();
    const test = createTestApp({ adapter: gatedAdapter(gate) });
    const base = await listen(test);
    test.db.prepare("UPDATE companies SET status = status").run();

    const first = await startRefresh(base);
    const started = (await first.json()) as { runId: number };
    const second = await startRefresh(base);

    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: "conflict",
      details: { runId: started.runId },
    });

    const stream = await fetch(`${base}/api/refresh/${started.runId}/events`);
    gate.open();
    const events = parseEvents(await stream.text());
    expect(events.at(-1)?.type).toBe("run-finished");

    const latest = await request(test.app).get("/api/refresh/latest");
    expect(latest.body).toMatchObject({ id: started.runId, status: "finished" });
  });

  it("returns 404 for an unknown company and 400 for a bad body", async () => {
    const { app } = createTestApp();

    const unknown = await request(app).post("/api/refresh").send({ company: "nope" });
    const invalid = await request(app).post("/api/refresh").send({ full: "yes" });

    expect(unknown.status).toBe(404);
    expect(invalid.status).toBe(400);
  });

  it("accepts an empty JSON body and a single-company full refresh", async () => {
    const { app } = createTestApp({
      adapter: gatedAdapter(openGate()),
    });

    const response = await request(app).post("/api/refresh").send({ company: "acme", full: true });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ runId: 1 });
  });

  it("returns null as the latest run before any refresh", async () => {
    const { app } = createTestApp();

    const response = await request(app).get("/api/refresh/latest");

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });
});

describe("GET /api/refresh/:runId/events", () => {
  it("sends a snapshot, then live events, then closes after run-finished", async () => {
    const gate = createGate();
    const test = createTestApp({ adapter: gatedAdapter(gate) });
    const base = await listen(test);
    const { runId } = (await (await startRefresh(base)).json()) as { runId: number };

    const response = await fetch(`${base}/api/refresh/${runId}/events`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    gate.open();
    const events = parseEvents(await response.text());

    expect(events.map((event) => event.type)).toEqual([
      "snapshot",
      "company-finished",
      "run-finished",
    ]);
    expect(events[0]).toMatchObject({
      run: { id: runId, status: "running" },
      results: [],
      running: ["acme"],
    });
    expect(events[1]).toMatchObject({
      result: { companySlug: "acme", status: "ok", jobsFetched: 1 },
    });
    expect((events[2] as { run: RefreshRunSummary }).run.totals).toMatchObject({
      ok: 1,
      failed: 0,
    });
  });

  it("sends the stored results and closes immediately for a finished run", async () => {
    const test = createTestApp({
      adapter: gatedAdapter(openGate()),
    });
    const base = await listen(test);
    const { runId } = (await (await startRefresh(base)).json()) as { runId: number };
    await fetch(`${base}/api/refresh/${runId}/events`).then((response) => response.text());

    const events = parseEvents(await (await fetch(`${base}/api/refresh/${runId}/events`)).text());

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "snapshot",
      run: { status: "finished" },
      results: [{ companySlug: "acme", status: "ok" }],
    });
  });

  it("reports a company failure in the stream without failing the run", async () => {
    const failing: Adapter = {
      ats: "greenhouse",
      // eslint-disable-next-line require-yield
      async *fetchJobs() {
        await Promise.resolve();
        throw new Error("HTTP 503 from careers site");
      },
    };
    const test = createTestApp({ adapter: failing });
    const base = await listen(test);
    const { runId } = (await (await startRefresh(base)).json()) as { runId: number };

    const events = parseEvents(await (await fetch(`${base}/api/refresh/${runId}/events`)).text());

    const failed = settledResults(events).find((result) => result.status === "failed");
    expect(failed?.message).toContain("503");
  });

  it("returns 404 for an unknown run", async () => {
    const { app } = createTestApp();

    expect((await request(app).get("/api/refresh/99/events")).status).toBe(404);
    expect((await request(app).get("/api/refresh/abc/events")).status).toBe(404);
  });
});
