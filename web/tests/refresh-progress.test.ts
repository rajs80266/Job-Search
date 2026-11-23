import type { RefreshCompanyResult, RefreshRunSummary } from "@server/types";
import { describe, expect, it } from "vitest";
import {
  EMPTY_PROGRESS,
  applyProgressAction,
  buildProgressRows,
  countFinished,
  eventEndsRun,
  isRunActive,
  isStreamLost,
  type ProgressAction,
} from "../src/lib/refresh-progress";

function run(overrides: Partial<RefreshRunSummary> = {}): RefreshRunSummary {
  return {
    id: 1,
    startedAt: "2026-11-23T09:00:00.000Z",
    finishedAt: null,
    status: "running",
    companySlug: null,
    full: false,
    totals: { companies: 0, ok: 0, failed: 0, skipped: 0, jobsNew: 0, jobsClosed: 0 },
    ...overrides,
  };
}

function result(
  companySlug: string,
  status: RefreshCompanyResult["status"],
  finishedAt: string,
  overrides: Partial<RefreshCompanyResult> = {},
): RefreshCompanyResult {
  return {
    runId: 1,
    companySlug,
    status,
    mode: "incremental",
    startedAt: "2026-11-23T09:00:00.000Z",
    finishedAt,
    jobsFetched: 10,
    jobsNew: 0,
    jobsClosed: 0,
    jobsInvalid: 0,
    pagesFetched: 1,
    detailsFetched: 0,
    detailsFailed: 0,
    stopReason: "end",
    message: null,
    ...overrides,
  };
}

const reduce = (actions: ProgressAction[]) => actions.reduce(applyProgressAction, EMPTY_PROGRESS);

describe("applyProgressAction", () => {
  it("builds state from a snapshot", () => {
    const state = reduce([
      {
        type: "snapshot",
        run: run(),
        results: [result("acme", "ok", "2026-11-23T09:00:02.000Z")],
        running: ["beta"],
      },
    ]);

    expect(Object.keys(state.results)).toEqual(["acme"]);
    expect(state.running).toEqual(["beta"]);
    expect(isRunActive(state)).toBe(true);
    expect(countFinished(state)).toBe(1);
  });

  it("tracks a company from started to finished", () => {
    const state = reduce([
      { type: "snapshot", run: run(), results: [], running: [] },
      { type: "company-started", runId: 1, companySlug: "acme", at: "2026-11-23T09:00:01.000Z" },
    ]);
    expect(state.running).toEqual(["acme"]);

    const finished = applyProgressAction(state, {
      type: "company-finished",
      result: result("acme", "failed", "2026-11-23T09:00:03.000Z", { message: "HTTP 503" }),
    });

    expect(finished.running).toEqual([]);
    expect(finished.results["acme"]?.message).toBe("HTTP 503");
  });

  it("ignores a started event for a company that already finished (snapshot after reconnect)", () => {
    const state = reduce([
      {
        type: "snapshot",
        run: run(),
        results: [result("acme", "ok", "2026-11-23T09:00:02.000Z")],
        running: [],
      },
      { type: "company-started", runId: 1, companySlug: "acme", at: "2026-11-23T09:00:01.000Z" },
    ]);

    expect(state.running).toEqual([]);
  });

  it("is idempotent when the same snapshot arrives twice", () => {
    const snapshot: ProgressAction = {
      type: "snapshot",
      run: run(),
      results: [result("acme", "ok", "2026-11-23T09:00:02.000Z")],
      running: ["beta"],
    };

    expect(reduce([snapshot, snapshot])).toEqual(reduce([snapshot]));
  });

  it("marks the run finished and clears running companies", () => {
    const state = reduce([
      { type: "snapshot", run: run(), results: [], running: ["acme"] },
      {
        type: "run-finished",
        run: run({ status: "finished", finishedAt: "2026-11-23T09:01:00.000Z" }),
      },
    ]);

    expect(state.running).toEqual([]);
    expect(isRunActive(state)).toBe(false);
  });

  it("records the connection state", () => {
    expect(reduce([{ type: "connection", state: "reconnecting" }]).connection).toBe("reconnecting");
  });
});

describe("buildProgressRows", () => {
  it("lists running first, then failed, ok and skipped, then pending in planned order", () => {
    const state = reduce([
      {
        type: "snapshot",
        run: run(),
        results: [
          result("ok-early", "ok", "2026-11-23T09:00:01.000Z"),
          result("ok-late", "ok", "2026-11-23T09:00:05.000Z"),
          result("broken", "failed", "2026-11-23T09:00:02.000Z"),
          result("skip", "skipped", "2026-11-23T09:00:03.000Z"),
        ],
        running: ["busy"],
      },
    ]);

    const rows = buildProgressRows(state, [
      "waiting-b",
      "ok-early",
      "busy",
      "waiting-a",
      "ok-late",
      "broken",
      "skip",
    ]);

    expect(rows.map((row) => `${row.slug}:${row.state}`)).toEqual([
      "busy:running",
      "broken:failed",
      "ok-late:ok",
      "ok-early:ok",
      "skip:skipped",
      "waiting-b:pending",
      "waiting-a:pending",
    ]);
  });

  it("includes finished companies that were not in the planned list", () => {
    const state = reduce([
      {
        type: "snapshot",
        run: run(),
        results: [result("surprise", "ok", "2026-11-23T09:00:01.000Z")],
        running: [],
      },
    ]);

    expect(buildProgressRows(state, []).map((row) => row.slug)).toEqual(["surprise"]);
  });
});

describe("eventEndsRun", () => {
  it("is true for run-finished and for a snapshot of a run that already ended", () => {
    expect(eventEndsRun({ type: "run-finished", run: run({ status: "aborted" }) })).toBe(true);
    expect(
      eventEndsRun({
        type: "snapshot",
        run: run({ status: "finished" }),
        results: [],
        running: [],
      }),
    ).toBe(true);
    expect(
      eventEndsRun({ type: "snapshot", run: run({ status: "aborted" }), results: [], running: [] }),
    ).toBe(true);
  });

  it("is false for a snapshot of a running run and for company events", () => {
    expect(
      eventEndsRun({ type: "snapshot", run: run({ status: "running" }), results: [], running: [] }),
    ).toBe(false);
    expect(
      eventEndsRun({
        type: "company-started",
        runId: 1,
        companySlug: "a",
        at: "2026-11-23T09:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("isStreamLost", () => {
  it("is true only when the stream is closed while the run still says running", () => {
    const running = { ...EMPTY_PROGRESS, run: run({ status: "running" }) };

    expect(isStreamLost({ ...running, connection: "closed" })).toBe(true);
    expect(isStreamLost({ ...running, connection: "reconnecting" })).toBe(false);
    expect(
      isStreamLost({ ...running, run: run({ status: "finished" }), connection: "closed" }),
    ).toBe(false);
  });
});
