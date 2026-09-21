import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NotificationFailuresBoard } from "../NotificationFailuresBoard";

describe("NotificationFailuresBoard", () => {
  it("honestly gates instead of fabricating rows, and names the exact missing endpoint", () => {
    const html = renderToStaticMarkup(<NotificationFailuresBoard />);
    expect(html).toContain('data-testid="mp.admin.notifications.unavailable"');
    expect(html).toContain("Data source not available");
    expect(html).toContain("notif:mp:dlq");
    expect(html).toContain("notif:mp:pending");
    // Never a fabricated row: no table markup at all.
    expect(html).not.toContain("<table");
  });
});
