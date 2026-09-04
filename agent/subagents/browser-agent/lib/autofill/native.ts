import Kernel from "@onkernel/sdk";
import { z } from "zod";
import { env } from "@shared/environment";
import type { AutofillClaim } from "./protocol";
import {
  classifyNativeLoginControl,
  frameOriginExpression,
  nativeLoginAutofillTokens,
  nativeLoginControlInspectionExpression,
  nativeLoginFillFunctionDeclaration,
  selectNativeLoginFills,
  type ClassifiedNativeLoginControl,
} from "./login";

const targetListSchema = z.object({
  targetInfos: z.array(
    z.object({
      targetId: z.string(),
      type: z.string(),
      url: z.string(),
    })
  ),
});

const attachedTargetSchema = z.object({ sessionId: z.string() });

type CdpCommandValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | readonly CdpCommandValue[]
  | { readonly [key: string]: CdpCommandValue };

const frameTreeSchema = z.object({
  frameTree: z.lazy(() => frameTreeNodeSchema),
});
const frameTreeNodeSchema: z.ZodType<{
  childFrames?: z.infer<typeof frameTreeNodeSchema>[];
  frame: { id: string; url: string };
}> = z.object({
  childFrames: z.array(z.lazy(() => frameTreeNodeSchema)).optional(),
  frame: z.object({ id: z.string(), url: z.string() }),
});

const isolatedWorldSchema = z.object({ executionContextId: z.number() });
const cdpValueSchema = z.json();
const evaluatedValueSchema = z.object({
  result: z.object({ value: cdpValueSchema }),
});
const evaluatedBooleanSchema = z.object({
  result: z.object({ value: z.boolean() }),
});
const evaluatedStringSchema = z.object({
  result: z.object({ value: z.string() }),
});
const evaluatedNumberSchema = z.object({
  result: z.object({ value: z.number().int().nonnegative() }),
});
const evaluatedObjectSchema = z.object({
  result: z.object({ objectId: z.string().optional() }),
});
const describedNodeSchema = z.object({
  node: z.object({ backendNodeId: z.number().int().positive() }),
});
const controlDescriptorsSchema = z.array(
  z.object({
    autocomplete: z.string(),
    focused: z.boolean(),
    index: z.number().int().nonnegative(),
  })
);
const loginControlDescriptorsSchema = z.array(
  z.object({
    autocomplete: z.string(),
    focused: z.boolean(),
    formIndex: z.number().int().nonnegative().nullable(),
    index: z.number().int().nonnegative(),
    label: z.string(),
    name: z.string(),
    type: z.string(),
  })
);

const cardTokens = [
  "cc-name",
  "cc-number",
  "cc-exp-month",
  "cc-exp-year",
  "cc-csc",
] as const;

const addressTokenToChromiumField = {
  name: "NAME_FULL",
  "street-address": "ADDRESS_HOME_STREET_ADDRESS",
  "address-line1": "ADDRESS_HOME_LINE1",
  "address-line2": "ADDRESS_HOME_LINE2",
  "address-level2": "ADDRESS_HOME_CITY",
  "address-level1": "ADDRESS_HOME_STATE",
  "postal-code": "ADDRESS_HOME_ZIP",
  country: "ADDRESS_HOME_COUNTRY",
} as const;

const contactTokenToChromiumField = {
  name: "NAME_FULL",
  email: "EMAIL_ADDRESS",
  tel: "PHONE_HOME_WHOLE_NUMBER",
  "bday-day": "BIRTHDATE_DAY",
  "bday-month": "BIRTHDATE_MONTH",
  "bday-year": "BIRTHDATE_4_DIGIT_YEAR",
} as const;

export const nativeAutofillTokens = {
  address: Object.keys(addressTokenToChromiumField),
  contact: Object.keys(contactTokenToChromiumField),
  login: nativeLoginAutofillTokens,
  payment: [...cardTokens],
} as const;

type NativeAutofillKind = "address" | "contact" | "login" | "payment";

export async function currentKernelPageOrigin({
  browserSessionId,
  signal,
}: {
  readonly browserSessionId: string;
  readonly signal?: AbortSignal;
}) {
  return withKernelPage(browserSessionId, signal, async ({ origin }) => origin);
}

