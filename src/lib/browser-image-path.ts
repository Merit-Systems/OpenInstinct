export const browserImageArtifactIdSource =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export const browserImageArtifactPathPattern = new RegExp(
  `^/artifacts/${browserImageArtifactIdSource}$`,
  "iu"
);

export function isBrowserImageArtifactUrl(value: string) {
  return browserImageArtifactPathPattern.test(value);
}
