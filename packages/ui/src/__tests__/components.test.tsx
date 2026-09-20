/**
 * Render tests for the shared web primitives via react-dom/server static
 * markup (the repo carries no DOM test harness — see the same pattern in
 * apps/admin-dashboard's component tests).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";

describe("Button", () => {
  it("renders its label inside a button element", () => {
    const html = renderToStaticMarkup(<Button>Pay now</Button>);
    expect(html).toContain("<button");
    expect(html).toContain("Pay now");
  });

  it("applies the variant classes and merges custom classNames", () => {
    const html = renderToStaticMarkup(
      <Button variant="destructive" className="custom-hook">
        Delete
      </Button>,
    );
    expect(html).toContain("bg-destructive");
    expect(html).toContain("custom-hook");
  });

  it("marks disabled buttons disabled", () => {
    const html = renderToStaticMarkup(<Button disabled>Wait</Button>);
    expect(html).toContain("disabled");
  });
});

describe("Badge", () => {
  it("renders content with the default variant styling", () => {
    const html = renderToStaticMarkup(<Badge>Live</Badge>);
    expect(html).toContain("Live");
    expect(html).toContain("bg-primary");
  });

  it("switches styling by variant", () => {
    const html = renderToStaticMarkup(<Badge variant="outline">Draft</Badge>);
    expect(html).toContain("text-foreground");
  });
});

describe("Card", () => {
  it("composes header, title and content", () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader>
          <CardTitle>Open requests</CardTitle>
        </CardHeader>
        <CardContent>12 live</CardContent>
      </Card>,
    );
    expect(html).toContain("Open requests");
    expect(html).toContain("12 live");
  });
});
