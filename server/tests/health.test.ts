import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers";

describe("GET /api/health", () => {
  it("reports ok", async () => {
    const response = await request(createTestApp().app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok" });
    expect(Number.isNaN(Date.parse((response.body as { time: string }).time))).toBe(false);
  });
});
