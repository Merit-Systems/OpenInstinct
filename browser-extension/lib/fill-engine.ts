import type {
  AutofillClaimResult,
  VaultAutofillFrameFillRequest,
} from "../../lib/vault-autofill-protocol";
import { findBestAutofillElement } from "./field-detector";

const fillActionDelayMilliseconds = 20;

export async function fillAutofillClaims(input: VaultAutofillFrameFillRequest) {
  const results: AutofillClaimResult[] = [];

  for (const claim of input.claims) {
    await delay(fillActionDelayMilliseconds);
    const element = findBestAutofillElement(claim.token);
    if (!element) {
      results.push({ claimId: claim.id, status: "missing" });
      continue;
    }

    element.dataset.vaultSecret = "true";
    const accepted = fillElement(element, claim.value, claim.token);
    results.push({
      claimId: claim.id,
      status: accepted ? ("filled" as const) : ("rejected" as const),
    });
  }

  return results;
}

function fillElement(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
  token: string
) {
  triggerPreInsertEvents(element);

  if (element instanceof HTMLSelectElement) {
    const option = findMatchingOption(element, value, token);
    if (!option) return false;
    element.value = option.value;
  } else {
    element.value = value;
  }

  triggerPostInsertEvents(element);
  return acceptsValue(element.value, value, token);
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
