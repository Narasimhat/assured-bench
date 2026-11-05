// The engine's four calls as words. "re-sequence" is the internal name of "the engine could not settle this clone": that is a statement about the fit, not about the trace,
// so it is shown as "Unresolved" (the table of next actions says what to do about each clone).
export const DECISION_LABEL = { accept: "Accept", hold: "Hold", "re-sequence": "Unresolved", reject: "Reject" };
export const PRIORITY_LABEL = { first: "carry forward", confirmed: "confirmed", reserve: "reserve", duplicate: "backup", caution: "protein still made", not_recommended: "not recommended", discard: "discard", resequence: "unresolved" };
