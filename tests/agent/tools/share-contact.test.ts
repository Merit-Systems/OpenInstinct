import type { DynamicResolveContext, ToolContext } from "eve/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as EnvModule from "@shared/environment";
import type { readLinqOnboardingPhoneNumber } from "@db/services/auth/linq";
import { contactDelivery } from "@agent/lib/contact-card";
import messaging from "@agent/tools/messaging";
import { sendMessageOutputSchema } from "@shared/chat/message-delivery";

const controls = vi.hoisted(() => ({
  // SAFETY: Tests replace only this optional configured E.164 phone number.
  phone: "+12025550123" as string | undefined,
  readPhone: vi.fn<typeof readLinqOnboardingPhoneNumber>(),
  // SAFETY: The mock adds only zero-argument state reset callbacks.
  reset: [] as (() => void)[],
}));

vi.mock("eve/context", () => ({
  defineState<T>(_name: string, initial: () => T) {
    let value = initial();
    controls.reset.push(() => {
      value = initial();
    });
    return {
      get: () => value,
      update(update: (current: T) => T) {
        value = update(value);
      },
    };
  },
}));
vi.mock("@db/services/auth/linq", () => ({
  readLinqOnboardingPhoneNumber: controls.readPhone,
}));
vi.mock("@shared/environment", async (importOriginal) => {
  const original = await importOriginal<typeof EnvModule>();
  return {
    ...original,
    env: {
      ...original.env,
      LINQ_CONNECTOR: "linq/openinstinct",
      get LINQ_PHONE_NUMBER() {
        return controls.phone;
      },
    },
  };
});

beforeEach(() => {
  for (const reset of controls.reset) reset();
  vi.clearAllMocks();
  controls.phone = "+12025550123";
  controls.readPhone.mockResolvedValue("+12025550456");
});

describe("share_contact", () => {
  it("returns a branded contact attachment and preserves it on a retry", async () => {
    const tool = await shareContactTool();
    const first = await tool.execute(
      { text: "Save my contact." },
      toolContext()
    );
    expect(first).toMatchObject({
      kind: "message",
      text: "Save my contact.",
      attachments: [
        {
          kind: "file",
          mimeType: "text/vcard",
          name: "OpenInstinct.vcf",
        },
      ],
    });
    const contact = sendMessageOutputSchema.parse(first);
    expect(
      contact.kind === "message" && contact.attachments?.[0]?.url
    ).toContain(
      "https://example.com/contacts/openinstinct.vcf?phone=%2B12025550123&expires="
    );
    expect(controls.readPhone).not.toHaveBeenCalled();
    expect(contactDelivery.get()?.sent).toBe(false);
    expect(
      await tool.execute({ text: "Rephrased introduction." }, toolContext())
    ).toEqual(first);

    contactDelivery.update(
      (delivery) => delivery && { ...delivery, sent: true }
    );
    expect(await tool.execute({ text: "Again." }, toolContext())).toBeNull();
  });

  it("uses the connector's onboarding number when no number is configured", async () => {
    controls.phone = undefined;
    const tool = await shareContactTool();
    const output = await tool.execute({ text: "Save me." }, toolContext());
    const contact = sendMessageOutputSchema.parse(output);
    expect(controls.readPhone).toHaveBeenCalledExactlyOnceWith(
      "linq/openinstinct"
    );
    expect(
      contact.kind === "message" && contact.attachments?.[0]?.url
    ).toContain("phone=%2B12025550456");
  });

  it("fails without preparing a delivery when the number is unavailable", async () => {
    controls.phone = undefined;
    controls.readPhone.mockResolvedValue(undefined);
    const tool = await shareContactTool();
    await expect(
      tool.execute({ text: "Save me." }, toolContext())
    ).rejects.toThrow("number is unavailable");
    expect(contactDelivery.get()).toBeNull();
  });

  it("requires an authenticated workspace user and is root-only", async () => {
    const tool = await shareContactTool();
    expect(tool.availableInSubagents).toBe(false);
    const context = toolContext();
    await expect(
      tool.execute(
        { text: "Save me." },
        {
          ...context,
          session: {
            ...context.session,
            auth: { current: null, initiator: null },
          },
        }
      )
    ).rejects.toThrow("authenticated user");
    expect(contactDelivery.get()).toBeNull();
  });
});

async function shareContactTool() {
  const resolve = messaging.events["turn.started"];
  if (!resolve) throw new Error("Expected messaging resolver.");
  const tools = await resolve({}, {
    channel: { kind: "http", metadata: {} },
    messages: [],
    model: null,
    session: toolContext().session,
  } satisfies DynamicResolveContext);
  if (!tools || !("share_contact" in tools)) {
    throw new Error("Expected share_contact tool.");
  }
  return tools.share_contact;
}

function toolContext() {
  return {
    abortSignal: new AbortController().signal,
    callId: "contact-call-1",
    toolName: "share_contact",
    async getSandbox() {
      throw new Error("Unexpected sandbox access.");
    },
    async getToken() {
      throw new Error("Unexpected token access.");
    },
    requireAuth() {
      throw new Error("Unexpected connection authorization.");
    },
    session: {
      auth: {
        current: {
          attributes: { workspaceId: "workspace-1" },
          authenticator: "authjs",
          principalId: "user-1",
          principalType: "user",
        },
        initiator: null,
      },
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
  } satisfies ToolContext;
}
