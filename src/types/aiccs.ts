export type WeekItem = {
  week: number; title: string; goals: string[]; topics: string[];
  activity: string; assessment: string;
};
export type Reference = {
  type: "web" | "book" | "article" | "report";
  title: string; author: string; year: string; publisher?: string; url?: string;
};
export type Week1Chapter = {
  title: string; abstract: string;
  sections: { heading: string; body: string }[];
  figures: { label: string; caption: string; suggested_visual: string }[];
  citations_style: "APA" | "MLA";
  intext_citations: boolean;
  references: Reference[];
  ai_generated: boolean;
  estimated_word_count: number;
};
export type Output = { curriculum16: WeekItem[]; week1Chapter: Week1Chapter; };