export async function fillWithKernelNativeAutofill({
  browserSessionId,
  claims,
  expectedOrigin,
  kind,
  signal,
}: {
  readonly browserSessionId: string;
  readonly claims: readonly AutofillClaim[];
  readonly expectedOrigin: string;
  readonly kind: NativeAutofillKind;
  readonly signal?: AbortSignal;
}) {
  const payload =
    kind === "login" ? undefined : buildNativeAutofillPayload(kind, claims);

  return withKernelPage(
    browserSessionId,
    signal,
    async ({ connection, origin, sessionId }) => {
      if (origin !== expectedOrigin) {
        throw new Error(
          "The active tab no longer matches the approved origin."
        );
      }

      if (kind === "login") {
        const filledClaims = await fillNativeLoginControls(
          connection,
          sessionId,
          claims,
          expectedOrigin
        );
        return { filledClaims, origin };
      }

      const controls = await inspectControls(
        connection,
        sessionId,
        kind,
        expectedOrigin
      );
      if (controls.length === 0) {
        throw new Error("No visible form control is available for autofill.");
      }

      let lastError: unknown;
      /* oxlint-disable eslint/no-await-in-loop -- Autofill tries controls in priority order and stops after the first accepted target. */
      for (const control of controls) {
        try {
          await markNativeAutofilledControls(connection, control);
          await connection.send(
            "Autofill.trigger",
            {
              fieldId: control.backendNodeId,
              frameId: control.frameId,
              ...payload,
            },
            control.sessionId
          );
        } catch (error) {
          lastError = error;
          continue;
        }
        return { filledClaims: claims.length, origin };
      }
      /* oxlint-enable eslint/no-await-in-loop */

      throw new Error(
        "Chromium could not autofill any visible control. Focus a field in the intended card or address form and retry.",
        { cause: lastError }
      );
    }
  );
}

async function fillNativeLoginControls(
  connection: CdpConnection,
  sessionIds: readonly string[],
  claims: readonly AutofillClaim[],
  expectedOrigin: string
) {
  const controls = await inspectNativeLoginControls(
    connection,
    sessionIds,
    expectedOrigin
  );
  const focused = controls.find((control) => control.focused);
  if (!focused) {
    throw new Error(
      "Focus a visible username, email, phone, or current-password field and retry."
    );
  }
  const sameFrame = controls.filter(
    (control) =>
      control.frameId === focused.frameId &&
      control.sessionId === focused.sessionId
  );
  const fills = selectNativeLoginFills(sameFrame, claims);
  if (fills.length === 0) {
    throw new Error(
      "The focused login form does not accept a field available in this saved login."
    );
  }

  /* oxlint-disable eslint/no-await-in-loop -- Login fields must be filled in DOM order so page validation sees coherent intermediate state. */
  for (const { control, value } of fills) {
    const accepted = await fillNativeLoginControl(
      connection,
      control,
      value,
      expectedOrigin
    );
    if (!accepted) {
      throw new Error(
        "The login form rejected secure credential autofill or is not served from the saved origin."
      );
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return fills.length;
}

async function inspectNativeLoginControls(
  connection: CdpConnection,
  sessionIds: readonly string[],
  expectedOrigin: string
) {
  return (
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        try {
          await connection.send("Page.enable", undefined, sessionId);
          const { frameTree } = frameTreeSchema.parse(
            await connection.send("Page.getFrameTree", undefined, sessionId)
          );
          return (
            await Promise.all(
              flattenFrames(frameTree).map(({ id: frameId }) =>
                inspectNativeLoginFrame(
                  connection,
                  sessionId,
                  frameId,
                  expectedOrigin
                ).catch(() => [])
              )
            )
          ).flat();
        } catch {
          return [];
        }
      })
    )
  ).flat();
}

async function inspectNativeLoginFrame(
  connection: CdpConnection,
  sessionId: string,
  frameId: string,
  expectedOrigin: string
) {
  const { executionContextId } = isolatedWorldSchema.parse(
    await connection.send(
      "Page.createIsolatedWorld",
      { frameId, worldName: "open-instinct-login-autofill" },
      sessionId
    )
  );
  if (
    !(await isFrameAtOrigin(
      connection,
      sessionId,
      executionContextId,
      expectedOrigin
    ))
  ) {
    return [];
  }
  const response = evaluatedValueSchema.parse(
    await connection.send(
      "Runtime.evaluate",
      {
        contextId: executionContextId,
        expression: nativeLoginControlInspectionExpression,
        returnByValue: true,
      },
      sessionId
    )
  );
  const descriptors = loginControlDescriptorsSchema.parse(
    response.result.value
  );
  return descriptors.flatMap((descriptor) => {
    const classified = classifyNativeLoginControl(descriptor);
    return classified
      ? [{ ...classified, executionContextId, frameId, sessionId }]
      : [];
  });
}

