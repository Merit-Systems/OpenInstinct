import { describe, expect, it } from "vitest";
import { artifactMarker, artifactUrl, parseArtifactMessage } from "./artifacts";

describe("artifact message markers", () => {
  const id = "018f08c6-8f07-7f72-934c-32f4e6fd8a21";

  it("round-trips a marker into an inline artifact segment", () => {
    const marker = artifactMarker(id);

    expect(marker).toBe(`[[artifact:${id}]]`);
    expect(parseArtifactMessage(`Here is the result.\n\n${marker}`)).toEqual([
      { text: "Here is the result.", type: "text" },
      { id, type: "artifact", url: artifactUrl(id) },
    ]);
  });

  it("leaves malformed and user-authored lookalikes as text", () => {
    expect(parseArtifactMessage("[[artifact:not-a-uuid]]")).toEqual([
      { text: "[[artifact:not-a-uuid]]", type: "text" },
    ]);
  });

  it("deduplicates repeated artifacts without dropping surrounding text", () => {
    const marker = artifactMarker(id);

    expect(parseArtifactMessage(`${marker}\nAgain ${marker}`)).toEqual([
      { id, type: "artifact", url: artifactUrl(id) },
      { text: "Again", type: "text" },
    ]);
  });
});
