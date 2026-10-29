import { EXTENDED_PRACTICE_SCENARIOS } from './extended-practice-scenarios';

export type TrainingPriority = 'Routine' | 'High' | 'Critical';
export type TrainingDepartment =
  'Front Desk' | 'Housekeeping' | 'Café' | 'Kitchen' | 'Maintenance' |
  'Security' | 'Marketing' | 'Management';
export type TrainingDecision =
  'Document and monitor' | 'Assign and follow up' |
  'Escalate immediately' | 'Approve' | 'Return for changes';

export type PracticeScenario = {
  id: string;
  department: TrainingDepartment | 'Everyone';
  title: string;
  situation: string;
  goal: string;
  context: readonly string[];
  priority: TrainingPriority;
  route: TrainingDepartment;
  decision: TrainingDecision;
  reference: string;
  example: string;
  why: string;
  supervisorOnly?: boolean;
  managerOnly?: boolean;
  /** 1 orientation, 2 normal work, 3 exceptions, 4 escalation, 5 independent judgment. */
  level?: 1 | 2 | 3 | 4 | 5;
  skill?: string;
  /** Independent, scenario-specific checks for actionable written handover details. */
  noteChecks?: readonly { label: string; alternatives: readonly string[] }[];
};

export const PRIORITIES: readonly TrainingPriority[] = ['Routine', 'High', 'Critical'];
export const DEPARTMENTS: readonly TrainingDepartment[] = [
  'Front Desk', 'Housekeeping', 'Café', 'Kitchen', 'Maintenance',
  'Security', 'Marketing', 'Management',
];
export const DECISIONS: readonly TrainingDecision[] = [
  'Document and monitor', 'Assign and follow up', 'Escalate immediately',
  'Approve', 'Return for changes',
];

