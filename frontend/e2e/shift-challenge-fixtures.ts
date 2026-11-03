import cases from '../../backend/scripts/shift_challenge_cases.json';
import type { ShiftAnswers } from '../lib/training-shift-challenge';
const notes:Record<string,string>={
 'Front Desk':'The Perch 2 shower still has no hot water. Ask Maintenance to inspect it and have Reception call the guest with a confirmed update.',
 Housekeeping:'Crown bathroom floor is still wet. Ask the Housekeeping lead to check that it is dry and tell Front Desk before room release.',
 'Café':'Table 5 is waiting for breakfast. Ask the Café lead to check with Kitchen and give the guest a confirmed update rather than an invented serving time.',
 Kitchen:'Hold the dessert plate out of service. The Kitchen lead must check the ingredients for the nut allergy before anyone serves it.',
 Maintenance:'Restrict the area beside the leak and outlet. Keep guests away and ask the Maintenance lead for an inspection by a qualified person.',
 Marketing:'The draft has the wrong Friday date. Change it to Saturday and ask the Marketing lead to review it before scheduling.',
 Security:'Boxes block the fire exit. Alert the Security lead now, arrange safe clearing and check the escape route before guests use it.',
};
export function modelShiftAnswers(c:(typeof cases)[number]):ShiftAnswers{return {status:'Follow',priority:c.priority,team:c.team,decision:c.decision,owner:'On-duty '+c.department+' lead',followUp:'The '+c.department+' lead will check the pending action and report the result in ten minutes, before the next shift takes over.',note:c.reference+': '+notes[c.department]};}
