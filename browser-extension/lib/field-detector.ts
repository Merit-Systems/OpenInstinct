import type {
  AutofillSurfaceKind,
  DetectedAutofillField,
  DetectedAutofillSurface,
} from "../../lib/vault-autofill-protocol";

export interface AutofillElementDescriptor {
  readonly autocomplete: string;
  readonly label: string;
  readonly name: string;
  readonly type: string;
}

type FillableElement =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement;

const autocompleteKinds = new Map<string, AutofillSurfaceKind>([
  ["username", "credentials"],
  ["current-password", "credentials"],
  ["new-password", "credentials"],
  ["cc-name", "payment-card"],
  ["cc-number", "payment-card"],
  ["cc-exp", "payment-card"],
  ["cc-exp-month", "payment-card"],
  ["cc-exp-year", "payment-card"],
  ["cc-csc", "payment-card"],
  ["street-address", "postal-address"],
  ["address-line1", "postal-address"],
  ["address-line2", "postal-address"],
  ["address-line3", "postal-address"],
  ["postal-code", "postal-address"],
  ["email", "contact"],
  ["tel", "contact"],
  ["name", "identity"],
  ["given-name", "identity"],
  ["additional-name", "identity"],
  ["family-name", "identity"],
  ["one-time-code", "secret"],
]);

const fieldPatterns: readonly {
  readonly kind: AutofillSurfaceKind;
  readonly pattern: RegExp;
  readonly token: string;
}[] = [
  {
    kind: "payment-card",
    pattern: /(?:card|credit|debit|cc)\s*(?:number|num|no)|pan/u,
    token: "cc-number",
  },
  {
    kind: "payment-card",
    pattern: /name\s*on\s*card|cardholder|card\s*holder|cc\s*name/u,
    token: "cc-name",
  },
  {
    kind: "payment-card",
    pattern:
      /(?:exp|expiry|expiration)(?:\s*date)?\s*(?:mm|month)\s*(?:yy|yyyy|year)/u,
    token: "cc-exp",
  },
  {
    kind: "payment-card",
    pattern: /(?:exp|expiry|expiration)\s*(?:month|mm)/u,
    token: "cc-exp-month",
  },
  {
    kind: "payment-card",
    pattern: /(?:exp|expiry|expiration)\s*(?:year|yy)/u,
    token: "cc-exp-year",
  },
  {
    kind: "payment-card",
    pattern: /(?:exp|expiry|expiration)\s*(?:date)?/u,
    token: "cc-exp",
  },
  {
    kind: "payment-card",
    pattern: /cvc|cvv|cid|security\s*code|card\s*code/u,
    token: "cc-csc",
  },
  {
    kind: "postal-address",
    pattern: /billing\s*(?:zip|postal)|(?:zip|postal)\s*(?:code)?/u,
    token: "postal-code",
  },
  {
    kind: "credentials",
    pattern: /password|passwd|passcode|current\s*password/u,
    token: "current-password",
  },
  {
    kind: "credentials",
    pattern: /username|user\s*name|login/u,
    token: "username",
  },
  {
    kind: "contact",
    pattern: /phone|telephone|mobile|tel/u,
    token: "tel",
  },
  {
    kind: "postal-address",
    pattern: /street\s*address|address\s*(?:line)?\s*1/u,
    token: "street-address",
  },
  {
    kind: "secret",
    pattern: /api\s*(?:key|token)|access\s*token/u,
    token: "eve-secret",
  },
  {
    kind: "identity",
    pattern: /full\s*name|legal\s*name|identity/u,
    token: "name",
  },
];

export function inspectAutofillSurfaces(
  root: ParentNode = document
): DetectedAutofillSurface[] {
  const fields = new Map<
    AutofillSurfaceKind,
    Map<string, DetectedAutofillField>
  >();

  for (const element of root.querySelectorAll("input, select, textarea")) {
    if (!isFillableElement(element) || !isUsableElement(element)) continue;
    const candidate = classifyAutofillField(describeElement(element));
    if (!candidate) continue;
    const byToken =
      fields.get(candidate.kind) ?? new Map<string, DetectedAutofillField>();
    const previous = byToken.get(candidate.token);
    if (!previous || previous.score < candidate.score) {
      byToken.set(candidate.token, {
        score: candidate.score,
        token: candidate.token,
      });
    }
    fields.set(candidate.kind, byToken);
  }

  const credentials = fields.get("credentials");
  const email = fields.get("contact")?.get("email");
  if (credentials?.has("current-password") && email) {
    credentials.set("username", {
      score: Math.min(email.score, 80),
      token: "username",
    });
  }

  return [...fields.entries()].map(([kind, byToken]) => ({
    fields: [...byToken.values()].sort(
      (left, right) => right.score - left.score
    ),
    id: kind,
    kind,
  }));
}

export function classifyAutofillField(
  descriptor: AutofillElementDescriptor
): (DetectedAutofillField & { readonly kind: AutofillSurfaceKind }) | null {
  const autocompleteTokens = descriptor.autocomplete
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
  const token = autocompleteTokens.at(-1);
  if (token) {
    const kind = autocompleteKinds.get(token);
    if (kind) {
      const contextualKind =
        token === "postal-code" && autocompleteTokens.includes("billing")
          ? "payment-card"
          : kind;
      return { kind: contextualKind, score: 100, token };
    }
  }

  if (descriptor.type === "password") {
    return { kind: "credentials", score: 90, token: "current-password" };
  }
  const searchable = normalizeText(
    [descriptor.name, descriptor.label].filter(Boolean).join(" ")
  );
  for (const candidate of fieldPatterns) {
    if (candidate.pattern.test(searchable)) {
      return { kind: candidate.kind, score: 70, token: candidate.token };
    }
  }

  if (descriptor.type === "email") {
    return { kind: "contact", score: 75, token: "email" };
  }
  if (descriptor.type === "tel") {
    return { kind: "contact", score: 65, token: "tel" };
  }

  return null;
}

export function findBestAutofillElement(
  token: string,
  root: ParentNode = document
) {
  let best:
    | { readonly element: FillableElement; readonly score: number }
    | undefined;

  for (const element of root.querySelectorAll("input, select, textarea")) {
    if (!isFillableElement(element) || !isUsableElement(element)) continue;
    const candidate = classifyAutofillField(describeElement(element));
    if (
      candidate?.token !== token &&
      !(token === "username" && candidate?.token === "email")
    ) {
      continue;
    }
    if (!best || candidate.score > best.score) {
      best = { element, score: candidate.score };
    }
  }

  return best?.element;
}

function describeElement(element: FillableElement): AutofillElementDescriptor {
  const labels = element.labels
    ? Array.from(element.labels, (label) => label.textContent)
    : [];
  const ariaLabelledBy = element.getAttribute("aria-labelledby");
  const ariaText = ariaLabelledBy
    ?.split(/\s+/u)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

  return {
    autocomplete: element.autocomplete,
    label: [
      ...labels,
      element.getAttribute("aria-label") ?? "",
      ariaText ?? "",
      element.getAttribute("placeholder") ?? "",
      element.getAttribute("title") ?? "",
    ].join(" "),
    name: [element.name, element.id].join(" "),
    type: element instanceof HTMLInputElement ? element.type : "",
  };
}

function isFillableElement(element: Element): element is FillableElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  );
}

function isUsableElement(element: FillableElement) {
  if (element.disabled) return false;
  if (!(element instanceof HTMLSelectElement) && element.readOnly) return false;
  if (element instanceof HTMLInputElement && element.type === "hidden") {
    return false;
  }
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}