/** Entirely fictional learning cases. No external services or real guest details. */
export const PRACTICE_SCENARIOS: readonly PracticeScenario[] = [
  {
    id: 'shift-unresolved', level: 2, department: 'Everyone',
    title: 'Unresolved concern at shift change',
    situation: 'The previous shift left an unresolved request without an owner. Your shift starts in five minutes.',
    goal: 'Keep the issue visible and make accountability clear.',
    context: ['Reference: DEMO-HANDOVER-014', 'The guest has not yet received a status update', 'There is no documented follow-up owner'],
    priority: 'High', route: 'Front Desk', decision: 'Assign and follow up', reference: 'DEMO-HANDOVER-014',
    noteChecks: [
      { label: "who takes ownership", alternatives: ["assign", "owner", "ownership", "responsib"] },
      { label: "the guest update or next handover", alternatives: ["update", "call back", "callback", "follow up"] },
    ],
    example: 'DEMO-HANDOVER-014 remains unresolved. Assign Front Desk ownership, confirm the previous actions and update the fictional guest before handover.',
    why: 'Reading a note does not resolve it. Assign an owner and record what the next shift must do.',
  },
  {
    id: 'guest-ac', level: 3, department: 'Front Desk',
    title: 'Guest says air-conditioning is not cooling',
    situation: 'A fictional guest in Room 205 calls to report that the air-conditioning is blowing warm air.',
    goal: 'Record a clear guest matter and route a technical issue promptly.',
    context: ['Reference: DEMO-ROOM-205', 'Guest is still in the room', 'A maintenance assessment has not yet happened'],
    priority: 'High', route: 'Maintenance', decision: 'Assign and follow up', reference: 'DEMO-ROOM-205',
    noteChecks: [
      { label: "the inspection or maintenance action", alternatives: ["maintenance", "inspect", "technician", "repair"] },
      { label: "the next guest update", alternatives: ["update", "callback", "call back", "notify"] },
    ],
    example: 'DEMO-ROOM-205: guest reports warm air from AC. Log the concern, alert Maintenance and tell the guest when Front Desk will call back.',
    why: 'Do not mark the room fixed without evidence. Front Desk owns the guest update while Maintenance inspects the AC.',
  },
  {
    id: 'arrival-room', level: 2, department: 'Front Desk',
    title: 'Early arrival for an unready room',
    situation: 'A fictional guest arrives early for Room 203, but Housekeeping has not marked the room ready.',
    goal: 'Avoid promising room readiness without confirmation.',
    context: ['Reference: DEMO-ROOM-203', 'Housekeeping has not confirmed completion', 'The guest requests an exact check-in time'],
    priority: 'Routine', route: 'Housekeeping', decision: 'Assign and follow up', reference: 'DEMO-ROOM-203',
    noteChecks: [
      { label: "confirming room readiness with Housekeeping", alternatives: ["housekeeping", "cleaning", "readiness", "verify room"] },
      { label: "an accurate guest response", alternatives: ["guest", "update", "confirm", "follow up"] },
    ],
    example: 'DEMO-ROOM-203: verify readiness with Housekeeping, communicate an accurate update to the guest and log the next follow-up.',
    why: 'Confirm operational facts rather than making a guest-facing promise based on assumption.',
  },
  {
    id: 'housekeeping-turnover', level: 2, department: 'Housekeeping',
    title: 'Missing room item during turnover',
    situation: 'During fictional Room 204 turnover, the standard towels are missing and an incoming guest is expected.',
    goal: 'Document the missing item and communicate room readiness accurately.',
    context: ['Reference: DEMO-ROOM-204', 'Towels are still missing', 'The room should not be marked ready yet'],
    priority: 'High', route: 'Housekeeping', decision: 'Assign and follow up', reference: 'DEMO-ROOM-204',
    noteChecks: [
      { label: "the missing supplies and replenishment", alternatives: ["towel", "linen", "replenish", "missing"] },
      { label: "room readiness or Front Desk notification", alternatives: ["front desk", "ready", "readiness", "verify"] },
    ],
    example: 'DEMO-ROOM-204: towels missing at turnover. Assign replenishment, notify Front Desk that room is not ready and update when confirmed.',
    why: 'Readiness is a verified state, not a target. The handover must say what is missing and who will address it.',
  },
  {
    id: 'housekeeping-lost-found', level: 3, department: 'Housekeeping',
    title: 'Found property after checkout',
    situation: 'A housekeeping employee finds a wallet in fictional Room 207 after checkout.',
    goal: 'Secure and document found property with an accountable handoff.',
    context: ['Reference: DEMO-ROOM-207', 'A wallet is found, with no verified owner present', 'Avoid recording sensitive card numbers'],
    priority: 'High', route: 'Security', decision: 'Assign and follow up', reference: 'DEMO-ROOM-207',
    noteChecks: [
      { label: "securing the wallet and custody", alternatives: ["wallet", "secure", "custody", "lost and found"] },
      { label: "the authorized handover or log", alternatives: ["security", "handover", "log", "record"] },
    ],
    example: 'DEMO-ROOM-207: secure the found wallet per lost-and-found procedure, document chain of custody, inform Security and notify Front Desk through approved channels.',
    why: 'Never copy private payment information into a training note. Record the handoff and responsible custodian.',
  },
  {
    id: 'cafe-delay', level: 3, department: 'Café',
    title: 'Café order delayed during a rush',
    situation: 'A fictional table has been waiting 35 minutes for order DEMO-CAFE-118.',
    goal: 'Communicate the delay, check kitchen status and avoid losing the request.',
    context: ['Reference: DEMO-CAFE-118', 'Guest has already asked twice for an update', 'No confirmed completion time'],
    priority: 'High', route: 'Café', decision: 'Assign and follow up', reference: 'DEMO-CAFE-118',
    noteChecks: [
      { label: "checking the delayed order", alternatives: ["kitchen", "order status", "queue", "check order"] },
      { label: "the guest update or verified estimate", alternatives: ["guest", "table", "update", "estimate"] },
    ],
    example: 'DEMO-CAFE-118 delayed 35 minutes. Check the kitchen queue, apologize, update the guest with a confirmed estimate and record who follows up.',
    why: 'A service delay requires an owner and an accurate guest update, not just a status change.',
  },
  {
    id: 'kitchen-allergy', level: 4, department: 'Kitchen',
    title: 'Possible allergen cross-contact',
    situation: 'A fictional order DEMO-KITCHEN-052 may have been prepared with an ingredient the guest declared as an allergen.',
    goal: 'Prioritize guest safety over speed and notify the correct personnel.',
    context: ['Reference: DEMO-KITCHEN-052', 'Ingredient safety has not been verified', 'The plate has not yet been served'],
    priority: 'Critical', route: 'Kitchen', decision: 'Escalate immediately', reference: 'DEMO-KITCHEN-052',
    noteChecks: [
      { label: "holding the potentially unsafe plate", alternatives: ["hold", "stop", "do not serve", "remake", "quarantine"] },
      { label: "kitchen lead escalation or ingredient check", alternatives: ["lead", "verify", "notify", "check ingredients"] },
    ],
    example: 'DEMO-KITCHEN-052: hold service of the potentially affected plate, alert the kitchen lead and Front Desk/Café, verify ingredients and remake safely under protocol.',
    why: 'Do not serve an unverified allergen risk. Immediate escalation prevents an avoidable guest safety incident.',
  },
  {
    id: 'security-access', level: 4, department: 'Security',
    title: 'Unverified visitor at the property gate',
    situation: 'A fictional visitor requests entry to a restricted maintenance area without a verified appointment.',
    goal: 'Maintain site access control and create a traceable escalation.',
    context: ['Reference: DEMO-GATE-009', 'No verified authorization appears in the visitor log', 'Visitor requests immediate access'],
    priority: 'High', route: 'Security', decision: 'Escalate immediately', reference: 'DEMO-GATE-009',
    noteChecks: [
      { label: "restricting access pending authorization", alternatives: ["do not admit", "deny", "restrict", "authorization", "verify access"] },
      { label: "the security handoff or log", alternatives: ["lead", "log", "document", "notify"] },
    ],
    example: 'DEMO-GATE-009: do not admit visitor to restricted area until authorization is verified. Notify Security lead and document time and outcome.',
    why: 'Permission must be verified before access. Never rely on claimed authority alone.',
  },
  {
    id: 'maintenance-leak', level: 4, department: 'Maintenance',
    title: 'Water leak near an electrical outlet',
    situation: 'A fictional maintenance report places water close to an electrical outlet in Room 209.',
    goal: 'Recognize the combined water and electrical hazard, prevent exposure and escalate.',
    context: ['Reference: DEMO-ROOM-209', 'Water is present near an outlet', 'Electrical safety has not been assessed'],
    priority: 'Critical', route: 'Maintenance', decision: 'Escalate immediately', reference: 'DEMO-ROOM-209',
    noteChecks: [
      { label: "controlling the water and electrical hazard", alternatives: ["keep people away", "restrict", "isolate", "hazard"] },
      { label: "qualified escalation or room coordination", alternatives: ["lead", "notify", "front desk", "qualified"] },
    ],
    example: 'DEMO-ROOM-209: keep people away from the affected area, notify the maintenance lead, isolate hazards through qualified staff and coordinate room restrictions with Front Desk.',
    why: 'Potential electrical hazards require immediate control by qualified personnel, not routine work completion.',
  },
  {
    id: 'marketing-wrong-date', level: 3, department: 'Marketing',
    title: 'Incorrect event date in a scheduled post',
    situation: 'A fictional Halloween poster DEMO-POST-031 shows the wrong event date but has not been published.',
    goal: 'Stop incorrect content from going live and request a corrected version.',
    context: ['Reference: DEMO-POST-031', 'Post remains scheduled, not published', 'The date must be verified against the approved event plan'],
    priority: 'High', route: 'Marketing', decision: 'Return for changes', reference: 'DEMO-POST-031',
    noteChecks: [
      { label: "pausing or correcting the scheduled post", alternatives: ["pause", "stop", "hold", "date", "correct"] },
      { label: "the corrected approval or review", alternatives: ["review", "resubmit", "approval", "verified"] },
    ],
    example: 'DEMO-POST-031: pause publication, cite the unverified event date, request a corrected creative, and resubmit for review.',
    why: 'Content should be returned with a concrete correction request rather than approved with a known error.',
  },
  {
    id: 'supervisor-cover', level: 3, department: 'Management', supervisorOnly: true,
    title: 'A staff member misses an assigned shift',
    situation: 'Your team reports that the staff member scheduled for fictional shift DEMO-SHIFT-064 has not arrived.',
    goal: 'Maintain coverage and document the handover without inventing attendance data.',
    context: ['Reference: DEMO-SHIFT-064', 'Coverage gap is affecting front operations', 'Reason for absence is not verified'],
    priority: 'High', route: 'Front Desk', decision: 'Assign and follow up', reference: 'DEMO-SHIFT-064',
    noteChecks: [
      { label: "arranging authorized shift coverage", alternatives: ["cover", "replacement", "arrange", "temporary", "shift"] },
      { label: "logging or escalating the coverage gap", alternatives: ["handover", "escalate", "record", "notify"] },
    ],
    example: 'DEMO-SHIFT-064: confirm employee status through approved channels, arrange authorized temporary coverage, record the handover and escalate staffing risk.',
    why: 'Maintain service coverage, but do not fabricate biometric, attendance or payroll records.',
  },
  {
    id: 'manager-evidence', level: 4, department: 'Management', managerOnly: true,
    title: 'Approval request without supporting evidence',
    situation: 'A fictional repair purchase DEMO-REQ-088 requires approval, but it lacks a quotation and clear justification.',
    goal: 'Make a defensible decision based on evidence and document what is missing.',
    context: ['Reference: DEMO-REQ-088', 'No quotation is attached', 'Amount and necessity are not confirmed'],
    priority: 'High', route: 'Management', decision: 'Return for changes', reference: 'DEMO-REQ-088',
    noteChecks: [
      { label: "returning the request for supporting evidence", alternatives: ["return", "quotation", "quote", "evidence", "request changes"] },
      { label: "the missing amount or justification", alternatives: ["amount", "cost", "justification", "necessary", "requester"] },
    ],
    example: 'DEMO-REQ-088: return the request for a quotation, itemized amount, urgency justification and responsible requester before approval.',
    why: 'Approval should be evidence-based. Missing information is a reason to request changes, not to bypass controls.',
  },
  {
    id: 'manager-guest-recovery', level: 5, department: 'Management', managerOnly: true,
    title: 'Repeated unresolved guest complaint',
    situation: 'The same fictional guest has reported the DEMO-GUEST-012 service failure twice after a promised resolution.',
    goal: 'Own the escalation and verify actual resolution before closing.',
    context: ['Reference: DEMO-GUEST-012', 'Guest previously received an unfulfilled promise', 'Root cause is not yet verified'],
    priority: 'Critical', route: 'Management', decision: 'Escalate immediately', reference: 'DEMO-GUEST-012',
    noteChecks: [
      { label: "reviewing the failed recovery and assigning action", alternatives: ["prior", "review", "verify", "remedy", "recovery", "lead"] },
      { label: "guest confirmation or follow-up", alternatives: ["guest", "follow up", "document", "confirm", "closure"] },
    ],
    example: 'DEMO-GUEST-012: review prior attempts, assign a named lead, confirm the remedy with the guest and track documented verification before closure.',
    why: 'Repeated service failure needs management ownership, a recovery action, and an evidence-backed follow-up.',
  },
  ...EXTENDED_PRACTICE_SCENARIOS,
];

