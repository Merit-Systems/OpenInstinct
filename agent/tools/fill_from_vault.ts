import Kernel from "@onkernel/sdk";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { readVaultItem } from "@/db/services/vault";
import { scopeFromPrincipal, type AccessScope } from "@/lib/access-scope";
import { env } from "@/lib/env";
import type { VaultItemKind } from "@/lib/manager";
import { parsePaymentCardSecret } from "@/lib/manager/payment-card";
import { readSecret } from "@/lib/manager/server/secret-store";
import { requireOwnedBrowserSession } from "@/agent/extensions/kernel/browser-runtime";

const vaultAutofillFieldSchema = z.enum([
  "username",
  "password",
  "cardholder_name",
  "card_number",
  "expiration",
  "expiration_month",
  "expiration_year",
  "cvc",
  "billing_postal_code",
  "address",
  "phone",
  "identity",
  "token",
]);

const exactOriginSchema = z.url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && url.origin === value;
}, "Use the exact HTTP(S) origin without a path, query, or trailing slash.");

const vaultAutofillRequestSchema = z.object({
  browserSessionId: z.string().trim().min(1).max(500),
  expectedOrigin: exactOriginSchema,
  fields: z
    .array(
      z.object({
        field: vaultAutofillFieldSchema,
        frameSelector: z.string().trim().min(1).max(1_000).optional(),
        selector: z.string().trim().min(1).max(1_000),
      })
    )
    .min(1)
    .max(20),
  vaultItemId: z.uuid(),
});

const outputSchema = z.object({
  filledFields: z.array(z.string()),
  origin: z.string(),
  success: z.literal(true),
});

export default defineTool({
  description:
    "Fill supported saved fields in the active browser directly from an opaque local-vault handle without requesting another approval. Valid field names are username, password, cardholder_name, card_number, expiration, expiration_month, expiration_year, cvc, billing_postal_code, address, phone, identity, and token. Never invent field names. Secret values are read inside trusted device code and entered with Chrome-native card autofill when possible, then verified keyboard entry for unsupported or masked controls. Values and acceptance checks are never returned to the model. Inspect the page first, pass the exact current origin, browser session ID, and precise CSS selectors. Never use this to expose, inspect, or copy a secret.",
  inputSchema: vaultAutofillRequestSchema,
  outputSchema,
  async execute(input, context) {
    const caller =
      context.session.auth.current ?? context.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    const scope = scopeFromPrincipal(caller);
    const resolved = await prepareVaultAutofill(
      scope,
      input.vaultItemId,
      input.fields.map(({ field }) => field)
    );
    const fields = input.fields.map((target, index) => {
      const value = resolved.at(index)?.value;
      if (value === undefined) {
        throw new Error("The vault fields could not be prepared.");
      }
      return { ...target, value };
    });

    await requireOwnedBrowserSession(scope, input.browserSessionId);
    await fillKernelBrowser({
      browserSessionId: input.browserSessionId,
      expectedOrigin: input.expectedOrigin,
      fields,
      signal: context.abortSignal,
    });

    return {
      filledFields: resolved.map(({ field }) => field),
      origin: input.expectedOrigin,
      success: true as const,
    };
  },
});

async function prepareVaultAutofill(
  scope: AccessScope,
  vaultItemId: string,
  fields: Parameters<typeof resolveVaultAutofillValues>[2]
) {
  const item = await readVaultItem(scope, vaultItemId);
  if (!item) throw new Error("The selected vault item no longer exists.");

  const secret = await readSecret({ id: item.id, scope });
  if (secret === undefined) {
    throw new Error("The selected vault item no longer has a secret value.");
  }
  return resolveVaultAutofillValues(item, secret, fields);
}

async function fillKernelBrowser({
  browserSessionId,
  expectedOrigin,
  fields,
  signal,
}: {
  readonly browserSessionId: string;
  readonly expectedOrigin: string;
  readonly fields: readonly (z.infer<
    typeof vaultAutofillRequestSchema
  >["fields"][number] & { readonly value: string })[];
  readonly signal?: AbortSignal;
}) {
  const code = createVaultAutofillCode({ expectedOrigin, fields });

  try {
    const result = await new Kernel({
      apiKey: env.KERNEL_API_KEY,
    }).browsers.playwright.execute(
      browserSessionId,
      { code, timeout_sec: 30 },
      { signal }
    );
    if (!result.success)
      throw new Error("The browser rejected vault autofill.");
  } catch {
    throw new Error(
      "Secure vault fill failed. Check that the browser is open on the approved site."
    );
  }
}

