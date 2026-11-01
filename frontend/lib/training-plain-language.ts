import type { PracticeScenario } from './practice-scenarios';

export type PlainTrainingWord = { term: string; meaning: string };

const words: readonly (PlainTrainingWord & { matches: RegExp })[] = [
  { term: 'Shift handover', meaning: 'When one employee finishes work, they tell the next employee which problems are still unfinished and what to do next.', matches: /handover|shift|next receptionist|next employee/i },
  { term: 'Person responsible (owner)', meaning: 'The staff member whose job it is to make sure the problem is handled. The person must know they have been asked to help.', matches: /owner|ownership|assign|responsib|accountab|follow.up/i },
  { term: 'Guest update', meaning: 'Reception calls or speaks to the guest to say what staff are doing about the problem and when the guest will hear from them again.', matches: /guest|call.back|update/i },
  { term: 'Maintenance', meaning: 'The team that checks and repairs things such as air conditioners, lights and broken bathroom fixtures.', matches: /maintenance|repair|technician|fault/i },
  { term: 'Escalate', meaning: 'Tell a supervisor or manager right away because the problem needs more authority or urgent help.', matches: /escalat|supervisor|manager/i },
  { term: 'Verify', meaning: 'Check whether something really happened or was fixed, instead of only assuming it is done.', matches: /verif|inspect|confirm/i },
  { term: 'Follow-up', meaning: 'Check again later to make sure the work was done, and contact the guest or team if needed.', matches: /follow.up|call.back|check again/i },
];

export function plainWordsForScenario(scenario: PracticeScenario): PlainTrainingWord[] {
  const text = [scenario.title, scenario.situation, scenario.goal, ...scenario.context].join(' ');
  const start = [
    { term: 'Reference number', meaning: 'This is just the made-up tracking code for this practice problem. It helps staff find the same record later.' },
    { term: 'Urgency / priority', meaning: 'How soon staff should deal with the problem: Routine = can wait, High = handle soon, Critical = get immediate help for danger or a very serious issue.' },
  ];
  // For the introductory handover case, the four essential terms must always
  // appear. For other cases, use only relevant words instead of a giant manual.
  const relevant = scenario.id === 'shift-unresolved'
    ? words.filter(word => /Shift handover|Person responsible|Guest update/.test(word.term))
    : words.filter(word => word.matches.test(text)).slice(0, 3);
  return [...start, ...relevant].map(({ term, meaning }) => ({ term, meaning }));
}
