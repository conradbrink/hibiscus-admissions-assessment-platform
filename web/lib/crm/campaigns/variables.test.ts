import { describe, expect, it } from "vitest";
import { CAMPAIGN_VARIABLES, CAMPAIGN_VARIABLE_HINTS, buildCampaignVariables, renderCampaign, textToHtml, validateCampaignBody, type CampaignFamilyContext } from "@/lib/crm/campaigns/variables";

const ctx: CampaignFamilyContext = {
  contact: { first_name: "Anna", last_name: "Brink", unsubscribe_token: "tok123" },
  family: { display_name: "Brink", family_code: "HBS-0001" },
  campus: { name: "Gaborone", phone: "+267 123 4567" },
  students: [
    { preferred_name: null, legal_first_name: "Tom", date_of_birth: "2015-01-01", status: "active" },
    { preferred_name: "Lil", legal_first_name: "Lillian", date_of_birth: "2019-06-01", status: "onboarding" },
    { preferred_name: null, legal_first_name: "Old", date_of_birth: "2008-01-01", status: "left" },
  ],
  event: { name: "Open day", when: "Saturday 3 October, 09:00", location: "Main hall" },
  siteUrl: "https://example.test/",
  familyLink: null,
};

describe("buildCampaignVariables", () => {
  it("names the enrolled children youngest first and leaves the rest out", () => {
    const v = buildCampaignVariables(ctx);
    expect(v.student_first_name).toBe("Lil");
    expect(v.student_names).toBe("Lil and Tom");
    expect(v.family_name).toBe("Brink");
    expect(v.campus).toBe("Gaborone");
    expect(v.unsubscribe_link).toBe("https://example.test/unsubscribe/tok123");
    expect(v.event_name).toBe("Open day");
    expect(v.family_link).toBeNull();
  });
  it("falls back to the family code and the school name", () => {
    const v = buildCampaignVariables({ ...ctx, family: { display_name: "  ", family_code: "HBS-0002" }, campus: null, students: [], event: null });
    expect(v.family_name).toBe("HBS-0002");
    expect(v.campus).toBe("Hibiscus");
    expect(v.student_first_name).toBeNull();
    expect(v.student_names).toBeNull();
    expect(v.event_name).toBeNull();
  });
  it("hints every variable", () => {
    for (const k of CAMPAIGN_VARIABLES) expect(CAMPAIGN_VARIABLE_HINTS[k]).toBeTruthy();
  });
});

describe("validateCampaignBody and renderCampaign", () => {
  it("refuses a variable outside the list before it reaches an inbox", () => {
    expect(validateCampaignBody("Hi {{parent_first_name}}", "<p>{{parent_frist_name}}</p>", "")).toEqual([{ kind: "unknown_variable", name: "parent_frist_name" }]);
    expect(validateCampaignBody("Hi {{parent_first_name}}", "<p>{{student_names}}</p>", "{{campus}}")).toEqual([]);
  });
  it("renders with the family's words, escaping HTML, and appends the unsubscribe footer to marketing", () => {
    const vars = buildCampaignVariables({ ...ctx, contact: { ...ctx.contact, first_name: "A<b>" } });
    const out = renderCampaign({ email_subject: "Hello {{parent_first_name}}", email_body_html: "<p>Hi {{parent_first_name}}</p>", email_body_text: "Hi {{parent_first_name}}" }, vars, { marketing: true });
    expect(out.subject).toBe("Hello A<b>");
    expect(out.html).toContain("Hi A&lt;b&gt;");
    expect(out.html).toContain('href="https://example.test/unsubscribe/tok123"');
    expect(out.text).toContain("To stop marketing email: https://example.test/unsubscribe/tok123");
  });
  it("does not add the footer twice, nor to a service notice", () => {
    const vars = buildCampaignVariables(ctx);
    const withOwn = renderCampaign({ email_subject: "s", email_body_html: '<p><a href="{{unsubscribe_link}}">stop</a></p>', email_body_text: "{{unsubscribe_link}}" }, vars, { marketing: true });
    expect(withOwn.html.match(/unsubscribe\/tok123/g)).toHaveLength(1);
    const service = renderCampaign({ email_subject: "s", email_body_html: "<p>Fees</p>", email_body_text: "Fees" }, vars, { marketing: false });
    expect(service.html).not.toContain("unsubscribe");
    expect(service.text).not.toContain("unsubscribe");
  });
});

describe("textToHtml", () => {
  it("makes paragraphs from blank lines and breaks from single newlines", () => {
    expect(textToHtml("One\ntwo\n\n\nThree\n")).toBe("<p>One<br>two</p><p>Three</p>");
    expect(textToHtml("")).toBe("");
  });
});
