// Eve's Linq adapter flattens Markdown into iMessage text by concatenating the
// text of every node. Block boundaries, hard breaks, list markers, and link
// destinations disappear, so "url\n- next step" reaches the phone as
// "urlnext step" and iMessage links the glued text. Rewrite outgoing Markdown
// into a single paragraph of soft line breaks whose text survives that
// flattening while inline emphasis still becomes native decorations.

const fenceLinePattern = /^\s*(?:`{3,}|~{3,})/u;
const thematicBreakPattern =
  /^\s{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/u;
const blockquotePattern = /^\s{0,3}(?:>[ \t]?)+/u;
const headingPattern = /^\s{0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/u;
const bulletItemPattern = /^(\s*)[-+*][ \t]+/u;
const orderedItemPattern = /^(\s*)(\d{1,9})([.)])[ \t]+/u;
const inlineLinkPattern =
  /(?<!!)\[((?:\\.|[^\]])*)\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gu;
const autolinkPattern = /<(https?:\/\/[^\s>]+)>/gu;
const hardBreakPattern = /(?:[ \t]{2,}|\\)$/u;

export function formatLinqMarkdown(message: string) {
  const lines = message
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .filter(
      (line) => !fenceLinePattern.test(line) && !thematicBreakPattern.test(line)
    )
    .map((line) => {
      const content = line.replace(blockquotePattern, "");
      const heading = headingPattern.exec(content);
      const block = heading
        ? heading[1]
          ? `**${heading[1]}**`
          : ""
        : content
            .replace(bulletItemPattern, "$1• ")
            .replace(orderedItemPattern, "$1$2\\$3 ");
      return block
        .replace(inlineLinkPattern, (_match, text: string, url: string) =>
          text.trim() && text.trim() !== url ? `${text.trim()}: ${url}` : url
        )
        .replace(autolinkPattern, "$1")
        .replace(hardBreakPattern, "")
        .trimEnd();
    });

  return lines
    .join("\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}
