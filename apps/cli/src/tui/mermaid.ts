import { Marked } from "@earendil-works/pi-tui";
import { render } from "grok-mermaid";
const parser = new Marked();
/** Match the personal pi setting: diagrams render only after streaming settles. */
export function terminalMermaid(
  markdown: string,
  width: number,
  streaming: boolean,
): string {
  if (streaming || !markdown.includes("mermaid")) return markdown;
  return parser
    .lexer(markdown)
    .map((token) => {
      if (
        token.type !== "code" ||
        token.lang?.trim().toLowerCase() !== "mermaid"
      )
        return token.raw;
      try {
        const diagram = render(token.text);
        if (!diagram || diagram.width > width || diagram.warnings.length)
          return token.raw;
        return (
          diagram.plain
            .map((line) => {
              const content = line || "\u00a0";
              const fence = "`".repeat(
                Math.max(
                  0,
                  ...[...content.matchAll(/`+/g)].map(
                    (match) => match[0].length,
                  ),
                ) + 1,
              );
              return `${fence} ${content} ${fence}`;
            })
            .join("  \n") + "\n"
        );
      } catch {
        return token.raw;
      }
    })
    .join("");
}
