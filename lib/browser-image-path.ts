export const browserImageArtifactIdSource =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export const browserImageArtifactPathPattern = new RegExp(
  `^/artifacts/${browserImageArtifactIdSource}$`,
  "iu"
);

export function isBrowserImageArtifactUrl(value: string) {
  return browserImageArtifactPathPattern.test(value);
}

export function browserImageArtifactAttemptUrl(value: string, attempt: number) {
  return attempt === 0 ? value : `${value}?attempt=${String(attempt)}`;
}
