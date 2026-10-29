import { expect, test } from '@playwright/test';
import {
  PRACTICE_SCENARIOS, assessPractice,
} from '../lib/practice-scenarios';
import type { PracticeAnswers, PracticeScenario } from '../lib/practice-scenarios';

function responses(scenario: PracticeScenario, note = scenario.example): PracticeAnswers {
  return {
    priority: scenario.priority,
    department: scenario.route,
    decision: scenario.decision,
    note,
    owner: 'On-duty department lead',
    followUp: 'The on-duty lead will check the outstanding actions and confirm the verified result with the next shift.',
  };
}

function caseById(id: string): PracticeScenario {
  const found = PRACTICE_SCENARIOS.find(scenario => scenario.id === id);
  expect(found, 'Missing scenario: ' + id).toBeDefined();
  return found!;
}

test('all 117 fictional scenarios have unique ids, actions, and independent handover checks', () => {
  expect(PRACTICE_SCENARIOS).toHaveLength(117);
  const ids = PRACTICE_SCENARIOS.map(item => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const scenario of PRACTICE_SCENARIOS) {
    expect(scenario.noteChecks, scenario.id + ': missing scenario-specific checks').toHaveLength(2);
    for (const rule of scenario.noteChecks || []) {
      expect(rule.label.trim(), scenario.id).not.toBe('');
      expect(rule.alternatives.length, scenario.id + ': no accepted responses').toBeGreaterThan(0);
      expect(rule.alternatives.every(term => term.trim().length >= 3), scenario.id).toBe(true);
    }
    expect(scenario.example, scenario.id + ': no model response').toContain(scenario.reference);
  }
});

test('the example response for each case can meet the structured written rubric', () => {
  const failures = PRACTICE_SCENARIOS.flatMap(scenario => {
    const result = assessPractice(scenario, responses(scenario));
    return result.passed ? [] : [{ id: scenario.id, errors: result.errors }];
  });
  expect(failures).toEqual([]);
});

test('initial original scenarios cannot pass with generic handover filler', () => {
  for (const id of ['shift-unresolved', 'guest-ac', 'arrival-room',
    'housekeeping-lost-found', 'cafe-delay', 'kitchen-allergy',
    'security-access', 'maintenance-leak', 'marketing-wrong-date',
    'manager-evidence', 'manager-guest-recovery']) {
    const scenario = caseById(id);
    const note = scenario.reference +
      ': This is a fictional item. It exists on the property today and should be handled by a person eventually.';
    const result = assessPractice(scenario, responses(scenario, note));
    expect(result.passed, id + ' improperly accepted generic handover').toBe(false);
    expect(result.errors.note, id).toBeTruthy();
  }
});

test('explicitly negated actions are not accepted as correct safety interventions', () => {
  const scenario = caseById('kt-raw-contact');
  const text = scenario.reference +
    ': Do not stop serving this plate. Do not notify the kitchen lead; the item is fine and can proceed with food service immediately.';
  const result = assessPractice(scenario, responses(scenario, text));
  expect(result.passed).toBe(false);
  expect(result.errors.note).toContain('does not clearly explain');
});

test('substring tricks and placeholder owners cannot satisfy written evidence', () => {
  const scenario = caseById('kt-raw-contact');
  const fakeNote = scenario.reference +
    ': Misleading everybody about this fake incident is acceptable, avoid action and just record the fictional file as complete.';
  expect(assessPractice(scenario, responses(scenario, fakeNote)).errors.note).toBeTruthy();
  const valid = responses(scenario);
  expect(assessPractice(scenario, { ...valid, owner: 'asdf' }).errors.owner).toBeTruthy();
  expect(assessPractice(scenario, { ...valid, owner: 'TBD' }).errors.owner).toBeTruthy();
  expect(assessPractice(scenario, { ...valid, owner: 'On-duty Kitchen lead' }).errors.owner).toBeFalsy();
  expect(assessPractice(scenario, {
    ...valid, followUp: 'We will eventually get around to this somewhere at some point.',
  }).errors.followUp).toBeTruthy();
  expect(assessPractice(scenario, {
    ...valid, followUp: 'Kitchen lead will verify safe cleaning and notify the receiving shift.',
  }).errors.followUp).toBeFalsy();
});
