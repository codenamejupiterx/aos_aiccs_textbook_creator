/* eslint-disable */
declare module "html-to-docx" {
  // minimal typing; expand later if you want
  const htmlToDocx: (
    html: string,
    headerHTML?: string | null,
    options?: any
  ) => Promise<Buffer>;
  export default htmlToDocx;
}
