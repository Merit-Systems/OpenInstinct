import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChannelsSection } from "@app/(authenticated)/(workspace)/page";

describe("workspace Linq channel", () => {
  it("disables iMessage without advertising another deployment's number", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelsSection, {
        browserReady: true,
        linqConfigured: false,
        linqPhoneNumber: undefined,
      })
    );

    expect(html).toContain("Set up Linq or Blooio to enable iMessage.");
    expect(html).not.toContain("+12052611117");
    expect(html).not.toContain("sms:");
  });

  it("links the configured deployment number", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelsSection, {
        browserReady: true,
        linqConfigured: true,
        linqPhoneNumber: "+12025550123",
      })
    );

    expect(html).toContain("sms:+12025550123");
    expect(html).toContain("iMessage opens +12025550123.");
  });

  it("reports a connected Linq line without requiring its number", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelsSection, {
        browserReady: true,
        linqConfigured: true,
        linqPhoneNumber: undefined,
      })
    );

    expect(html).toContain("Linq is connected.");
    expect(html).not.toContain("sms:");
  });

  it("links a Blooio number when Linq is not configured", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelsSection, {
        blooioConfigured: true,
        blooioPhoneNumber: "+12025550199",
        browserReady: true,
        linqConfigured: false,
        linqPhoneNumber: undefined,
      })
    );

    expect(html).toContain("sms:+12025550199");
    expect(html).toContain("iMessage opens +12025550199.");
    expect(html).not.toContain("Set up Linq or Blooio");
  });

  it("does not advertise a phone-number override without its connector", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelsSection, {
        browserReady: true,
        linqConfigured: false,
        linqPhoneNumber: "+12025550123",
      })
    );

    expect(html).toContain("Set up Linq or Blooio to enable iMessage.");
    expect(html).not.toContain("sms:");
  });
});
