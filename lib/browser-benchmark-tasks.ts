export const browserBenchmarkTasks = [
  {
    description: "Read a simple page heading",
    expectedReplyIncludes: ["Example Domain"],
    prompt:
      "Open https://example.com in the browser and report the exact page heading.",
  },
  {
    description: "Follow a link and inspect the destination",
    expectedReplyIncludes: ["IANA-managed Reserved Domains"],
    prompt:
      "Open https://example.com, follow its More information link, and report the destination page heading.",
  },
  {
    description: "Extract two facts from a technical document",
    expectedReplyIncludes: ["RFC 9110", "HTTP Semantics"],
    prompt:
      "Open https://www.rfc-editor.org/rfc/rfc9110.html and report its RFC number and document title.",
  },
  {
    description: "Read a documentation page",
    expectedReplyIncludes: ["Document Object Model"],
    prompt:
      "Open https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model and report the main page heading.",
  },
  {
    description: "Extract facts from a public encyclopedia",
    expectedReplyIncludes: ["Stan Lee", "Steve Ditko"],
    prompt:
      "Open https://en.wikipedia.org/wiki/Spider-Man and report the two credited creators of Spider-Man.",
  },
  {
    description: "Handle a commercial movie page",
    expectedReplyIncludes: ["Spider-Man", "2002"],
    prompt:
      "Open https://www.imdb.com/title/tt0145487/ and report the movie title and release year.",
  },
] as const;
