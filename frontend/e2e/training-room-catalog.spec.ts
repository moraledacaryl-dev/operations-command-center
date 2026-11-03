import { expect, test } from '@playwright/test';
import { PRACTICE_SCENARIOS } from '../lib/practice-scenarios';
import { EXTENDED_PRACTICE_SCENARIOS } from '../lib/extended-practice-scenarios';
import { COURSE_GUIDES } from '../lib/training-course';
import { TRAINING_LESSONS } from '../lib/interactive-training';
import { WORKFLOW_DEFINITIONS } from '../lib/training-workflows';

// These are room names supplied by the resort owner. Only names are real;
// all exercise guests, events, follow-ups and work records remain fictional.
const roomNames = ['Solace', 'Cafe Suite', 'Perch 1', 'Perch 2',
  'Crown', 'Grandeur', 'Skyroom', 'Twinspire'] as const;

test('all room-specific learning examples use named resort rooms, not numbered placeholders', () => {
  const allVisibleContent = JSON.stringify({
    PRACTICE_SCENARIOS, EXTENDED_PRACTICE_SCENARIOS,
    COURSE_GUIDES, TRAINING_LESSONS, WORKFLOW_DEFINITIONS,
  });
  expect(allVisibleContent).not.toMatch(/\bRoom\s+[123]\d\d\b/);
  for (const room of roomNames) {
    expect(allVisibleContent).toContain(room);
  }
  expect(allVisibleContent).toContain('DEMO-SOLACE-205');
  expect(allVisibleContent).toContain('DEMO-TWINSPIRE-204');
});

test('room practice remains read-only and never implies that an AC or towel request was resolved', () => {
  const scenario = PRACTICE_SCENARIOS.find(item => item.id === 'guest-ac');
  expect(scenario).toMatchObject({ priority: 'High', route: 'Maintenance',
    decision: 'Assign and follow up' });
  expect(scenario?.why).toContain('Do not mark the room fixed without evidence');
});
