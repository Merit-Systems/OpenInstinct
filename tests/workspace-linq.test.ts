import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceManager } from "../app/_components/manager/workspace";

describe("workspace Linq channel", () => {
  it("disables iMessage without advertising another deployment's number", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceManager, { linqPhoneNumber: undefined })
    );

    expect(html).toContain("Set up Linq to enable iMessage.");
    expect(html).not.toContain("+12052611117");
    expect(html).not.toContain("sms:");
  });

  it("links the configured deployment number", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceManager, { linqPhoneNumber: "+12025550123" })
    );

    expect(html).toContain("sms:+12025550123");
    expect(html).toContain("iMessage opens +12025550123.");
  });
});