export function practiceScenariosFor(user: { role?: string; departments?: { name?: string }[] }): PracticeScenario[] {
  const role = String(user.role || 'staff').toLowerCase();
  const manager = ['owner', 'admin', 'manager'].includes(role);
  const supervisor = manager || ['lead', 'supervisor'].includes(role);
  const departments = new Set((user.departments || []).map(dept => String(dept.name || '').toLowerCase()));
  return PRACTICE_SCENARIOS.filter(scenario => {
    if (scenario.managerOnly) return manager;
    if (scenario.supervisorOnly) return supervisor;
    if (scenario.department === 'Everyone') return true;
    return manager || departments.has(scenario.department.toLowerCase());
  });
}

export type PracticeAnswers = {
  priority: TrainingPriority | '';
  department: TrainingDepartment | '';
  decision: TrainingDecision | '';
  note: string;
  owner?: string;
  followUp?: string;
};
export type PracticeField = keyof PracticeAnswers;
export type PracticeAssessment = {
  passed: boolean;
  errors: Partial<Record<PracticeField, string>>;
  score: number;
};

/** Match whole-word starts and allow stemmed terms such as reconcil → reconciliation.
 * Negated actions ("do not verify") cannot satisfy a positive "verify" check.
 * Explicit safe prohibitions ("do not serve") remain valid criteria.
 * This is practice feedback, not semantic or competency certification.
 */
