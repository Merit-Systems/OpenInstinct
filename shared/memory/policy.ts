export function eligibleKnowledgeText(text: string) {
  if (!text.trim() || text.length > 16_000) return false;
  if (
    /\b(?:do not|don't|never)\s+(?:remember|retain|store|save)\b/iu.test(text)
  )
    return false;
  if (
    /\b(?:password|passcode|otp|one[- ]time (?:code|password)|api[- ]?key|access token|refresh token|private key|card number|cvv|cvc|security code|verification code)\b/iu.test(
      text
    )
  )
    return false;
  if (/^\s*[\d\s-]{4,}\s*$/u.test(text)) return false;
  if (
    /(?:\d[ -]?){13,19}|-----BEGIN|\b(?:sk|pk)_[A-Za-z0-9_-]{16,}|\bBearer\s+\S+/u.test(
      text
    )
  )
    return false;
  return true;
}

export function hasKnowledgeEditIntent(
  text: string,
  operation: "remember" | "correct" | "forget"
) {
  const request =
    /(?:^|[.!?]\s+)(?:please\s+|(?:can|could|would|will) you (?:please )?|I (?:want|need|would like) you to )?(remember|save|store|retain|correct|update|change|forget|delete|remove)\b/iu.exec(
      text
    );
  const commands = {
    remember: ["remember", "save", "store", "retain"],
    correct: ["correct", "update", "change"],
    forget: ["forget", "delete", "remove"],
  };
  return (
    (request?.[1] !== undefined &&
      commands[operation].includes(request[1].toLowerCase())) ||
    (operation === "correct" &&
      /^(?:actually\b|I no longer\b|instead\b)/iu.test(text.trim()))
  );
}