async function fillNativeLoginControl(
  connection: CdpConnection,
  control: ClassifiedNativeLoginControl & {
    readonly executionContextId: number;
    readonly frameId: string;
    readonly sessionId: string;
  },
  value: string,
  expectedOrigin: string
) {
  const evaluated = evaluatedObjectSchema.parse(
    await connection.send(
      "Runtime.evaluate",
      {
        contextId: control.executionContextId,
        expression: `document.querySelectorAll("input").item(${String(control.index)})`,
      },
      control.sessionId
    )
  );
  const objectId = evaluated.result.objectId;
  if (!objectId) return false;

  try {
    const response = evaluatedBooleanSchema.parse(
      await connection.send(
        "Runtime.callFunctionOn",
        {
          arguments: [{ value }, { value: expectedOrigin }],
          awaitPromise: false,
          functionDeclaration: nativeLoginFillFunctionDeclaration,
          objectId,
          returnByValue: true,
        },
        control.sessionId
      )
    );
    return response.result.value;
  } finally {
    await connection
      .send("Runtime.releaseObject", { objectId }, control.sessionId)
      .catch(() => undefined);
  }
}

export function buildNativeAutofillPayload(
  kind: "address" | "contact" | "payment",
  claims: readonly Pick<AutofillClaim, "token" | "value">[]
) {
  const values = new Map(claims.map(({ token, value }) => [token, value]));

  if (kind === "payment") {
    return {
      card: {
        cvc: requiredClaim(values, "cc-csc"),
        expiryMonth: requiredClaim(values, "cc-exp-month"),
        expiryYear: requiredClaim(values, "cc-exp-year"),
        name: requiredClaim(values, "cc-name"),
        number: requiredClaim(values, "cc-number"),
      },
    };
  }

  const tokenMap =
    kind === "address"
      ? addressTokenToChromiumField
      : contactTokenToChromiumField;
  const fields = Object.entries(tokenMap).flatMap(([token, name]) => {
    const value = values.get(token);
    return value ? [{ name, value }] : [];
  });
  if (fields.length === 0) {
    throw new Error(`The saved ${kind} is incomplete or invalid.`);
  }
  return { address: { fields } };
}

async function inspectControls(
  connection: CdpConnection,
  sessionIds: readonly string[],
  kind: "address" | "contact" | "payment",
  expectedOrigin: string
) {
  const controls = (
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        try {
          await connection.send("Page.enable", undefined, sessionId);
          const { frameTree } = frameTreeSchema.parse(
            await connection.send("Page.getFrameTree", undefined, sessionId)
          );
          return (
            await Promise.all(
              flattenFrames(frameTree).map(({ id: frameId }) =>
                inspectFrameControls(
                  connection,
                  sessionId,
                  frameId,
                  kind,
                  expectedOrigin
                ).catch(() => [])
              )
            )
          ).flat();
        } catch {
          return [];
        }
      })
    )
  ).flat();

  return controls.toSorted((left, right) => {
    if (left.focused !== right.focused) return left.focused ? -1 : 1;
    if (left.standard !== right.standard) return left.standard ? -1 : 1;
    return left.order - right.order;
  });
}

async function inspectFrameControls(
  connection: CdpConnection,
  sessionId: string,
  frameId: string,
  kind: "address" | "contact" | "payment",
  expectedOrigin: string
) {
  const { executionContextId } = isolatedWorldSchema.parse(
    await connection.send(
      "Page.createIsolatedWorld",
      { frameId, worldName: "open-instinct-autofill" },
      sessionId
    )
  );
  // Chromium's Autofill.trigger writes into whichever frame owns the control,
  // so only controls in documents served from the saved origin are eligible.
  if (
    !(await isFrameAtOrigin(
      connection,
      sessionId,
      executionContextId,
      expectedOrigin
    ))
  ) {
    return [];
  }
  const response = evaluatedValueSchema.parse(
    await connection.send(
      "Runtime.evaluate",
      {
        contextId: executionContextId,
        expression: controlInspectionExpression,
        returnByValue: true,
      },
      sessionId
    )
  );
  const descriptors = controlDescriptorsSchema.parse(response.result.value);

  return (
    await Promise.all(
      descriptors.map(async (descriptor, order) => {
        const evaluated = evaluatedObjectSchema.parse(
          await connection.send(
            "Runtime.evaluate",
            {
              contextId: executionContextId,
              expression: `document.querySelectorAll("input, select, textarea").item(${String(descriptor.index)})`,
            },
            sessionId
          )
        );
        const objectId = evaluated.result.objectId;
        if (!objectId) return null;

        try {
          const described = describedNodeSchema.parse(
            await connection.send("DOM.describeNode", { objectId }, sessionId)
          );
          return {
            backendNodeId: described.node.backendNodeId,
            executionContextId,
            focused: descriptor.focused,
            frameId,
            index: descriptor.index,
            order,
            sessionId,
            standard: standardAutocomplete(kind, descriptor.autocomplete),
          };
        } finally {
          await connection
            .send("Runtime.releaseObject", { objectId }, sessionId)
            .catch(() => undefined);
        }
      })
    )
  ).filter((control) => control !== null);
}

