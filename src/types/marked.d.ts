/* eslint-disable */
// src/types/marked.d.ts
declare module "marked" {
  export const marked: {
    (markdown: string): string;
    parse(markdown: string): string;
    setOptions(opts: any): void;
  };
}
