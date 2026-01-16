declare module "marked-terminal" {
  interface TerminalRendererOptions {
    code?: (code: string, lang?: string) => string;
    codespan?: (text: string) => string;
    blockquote?: (quote: string) => string;
    html?: (html: string) => string;
    heading?: (text: string, level: number) => string;
    firstHeading?: (text: string) => string;
    hr?: () => string;
    list?: (body: string, ordered: boolean) => string;
    listitem?: (text: string) => string;
    paragraph?: (text: string) => string;
    table?: (header: string, body: string) => string;
    tablerow?: (content: string) => string;
    tablecell?: (content: string, flags: { header: boolean; align: string }) => string;
    strong?: (text: string) => string;
    em?: (text: string) => string;
    del?: (text: string) => string;
    link?: (href: string, title: string, text: string) => string;
    image?: (href: string, title: string, text: string) => string;
  }

  class TerminalRenderer {
    constructor(options?: TerminalRendererOptions);
  }

  export default TerminalRenderer;
}
