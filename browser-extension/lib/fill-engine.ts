import type {
  AutofillClaimResult,
  VaultAutofillFrameFillRequest,
} from "../../lib/manager/vault-autofill-protocol";
import { findBestAutofillElement } from "./field-detector";

const fillActionDelayMilliseconds = 20;
const fillVerificationDelayMilliseconds = 20;

export async function fillAutofillClaims(
  input: VaultAutofillFrameFillRequest,
  currentOrigin: () => string
) {
  assertFrameOrigin(input.expectedOrigin, currentOrigin());

  const results: AutofillClaimResult[] = [];

  for (const claim of input.claims) {
    await delay(fillActionDelayMilliseconds);
    assertFrameOrigin(input.expectedOrigin, currentOrigin());
    const element = findBestAutofillElement(claim.token);
    if (!element) {
      results.push({ claimId: claim.id, status: "missing" });
      continue;
    }

    element.dataset.vaultSecret = "true";
    const accepted = await fillElement(element, claim.value, claim.token);
    results.push({
      claimId: claim.id,
      status: accepted ? ("filled" as const) : ("rejected" as const),
    });
  }

  return results;
}

function assertFrameOrigin(expectedOrigin: string, actualOrigin: string) {
  if (actualOrigin !== expectedOrigin) {
    throw new Error(
      "The autofill frame no longer matches the approved origin."
    );
  }
}

async function fillElement(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
  token: string
) {
  if (element instanceof HTMLSelectElement) {
    triggerPreInsertEvents(element);
    const option = findMatchingOption(element, value, token);
    if (!option) return false;
    element.value = option.value;
    triggerPostInsertEvents(element);
    await delay(fillVerificationDelayMilliseconds);
    return acceptsValue(element.value, value, token);
  }

  for (const candidate of fillCandidates(value, token)) {
    triggerPreInsertEvents(element);
    element.value = candidate;
    triggerPostInsertEvents(element);
    await delay(fillVerificationDelayMilliseconds);
    if (acceptsValue(element.value, value, token)) return true;
  }

  return false;
}

export function fillCandidates(value: string, token: string) {
  if (token !== "cc-exp") return [value];

  // Some masked expiry controls expect the slash, while others insert it from
  // digits-only input. Try the browser-standard value first, then let the
  // control own its formatting if the first value does not persist.
  return [...new Set([value, digits(value)])].filter(Boolean);
}

function triggerPreInsertEvents(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
) {
  const initialValue = element.value;
  element.click();
  element.focus();
  triggerKeyboardEvents(element);
  if (element.value !== initialValue) element.value = initialValue;
}

function triggerPostInsertEvents(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
) {
  const autofilledValue = element.value;
  triggerKeyboardEvents(element);
  if (element.value !== autofilledValue) element.value = autofilledValue;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function triggerKeyboardEvents(element: Element) {
  element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
}

function findMatchingOption(
  element: HTMLSelectElement,
  expected: string,
  token: string
) {
  const expectedDigits = digits(expected);
  return Array.from(element.options).find((option) => {
    if (option.value === expected || option.label === expected) return true;
    if (!expectedDigits) return false;
    return [option.value, option.label].some((candidate) => {
      const candidateDigits = digits(candidate);
      if (candidateDigits === expectedDigits) return true;
      if (token === "cc-exp-month") {
        return Number(candidateDigits) === Number(expectedDigits);
      }
      if (token === "cc-exp-year") {
        return (
          candidateDigits.endsWith(expectedDigits) ||
          expectedDigits.endsWith(candidateDigits)
        );
      }
      return false;
    });
  });
}

function acceptsValue(entered: string, expected: string, token: string) {
  const enteredDigits = digits(entered);
  const expectedDigits = digits(expected);
  if (token === "cc-exp-month") {
    return Number(enteredDigits) === Number(expectedDigits);
  }
  if (token === "cc-exp-year") {
    return (
      enteredDigits.endsWith(expectedDigits) ||
      expectedDigits.endsWith(enteredDigits)
    );
  }
  if (token === "cc-exp") {
    return (
      enteredDigits === expectedDigits ||
      enteredDigits.endsWith(expectedDigits.slice(-4))
    );
  }
  if (["cc-number", "cc-csc", "postal-code"].includes(token)) {
    return enteredDigits === expectedDigits;
  }
  return entered.length > 0;
}

function digits(value: string) {
  return value.replaceAll(/\D/gu, "");
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
