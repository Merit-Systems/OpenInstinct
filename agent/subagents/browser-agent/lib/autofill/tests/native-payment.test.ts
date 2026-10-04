import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fillWithKernelNativeAutofill, PaymentFillError } from "../native";
import { frameOriginExpression } from "../login";

vi.mock("@onkernel/sdk", () => ({
  default: class {
    browsers = { retrieve: async () => ({ cdp_ws_url: "wss://kernel.test" }) };
  },
}));

const commandSchema = z.object({
  id: z.number(),
  method: z.string(),
  params: z.record(z.string(), z.json()).optional(),
  sessionId: z.string().optional(),
});
const commands: z.infer<typeof commandSchema>[] = [];
let pageOrigin = "https://shop.example";
let frameOrigin = "https://shop.example";
let failFill = false;
const filledCard = {
  number: "filled",
  expiry: "filled",
  securityCode: "filled",
};
let cardStatuses: Record<string, string>[] = [];

class BrowserSocket extends EventTarget {
  constructor() {
    super();
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  close() {
    this.dispatchEvent(new Event("close"));
  }
  send(data: string) {
    const command = commandSchema.parse(JSON.parse(data));
    commands.push(command);
    let result = {};
    switch (command.method) {
      case "Target.getTargets":
        result = {
          targetInfos: [
            { targetId: "page-1", type: "page", url: `${pageOrigin}/checkout` },
          ],
        };
        break;
      case "Target.attachToTarget":
        result = { sessionId: "cdp-1" };
        break;
      case "Page.getFrameTree":
        result = {
          frameTree: {
            frame: { id: "frame-1", url: `${frameOrigin}/checkout` },
          },
        };
        break;
      case "Page.createIsolatedWorld":
        result = { executionContextId: 1 };
        break;
      case "Runtime.evaluate": {
        const expression = z.string().parse(command.params?.expression);
        if (expression === frameOriginExpression)
          result = { result: { value: frameOrigin } };
        else if (expression.includes("securityCode"))
          result = {
            result: { value: cardStatuses.shift() ?? filledCard },
          };
        else if (expression.includes("flatMap"))
          result = {
            result: {
              value: [
                { autocomplete: "cc-number", focused: true, index: 0 },
                { autocomplete: "cc-csc", focused: false, index: 1 },
              ],
            },
          };
        else if (expression.includes("vaultSecret"))
          result = { result: { value: 2 } };
        else result = { result: { objectId: "input-1" } };
        break;
      }
      case "DOM.describeNode":
        result = { node: { backendNodeId: 1 } };
        break;
    }
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            id: command.id,
            result,
            error:
              command.method === "Autofill.trigger" && failFill
                ? { message: "unknown fill outcome" }
                : undefined,
          }),
        })
      )
    );
  }
}

const input = {
  browserSessionId: "browser-1",
  expectedOrigin: "https://shop.example",
  kind: "payment" as const,
  claims: Object.entries({
    "cc-name": "Test Buyer",
    "cc-number": "4242424242424242",
    "cc-csc": "098",
    "cc-exp-month": "12",
    "cc-exp-year": "2035",
  }).map(([token, value]) => ({ id: token, token, value })),
};
beforeEach(() => {
  commands.length = 0;
  pageOrigin = "https://shop.example";
  frameOrigin = pageOrigin;
  failFill = false;
  cardStatuses = [];
  vi.stubGlobal("WebSocket", BrowserSocket);
});
afterEach(() => vi.unstubAllGlobals());

describe("native payment injection", () => {
  it("marks controls before sending card fields through CDP and returns only a receipt", async () => {
    const result = await fillWithKernelNativeAutofill(input);
    const fillIndex = commands.findIndex(
      ({ method }) => method === "Autofill.trigger"
    );
    const maskIndex = commands.findIndex(({ params }) =>
      z.string().safeParse(params?.expression).data?.includes("vaultSecret")
    );
    expect(maskIndex).toBeGreaterThan(-1);
    expect(maskIndex).toBeLessThan(fillIndex);
    expect(commands[fillIndex]?.params?.card).toEqual({
      name: "Test Buyer",
      number: "4242424242424242",
      cvc: "098",
      expiryMonth: "12",
      expiryYear: "2035",
    });
    expect(result).toEqual({ filledClaims: 5, origin: "https://shop.example" });
  });
  it("waits for Chromium to apply the card before confirming it", async () => {
    cardStatuses = [
      { number: "empty", expiry: "empty", securityCode: "empty" },
      filledCard,
    ];
    await expect(fillWithKernelNativeAutofill(input)).resolves.toEqual({
      filledClaims: 5,
      origin: "https://shop.example",
    });
    expect(cardStatuses).toHaveLength(0);
  });
  it("reports annotated card fields left empty without retrying", async () => {
    cardStatuses = Array.from({ length: 8 }, () => ({
      number: "filled",
      expiry: "absent",
      securityCode: "empty",
    }));
    const result = fillWithKernelNativeAutofill(input);
    await expect(result).rejects.toBeInstanceOf(PaymentFillError);
    await expect(result).rejects.toThrow(
      "Card autofill left required fields empty: security code."
    );
    expect(
      commands.filter(({ method }) => method === "Autofill.trigger")
    ).toHaveLength(1);
  });
  it("does not require card fields that carry no autocomplete annotation", async () => {
    cardStatuses = [
      { number: "absent", expiry: "absent", securityCode: "absent" },
    ];
    await expect(fillWithKernelNativeAutofill(input)).resolves.toEqual({
      filledClaims: 5,
      origin: "https://shop.example",
    });
  });
  it("rechecks the top-level merchant origin before injection", async () => {
    pageOrigin = "https://other.example";
    await expect(fillWithKernelNativeAutofill(input)).rejects.toThrow(
      "no longer matches"
    );
    expect(commands.some(({ method }) => method === "Autofill.trigger")).toBe(
      false
    );
  });
  it("does not disclose cards to a cross-origin frame", async () => {
    frameOrigin = "https://processor.example";
    await expect(fillWithKernelNativeAutofill(input)).rejects.toThrow(
      "No visible form control"
    );
    expect(commands.some(({ method }) => method === "Autofill.trigger")).toBe(
      false
    );
  });
  it("does not try another control after an uncertain payment fill", async () => {
    failFill = true;
    await expect(fillWithKernelNativeAutofill(input)).rejects.toThrow(
      "unknown fill outcome"
    );
    expect(
      commands.filter(({ method }) => method === "Autofill.trigger")
    ).toHaveLength(1);
  });
});
