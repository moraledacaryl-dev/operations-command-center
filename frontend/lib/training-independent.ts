export type IndependentAction = {
  path: string;
  selector: string;
  title: string;
  instruction: string;
  containsText?: string;
  type?: 'click' | 'input';
};
const tab = (path: string, group: string, button: string, title: string): IndependentAction =>
  ({ path, selector: '[aria-label="' + group + '"] button', containsText: button,
     title, instruction: 'On the actual ' + group.toLowerCase() + ' controls, find and click “' + button + '”. No arrow will tell you which button to pick.' });
const home: IndependentAction = { path: '/', selector:'a[aria-label="My Work"]', title:'Find your own tasks',
  instruction:'Without arrows, use the Operations navigation to open My Work.' };
const back: IndependentAction = { path:'/my-work', selector:'a.ops-brand[href="/"]', title:'Return to the main dashboard',
  instruction:'Use the Hidden Oasis logo to return to the dashboard.' };
export const INDEPENDENT_CHECKS: Record<string, readonly [IndependentAction,IndependentAction]> = {
  orientation: [home, {path:'/my-work',selector:'a.ops-notifications',title:'Find your notifications',
    instruction:'Now use the notifications bell. You need to find it without the training arrow.'}],
  'staff-handover': [tab('/shift','Shift note filters','Urgent','Find urgent handovers'),
    tab('/shift','Shift note filters','Unresolved','Find unfinished handovers')],
  'staff-rooms': [tab('/rooms','Space type','Guest rooms','Find the guest rooms'),
    tab('/rooms','Space type','Shared areas','Find shared areas')],
  'room-arrivals': [{ path: '/housekeeping', selector: 'input[aria-label="Find room"]', type: 'input', title: 'Find a room', instruction: 'Type a practice room name in Find room.' },
    { path: '/housekeeping', selector: '.hk-tools button', containsText: 'Refresh', title: 'Refresh the room list', instruction: 'Refresh the list to see the latest room updates.' }],
  'staff-my-work': [home, back],
  'team-tasks': [tab('/tasks','Task view','List','Switch tasks to List'),
    tab('/tasks','Task view','Board','Switch back to Board')],
  'guest-matters': [tab('/guests','Guest matter filters','Urgent','Find urgent guest issues'),
    tab('/guests','Guest matter filters','Active','Find active guest issues')],
  maintenance: [tab('/fixes','Maintenance filters','Urgent','Find urgent maintenance issues'),
    tab('/fixes','Maintenance filters','Active','Find active maintenance issues')],
  requests: [tab('/requests','Request status','Draft','Find draft requests'),
    tab('/requests','Request status','Review','Find requests awaiting review')],
  'shift-writing': [tab('/shift','Shift note filters','Urgent','Find urgent shift notes'),
    tab('/shift','Shift note filters','Unresolved','Find notes still unfinished')],
  projects: [tab('/projects','Project status','Active','Find active projects'),
    tab('/projects','Project status','All','See every project')],
  marketing: [{path:'/posts',selector:'a.ops-brand[href="/"]',title:'Leave the marketing page',
    instruction:'Return to the main dashboard by clicking the resort logo.'},home],
  'management-review': [{path:'/review',selector:'input[placeholder="Search decisions"]',type:'input',
    title:'Search for a decision',instruction:'Type a fictional keyword such as repair in Search decisions. Do not enter guest information.'},
    {path:'/review',selector:'a.ops-brand[href="/"]',title:'Return without approving',
    instruction:'Use the logo to return home; this lesson does not require an actual approval.'}],
  accounts: [{path:'/admin/users',selector:'input[placeholder="Search name, email, or role"]',type:'input',
    title:'Search existing staff accounts',instruction:'Type a fictional search term such as reception. Do not change any account.'},
    {path:'/admin/users',selector:'a.ops-brand[href="/"]',title:'Return without changing access',
    instruction:'Use the logo to return home. Do not change anyone’s permissions as practice.'}],
};

export function independentActionMatches(
  action: IndependentAction, target: Element, eventType: 'click'|'input',
): boolean {
  if ((action.type || 'click') !== eventType) return false;
  let node: HTMLElement | null = null;
  try { node = target.closest<HTMLElement>(action.selector); } catch { return false; }
  if (!node) return false;
  if (action.containsText && !node.textContent?.toLowerCase().includes(action.containsText.toLowerCase())) return false;
  if (eventType === 'input') return (target as HTMLInputElement).value?.trim().length >= 3;
  return true;
}
