export const browserBenchmarkTasks = [
  {
    description: "Follow a link with semantic verification",
    expectedReplyIncludes: ["IANA-managed Reserved Domains"],
    expectedWorkerTools: ["browser_snapshot", "browser_act"],
    prompt:
      "Use the browser worker to open https://example.com, follow the More information link with semantic browser tools, verify the destination heading, and report it.",
  },
  {
    description: "Fill and submit a deterministic web form",
    expectedReplyIncludes: ["Form submitted", "Received!"],
    expectedWorkerTools: ["browser_snapshot", "browser_act"],
    prompt:
      "Use the browser worker to open https://www.selenium.dev/selenium/web/web-form.html, fill Text input with browser loop verified, submit the form with semantic browser tools, verify the resulting page, and report its heading and message.",
  },
  {
    description: "Wait for dynamically revealed content",
    expectedReplyIncludes: ["Reveal a new input", "visible"],
    expectedWorkerTools: ["browser_snapshot", "browser_act"],
    prompt:
      "Use the browser worker to open https://www.selenium.dev/selenium/web/dynamic.html, activate Reveal a new input with browser_act, semantically verify that a new textbox becomes visible, and report the control label and visible state.",
  },
] as const;