function matchesActionCriterion(note: string, alternative: string): boolean {
  const phrase = alternative.toLowerCase().trim();
  if (!phrase) return false;
  const escaped = phrase.split('').map(char => /[a-z0-9 ]/.test(char) ? char : '\\' + char)
    .join('').replace(/\s+/g, '\\s+');
  const expression = new RegExp('(^|[^a-z])' + escaped, 'g');
  let match: RegExpExecArray | null;
  while ((match = expression.exec(note)) !== null) {
    if (/^(?:do not|don't|never)\b/.test(phrase)) return true;
    const start = match.index + match[1].length;
    const earlier = note.slice(Math.max(0, start - 70), start).split(/[.;!?\n]/).pop() || '';
    if (/\b(?:not|never|don't|doesn't|didn't|won't|without|skip|avoid|refuse to|no need to)\s+(?:(?:[a-z]+\s+){0,2})$/.test(earlier)) {
      continue;
    }
    return true;
  }
  return false;
}

export function assessPractice(scenario: PracticeScenario, answers: PracticeAnswers): PracticeAssessment {
  const errors: PracticeAssessment['errors'] = {};
  if (answers.priority !== scenario.priority) {
    errors.priority = 'Reconsider the severity, potential harm and how soon action is needed.';
  }
  if (answers.department !== scenario.route) {
    errors.department = 'Choose the team best placed to own the next action.';
  }
  if (answers.decision !== scenario.decision) {
    errors.decision = 'Choose an action supported by the situation and available evidence.';
  }
  const note = answers.note.toLowerCase().replace(/\s+/g, ' ').trim();
  const uniqueWords = new Set(note.match(/[a-z]{2,}/g) || []);
  if (note.length < 45 || uniqueWords.size < 8) {
    errors.note = 'Write a meaningful handover with several distinct facts, an action, and a follow-up owner. Repeated or generic filler does not count.';
  } else if (!note.includes(scenario.reference.toLowerCase())) {
    errors.note = 'Include the fictional case reference so the next shift can locate this concern.';
  } else if (scenario.noteChecks?.length) {
    const missing = scenario.noteChecks.filter(check =>
      !check.alternatives.some(term => matchesActionCriterion(note, term))
    );
    if (missing.length) {
      errors.note = 'Your note does not clearly explain ' + missing.map(check => check.label).join(' and ') +
        '. Add a specific, actionable explanation using your own words.';
    }
  }
  if ((scenario.level || 1) >= 3) {
    const owner = (answers.owner || '').trim();
    const nextCheck = (answers.followUp || '').trim();
    // An arbitrary four-letter placeholder is not an accountable role.
    const responsibleRole = /\b(?:on[- ]duty|lead|supervisor|manager|technician|guard|cook|chef|barista|receptionist|housekeeper|security|maintenance|front desk|housekeeping|café|cafe|kitchen|marketing|management|admin|assigned|designated|team|department|shift)\b/i;
    if (owner.length < 4 || /^(anyone|someone|unknown|nobody|n\/a|tbd|none)$/i.test(owner) ||
        !responsibleRole.test(owner)) {
      errors.owner = 'Specify an accountable fictional role or position (for example, the on-duty Front Desk lead), not a placeholder or a real employee identity.';
    }
    if (nextCheck.length < 20 || new Set(nextCheck.toLowerCase().match(/[a-z]{2,}/g) || []).size < 4) {
      errors.followUp = 'Specify what must be checked next, by whom or when, and how the result will be confirmed.';
    }
  }
  return { passed: Object.keys(errors).length === 0, errors, score: 6 - Object.keys(errors).length };
}
