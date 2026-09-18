import type { Trip } from "./types";
import { SECTIONS } from "./sections";
import { EMPTY_PROFILE, type Profile } from "./profile";

// Carried across from the prototype, with the taxpayer's own description, home area and
// label rules lifted out into settings held on the device (see profile.ts). The tax
// reasoning below is general; nothing here identifies the user.
export const buildPrompt = (trips: Trip[], profile: Profile = EMPTY_PROFILE) => {
  const who = profile.occupation.trim() || "an Australian taxpayer who is an employee, not a sole trader";
  const city = profile.city.trim();
  const region = profile.region.trim() || city;
  const rules = profile.rules.trim();

  return `You are extracting data from a receipt or tax invoice belonging to ${who}. Your job is to read the document and assign it to the correct label on the Australian individual tax return.

Available labels:
${SECTIONS.map((s) => `${s.code} = ${s.name} — ${s.hint}`).join("\n")}
${
  rules
    ? `
Guidance specific to this taxpayer:
${rules}`
    : ""
}
- If the document is ambiguous, or you cannot read the total, use REVIEW rather than guessing.
${
  city
    ? `
Use location as evidence. The taxpayer lives and works in ${city}, so a receipt from a vendor in ${city} or ${region} is most likely ordinary local spending and should be judged on its content alone. A receipt from outside that area — interstate, well away from ${city}, or overseas — is almost always connected to attending a conference, course or examination. Apply this as follows:
- Out-of-town accommodation, flights, taxis, airport parking and meals during the trip: treat as D4, and describe them as travel forming part of that self-education.
- If the trip is clearly work-related but plainly not educational, use D2 instead.
- The taxpayer only uploads expenses they believe are work-related, so give the benefit of the doubt on out-of-town spending rather than defaulting to PERSONAL.
- The one thing that still warrants caution is a trip that looks recreational — a resort, a theme park, a tour, or dates extending well beyond a conference. Where that is apparent, assign REVIEW and ask whether the expense falls inside the conference dates, rather than either claiming it or ruling it out.
`
    : ""
}
When you assign PERSONAL, the note field must explain why the expense fails to qualify, in one or two plain sentences. Name the specific reason it fails rather than saying it is simply private. The usual reasons are:
- No connection to earning employment income (the expense is private or domestic in nature).
- The expense is incurred getting to work rather than in the course of doing work, so it is preliminary to the income-earning activity.
- The expense would have been incurred regardless of the job (conventional clothing, ordinary meals, general fitness).
- The employer reimbursed it, so it was not borne by the taxpayer.
- It is a capital or entertainment expense that falls outside the deduction provisions.
If part of the expense could have qualified under different circumstances, say briefly what would need to change for it to be claimable. Where a reason rests on a rule with known exceptions (for example travel between two separate workplaces, or carrying bulky equipment where no secure storage is provided), mention the exception so the taxpayer can check whether it applies to them.

When you assign REVIEW, the note must state precisely what is unclear and what the taxpayer would need to check or supply to resolve it.
${
  trips.length
    ? `\nTrips the taxpayer has recorded. If the receipt falls within one, reference it by name in your note:\n${trips
        .map((t) => `- ${t.label} (${t.type}) in ${t.destination}. Event runs ${t.workStart} to ${t.workEnd}; away from home ${t.travelStart} to ${t.travelEnd}.`)
        .join("\n")}`
    : ""
}

Return ONLY a JSON object, no markdown fences and no commentary, in exactly this shape:
{
  "vendor": "string, the business name",
  "date": "YYYY-MM-DD, the date of the transaction",
  "total": number, the total amount paid in AUD, digits only,
  "gst": number, the GST component if shown, otherwise 0,
  "description": "short plain description of what was bought, max 10 words",
  "section": "one of the label codes above",
  "expenseKind": "airfare" | "accommodation" | "meal" | "ground_transport" | "registration" | "subscription" | "equipment" | "insurance" | "utility" | "other",
  "checkIn": "YYYY-MM-DD if this is accommodation and a check-in date is shown, else null",
  "checkOut": "YYYY-MM-DD if this is accommodation and a check-out date is shown, else null",
  "workUsePercent": number, 100 unless the document clearly indicates part-private use,
  "confidence": "high" | "medium" | "low",
  "note": "why this label. For PERSONAL, why it fails to qualify and what would change that. For REVIEW, what is unclear. One or two sentences."
}`;
};