function createVaultAutofillCode(payload: {
  readonly expectedOrigin: string;
  readonly fields: readonly (z.infer<
    typeof vaultAutofillRequestSchema
  >["fields"][number] & { readonly value: string })[];
}) {
  return `
const payload = ${JSON.stringify(payload)};
const keyboardFields = new Set([
  "card_number",
  "expiration",
  "expiration_month",
  "expiration_year",
  "cvc",
]);
const nativeCardFields = new Set([
  "cardholder_name",
  "card_number",
  "expiration",
  "expiration_month",
  "expiration_year",
  "cvc",
]);
const currentOrigin = new URL(page.url()).origin;
if (currentOrigin !== payload.expectedOrigin) {
  throw new Error("The active page does not match the approved origin.");
}

const fieldByName = new Map(payload.fields.map((field) => [field.field, field]));
const combinedExpiration = fieldByName.get("expiration")?.value ?? "";
const expirationDigits = combinedExpiration.replaceAll(/\\D/gu, "");
const expirationMonth =
  fieldByName.get("expiration_month")?.value ?? expirationDigits.slice(0, 2);
const expirationYearValue =
  fieldByName.get("expiration_year")?.value ?? expirationDigits.slice(2);
const expirationYear =
  expirationYearValue.length === 2
    ? "20" + expirationYearValue
    : expirationYearValue;
const nativeCard = {
  cvc: fieldByName.get("cvc")?.value,
  expiryMonth: expirationMonth.padStart(2, "0"),
  expiryYear: expirationYear,
  name: fieldByName.get("cardholder_name")?.value,
  number: fieldByName.get("card_number")?.value,
};
const nativeAnchor = fieldByName.get("card_number");
const canUseNativeCardAutofill =
  nativeAnchor !== undefined &&
  nativeAnchor.frameSelector === undefined &&
  Object.values(nativeCard).every(
    (value) => typeof value === "string" && value.length > 0,
  );

if (canUseNativeCardAutofill) {
  for (const field of payload.fields.filter(
    (candidate) =>
      candidate.frameSelector === undefined &&
      nativeCardFields.has(candidate.field),
  )) {
    await page.locator(field.selector).first().evaluate((node) => {
      if (node instanceof HTMLElement) node.dataset.vaultSecret = "true";
    });
  }

  let cdp;
  try {
    cdp = await context.newCDPSession(page);
    await cdp.send("DOM.enable");
    const { root } = await cdp.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: nativeAnchor.selector,
    });
    if (nodeId === 0) throw new Error("The card field is unavailable.");
    const { node } = await cdp.send("DOM.describeNode", { nodeId });
    await cdp.send("Autofill.trigger", {
      card: nativeCard,
      fieldId: node.backendNodeId,
    });
  } catch {
    // Chrome does not classify every merchant form as an autofill form. The
    // verified keyboard path below remains the compatibility fallback.
  } finally {
    if (cdp) await cdp.detach();
  }
}

for (const field of payload.fields) {
  const root = field.frameSelector ? page.frameLocator(field.frameSelector) : page;
  const element = root.locator(field.selector).first();
  await element.waitFor({ state: "visible", timeout: 5000 });
  await element.evaluate((node) => {
    if (node instanceof HTMLElement) {
      node.dataset.vaultSecret = "true";
    }
  });

  const isSelect = await element.evaluate(
    (node) => node instanceof HTMLSelectElement,
  );
  if (isSelect) {
    const optionValue = await element.evaluate((node, target) => {
      if (!(node instanceof HTMLSelectElement)) return null;
      const expected = target.value;
      const expectedDigits = expected.replaceAll(/\\D/gu, "");
      const option = Array.from(node.options).find((candidate) => {
        if (candidate.value === expected || candidate.label === expected) {
          return true;
        }
        if (expectedDigits.length === 0) return false;
        return [candidate.value, candidate.label].some((value) => {
          const digits = value.replaceAll(/\\D/gu, "");
          if (digits === expectedDigits) return true;
          if (target.field === "expiration_month") {
            return Number(digits) === Number(expectedDigits);
          }
          if (target.field === "expiration_year") {
            return (
              digits.endsWith(expectedDigits) || expectedDigits.endsWith(digits)
            );
          }
          return false;
        });
      });
      return option?.value ?? null;
    }, { field: field.field, value: field.value });
    if (optionValue === null) {
      throw new Error("An approved select target has no matching option.");
    }
    await element.selectOption(optionValue);
    continue;
  }

  if (!(await element.isEditable())) {
    throw new Error("An approved target is not editable.");
  }

  const readValue = () =>
    element.evaluate((node) => {
      if (
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement
      ) {
        return node.value;
      }
      return node.textContent ?? "";
    });

  const enterWithKeyboard = async () => {
    await element.focus();
    await element.press("ControlOrMeta+A");
    await element.press("Backspace");
    await element.pressSequentially(field.value, { delay: 5 });
  };

  const acceptsValue = (enteredValue) => {
    const enteredDigits = enteredValue.replaceAll(/\\D/gu, "");
    const expectedDigits = field.value.replaceAll(/\\D/gu, "");
    if (field.field === "expiration_month") {
      return Number(enteredDigits) === Number(expectedDigits);
    }
    if (field.field === "expiration_year") {
      return (
        enteredDigits.endsWith(expectedDigits) ||
        expectedDigits.endsWith(enteredDigits)
      );
    }
    if (field.field === "expiration") {
      return (
        enteredDigits === expectedDigits ||
        enteredDigits.endsWith(expectedDigits.slice(-4))
      );
    }
    if (keyboardFields.has(field.field)) {
      return enteredDigits === expectedDigits;
    }
    return enteredValue.length > 0;
  };

  if (!acceptsValue(await readValue())) {
    if (keyboardFields.has(field.field)) {
      await enterWithKeyboard();
    } else {
      await element.fill(field.value);
      if (!acceptsValue(await readValue())) {
        await enterWithKeyboard();
      }
    }
  }

  await element.dispatchEvent("change");
  await element.blur();

  const enteredValue = await readValue();
  if (!acceptsValue(enteredValue)) {
    throw new Error("An approved target did not accept secure input.");
  }
}
return {
  filledFields: payload.fields.map(({ field }) => field),
  origin: currentOrigin,
  success: true,
};`;
}