async function isFrameAtOrigin(
  connection: CdpConnection,
  sessionId: string,
  executionContextId: number,
  expectedOrigin: string
) {
  const response = evaluatedStringSchema.parse(
    await connection.send(
      "Runtime.evaluate",
      {
        contextId: executionContextId,
        expression: frameOriginExpression,
        returnByValue: true,
      },
      sessionId
    )
  );
  return response.result.value === expectedOrigin;
}

const controlInspectionExpression = `(() => {
  const elements = Array.from(document.querySelectorAll("input, select, textarea"));
  return elements.flatMap((element, index) => {
    if (element.disabled || ("readOnly" in element && element.readOnly)) return [];
    if (element instanceof HTMLInputElement && ["hidden", "submit", "button", "reset", "file", "image", "checkbox", "radio"].includes(element.type)) return [];
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || element.getClientRects().length === 0) return [];
    return [{ autocomplete: element.autocomplete || "", focused: document.activeElement === element, index }];
  });
})()`;

export function nativeAutofillSecretMarkingExpression(index: number) {
  return `(() => {
    const controls = document.querySelectorAll("input, select, textarea");
    const anchor = controls.item(${String(index)});
    if (!anchor) return 0;
    const root = anchor.form || anchor.closest("form") || document;
    let marked = 0;
    for (const element of root.querySelectorAll("input, select, textarea")) {
      if (element.disabled || ("readOnly" in element && element.readOnly)) continue;
      if (element instanceof HTMLInputElement && ["hidden", "submit", "button", "reset", "file", "image", "checkbox", "radio"].includes(element.type)) continue;
      element.dataset.vaultSecret = "true";
      marked += 1;
    }
    return marked;
  })()`;
}

async function markNativeAutofilledControls(
  connection: CdpConnection,
  control: {
    readonly executionContextId: number;
    readonly index: number;
    readonly sessionId: string;
  }
) {
  const response = evaluatedNumberSchema.parse(
    await connection.send(
      "Runtime.evaluate",
      {
        contextId: control.executionContextId,
        expression: nativeAutofillSecretMarkingExpression(control.index),
        returnByValue: true,
      },
      control.sessionId
    )
  );
  if (response.result.value === 0) {
    throw new Error(
      "Vault-filled controls could not be marked for screenshot masking."
    );
  }
}

async function withKernelPage<T>(
  browserSessionId: string,
  signal: AbortSignal | undefined,
  operation: (page: {
    readonly connection: CdpConnection;
    readonly origin: string;
    readonly sessionId: readonly string[];
  }) => Promise<T>
) {
  const browser = await new Kernel({
    apiKey: env.KERNEL_API_KEY,
  }).browsers.retrieve(browserSessionId, {}, { signal });
  const connection = await CdpConnection.connect(browser.cdp_ws_url, signal);

  try {
    const { targetInfos } = targetListSchema.parse(
      await connection.send("Target.getTargets")
    );
    const target = targetInfos.findLast(
      ({ type, url }) => type === "page" && isWebUrl(url)
    );
    if (!target) throw new Error("No active browser tab was found.");

    const { sessionId: pageSessionId } = attachedTargetSchema.parse(
      await connection.send("Target.attachToTarget", {
        flatten: true,
        targetId: target.targetId,
      })
    );
    const sessionIds = [pageSessionId];
    try {
      await connection.send("Page.enable", undefined, pageSessionId);
      const { frameTree } = frameTreeSchema.parse(
        await connection.send("Page.getFrameTree", undefined, pageSessionId)
      );
      const frameIds = new Set(flattenFrames(frameTree).map(({ id }) => id));
      const iframeTargets = targetInfos.filter(
        ({ targetId, type }) => type === "iframe" && frameIds.has(targetId)
      );
      /* oxlint-disable eslint/no-await-in-loop -- CDP target attachment mutates one connection and session IDs are collected in target order. */
      for (const iframeTarget of iframeTargets) {
        const attached = attachedTargetSchema.safeParse(
          await connection
            .send("Target.attachToTarget", {
              flatten: true,
              targetId: iframeTarget.targetId,
            })
            .catch(() => undefined)
        );
        if (attached.success) sessionIds.push(attached.data.sessionId);
      }
      /* oxlint-enable eslint/no-await-in-loop */

      return await operation({
        connection,
        origin: new URL(target.url).origin,
        sessionId: sessionIds,
      });
    } finally {
      await Promise.all(
        sessionIds.map((sessionId) =>
          connection
            .send("Target.detachFromTarget", { sessionId })
            .catch(() => undefined)
        )
      );
    }
  } finally {
    connection.close();
  }
}

