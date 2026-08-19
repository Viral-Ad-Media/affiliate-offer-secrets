import type { SectionBlock } from "@/lib/engine/blockTree";

// Built-in starter sections for the page editor — one-click, professionally-shaped blocks a tenant
// can drop in and edit, the complement to the user-created saved-block library (0116). These are
// static SectionBlock literals: insertSavedBlock deep-clones them with fresh ids on every insert,
// so the originals are never mutated and two inserts never collide. Ids here are placeholders,
// regenerated on the way in; the copy is deliberately generic and product-agnostic (a template
// asserting a benefit or a result would put words in the affiliate's mouth on a page that carries
// their disclosure — the same rule funnelTemplates.ts already follows).
//
// Isomorphic: types only, no lucide/SDK imports, so the editor can import it client-side.

export type SectionTemplate = { id: string; name: string; section: SectionBlock };

const heading = (text: string, level: 2 | 3 = 2): any => ({ id: "t", type: "heading", style: {}, content: { text, level } });
const paragraph = (text: string): any => ({ id: "t", type: "paragraph", style: {}, content: { text } });
const button = (text: string): any => ({
  id: "t",
  type: "button",
  style: {},
  // Scrolls to the opt-in form (present on every bridge page); harmless no-op elsewhere. Never a
  // typed URL — the tenant repoints it in the button's own settings if they want somewhere else.
  content: { text, action: { kind: "scroll", targetId: "leadForm" } },
});
const iconCol = (icon: string, title: string, body: string): any => ({
  id: "t",
  type: "column",
  style: {},
  children: [
    { id: "t", type: "icon", style: {}, content: { name: icon, size: 40, label: "" } },
    { id: "t", type: "heading", style: {}, content: { text: title, level: 3 } },
    { id: "t", type: "paragraph", style: {}, content: { text: body } },
  ],
});
const faq = (question: string, answer: string): any => ({ id: "t", type: "faq_item", style: {}, content: { question, answer } });
const testimonial = (quote: string, name: string, role: string): any => ({
  id: "t",
  type: "testimonial",
  style: {},
  content: { quote, name, role, media: { kind: "text" } },
});
const section = (children: any[]): SectionBlock => ({ id: "t", type: "section", style: {}, children });

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    id: "hero",
    name: "Hero",
    section: section([
      heading("A clear, benefit-led headline goes here", 2),
      paragraph("One or two sentences that expand on the headline and set up why this matters to the reader."),
      button("Get started"),
    ]),
  },
  {
    id: "features",
    name: "3 features",
    section: section([
      heading("Why it works", 2),
      {
        id: "t",
        type: "row",
        style: {},
        layout: "3col",
        columns: [
          iconCol("zap", "Fast", "Describe the first thing that sets this offer apart."),
          iconCol("shield", "Trusted", "Describe the second — proof, safety, or reassurance."),
          iconCol("target", "Effective", "Describe the third — the outcome the reader wants."),
        ],
      },
    ]),
  },
  {
    id: "benefits",
    name: "Benefits list",
    section: section([
      heading("What you get", 2),
      {
        id: "t",
        type: "icon_list",
        style: {},
        content: {
          items: [
            { icon: "check", text: "First benefit — keep each line short and concrete." },
            { icon: "check", text: "Second benefit — say what the reader actually gets." },
            { icon: "check", text: "Third benefit — end on the strongest one." },
          ],
        },
      },
    ]),
  },
  {
    id: "testimonials",
    name: "Testimonials",
    section: section([
      heading("What people say", 2),
      {
        id: "t",
        type: "row",
        style: {},
        layout: "2col",
        columns: [
          { id: "t", type: "column", style: {}, children: [testimonial("Replace with a real quote from a real customer.", "First L.", "Verified buyer")] },
          { id: "t", type: "column", style: {}, children: [testimonial("Only use testimonials you can back up — never invent one.", "Second L.", "Verified buyer")] },
        ],
      },
    ]),
  },
  {
    id: "faq",
    name: "FAQ",
    section: section([
      heading("Frequently asked", 2),
      faq("Add the first question a hesitant buyer asks.", "Answer it plainly. Short answers convert better than clever ones."),
      faq("Add the second common objection.", "Address it directly — this is where you remove the last doubt."),
      faq("Add a third, if it earns its place.", "Cut it if it doesn't. A short FAQ reads as confidence."),
    ]),
  },
  {
    id: "guarantee",
    name: "Guarantee",
    section: section([
      {
        id: "t",
        type: "row",
        style: {},
        layout: "1col",
        columns: [
          {
            id: "t",
            type: "column",
            style: {},
            children: [
              { id: "t", type: "icon", style: {}, content: { name: "shield", size: 48, label: "" } },
              heading("Backed by a guarantee", 2),
              paragraph("State the actual guarantee the vendor offers — the real terms, not an invented one. Reassurance only counts when it's true."),
            ],
          },
        ],
      },
    ]),
  },
  {
    id: "cta",
    name: "Big CTA",
    section: section([
      heading("Ready to start?", 2),
      paragraph("A last line of encouragement that restates the single most important reason to act now."),
      button("Get started"),
    ]),
  },
];