function resolveVaultAutofillValues(
  item: {
    readonly account: string;
    readonly kind: VaultItemKind;
  },
  secret: string,
  fields: readonly z.infer<typeof vaultAutofillFieldSchema>[]
) {
  const values = vaultValues(item, secret);

  return fields.map((field) => {
    const value = values.get(field);
    if (value === undefined || value.length === 0) {
      throw new Error(
        `The selected ${item.kind} vault item does not provide ${field}.`
      );
    }
    return { field, value };
  });
}

function vaultValues(
  item: {
    readonly account: string;
    readonly kind: VaultItemKind;
  },
  secret: string
) {
  const values = new Map<z.infer<typeof vaultAutofillFieldSchema>, string>();

  switch (item.kind) {
    case "login":
      values.set("username", item.account);
      values.set("password", secret);
      break;
    case "payment": {
      const card = parsePaymentCardSecret(secret);
      const month = card.expirationMonth.toString().padStart(2, "0");
      const year = card.expirationYear.toString();
      values.set("cardholder_name", card.cardholderName);
      values.set("card_number", card.number);
      values.set("expiration", `${month}/${year.slice(-2)}`);
      values.set("expiration_month", month);
      values.set("expiration_year", year);
      values.set("cvc", card.securityCode);
      values.set("billing_postal_code", card.billingPostalCode);
      break;
    }
    case "address":
      values.set("address", secret);
      break;
    case "phone":
      values.set("phone", secret);
      break;
    case "identity":
      values.set("identity", secret);
      break;
    case "token":
      values.set("token", secret);
      break;
  }

  return values;
}