class CdpConnection {
  readonly #pending = new Map<
    number,
    {
      readonly reject: (cause?: unknown) => void;
      readonly resolve: (
        value: z.infer<typeof cdpValueSchema> | undefined
      ) => void;
    }
  >();
  #nextId = 1;

  private constructor(
    private readonly socket: WebSocket,
    signal: AbortSignal | undefined
  ) {
    socket.addEventListener("message", (event) => {
      this.#onMessage(event);
    });
    socket.addEventListener("close", () => {
      this.#rejectPending(new Error("The Kernel CDP connection closed."));
    });
    signal?.addEventListener(
      "abort",
      () => {
        this.close();
      },
      { once: true }
    );
  }

  static async connect(url: string, signal?: AbortSignal) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Could not connect to the Kernel browser over CDP."));
      };
      const onAbort = () => {
        cleanup();
        socket.close();
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new Error("The CDP connection was aborted.")
        );
      };
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    return new CdpConnection(socket, signal);
  }

  send(method: string, params?: CdpCommandValue, sessionId?: string) {
    const id = this.#nextId++;
    return new Promise<z.infer<typeof cdpValueSchema> | undefined>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          this.#pending.delete(id);
          reject(new Error(`Chromium did not respond to ${method}.`));
        }, 15_000);
        this.#pending.set(id, {
          reject(cause) {
            clearTimeout(timeout);
            reject(
              cause instanceof Error
                ? cause
                : new Error("The Chromium command failed.")
            );
          },
          resolve(value) {
            clearTimeout(timeout);
            resolve(value);
          },
        });
        this.socket.send(JSON.stringify({ id, method, params, sessionId }));
      }
    );
  }

  close() {
    this.socket.close();
  }

  #onMessage(event: MessageEvent) {
    const eventData = z.string().safeParse(event.data);
    if (!eventData.success) return;
    let rawMessage: z.infer<typeof cdpValueSchema>;
    try {
      const parsed = cdpValueSchema.safeParse(JSON.parse(eventData.data));
      if (!parsed.success) return;
      rawMessage = parsed.data;
    } catch {
      return;
    }
    const message = cdpResponseSchema.safeParse(rawMessage);
    if (!message.success || message.data.id === undefined) return;
    const pending = this.#pending.get(message.data.id);
    if (!pending) return;
    this.#pending.delete(message.data.id);
    if (message.data.error) {
      pending.reject(new Error(message.data.error.message));
    } else {
      pending.resolve(message.data.result);
    }
  }

  #rejectPending(error: Error) {
    for (const { reject } of this.#pending.values()) reject(error);
    this.#pending.clear();
  }
}

const cdpResponseSchema = z.object({
  error: z.object({ message: z.string() }).optional(),
  id: z.number().int().optional(),
  result: cdpValueSchema.optional(),
});

function flattenFrames(
  node: z.infer<typeof frameTreeNodeSchema>
): { readonly id: string; readonly url: string }[] {
  return [
    node.frame,
    ...(node.childFrames ?? []).flatMap((child) => flattenFrames(child)),
  ];
}

function standardAutocomplete(
  kind: "address" | "contact" | "payment",
  autocomplete: string
) {
  const token = autocomplete
    .toLowerCase()
    .split(/\s+/u)
    .findLast((value) => Boolean(value));
  if (!token) return false;
  if (kind === "payment") return token.startsWith("cc-");
  if (kind === "contact") {
    return Object.keys(contactTokenToChromiumField).includes(token);
  }
  return [
    "name",
    "street-address",
    "address-line1",
    "address-line2",
    "address-line3",
    "address-level1",
    "address-level2",
    "postal-code",
    "country",
    "country-name",
  ].includes(token);
}

function requiredClaim(values: ReadonlyMap<string, string>, token: string) {
  const value = values.get(token);
  if (!value)
    throw new Error("The saved payment card is incomplete or invalid.");
  return value;
}

function isWebUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
