import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag }));

const SECRET = "test-secret-0123456789abcdef";

function call(body: unknown, auth?: string): Promise<Response> {
  return POST(
    new Request("http://site.test/api/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

describe("POST /api/revalidate", () => {
  beforeEach(() => {
    revalidateTag.mockReset();
    process.env.UBI_REVALIDATE_SECRET = SECRET;
  });

  it("fails closed when no secret is configured", async () => {
    delete process.env.UBI_REVALIDATE_SECRET;
    const response = await call({}, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong bearer token", async () => {
    expect((await call({})).status).toBe(401);
    expect((await call({}, "Bearer nope")).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("purges both tags by default", async () => {
    const response = await call({}, `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("availability");
    expect(revalidateTag).toHaveBeenCalledWith("requirements");
  });

  it("purges only the requested tag and rejects unknown ones", async () => {
    const ok = await call(
      { tags: ["availability"], reason: "flag.changed" },
      `Bearer ${SECRET}`,
    );
    expect(ok.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    const bad = await call({ tags: ["everything"] }, `Bearer ${SECRET}`);
    expect(bad.status).toBe(422);
  });
});
