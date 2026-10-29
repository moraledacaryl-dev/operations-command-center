import { expect, test } from '@playwright/test';
import { parseScenarioProgress } from '../lib/training-progress';

const ids = ['shift-unresolved', 'guest-ac'];
const valid = { attempts: 4, mistakes: 1, hints: 1, firstTry: false,
  completedAt: '2026-10-28T11:24:00.000Z' };

test('only completed well-formed authorized cases count as progress', () => {
  const progress = parseScenarioProgress({
    'shift-unresolved': valid,
    'guest-ac': { attempts: -1, completedAt: valid.completedAt },
    'manager-evidence': valid,
    '__proto__': valid,
  }, ids);
  expect(Object.keys(progress)).toEqual(['shift-unresolved']);
  expect(progress['shift-unresolved']).toMatchObject(valid);
  expect(progress['guest-ac']).toBeUndefined();
});

test('invalid dates, filler, negative counts and contradictory flags cannot become completed', () => {
  for (const item of [
    true, 'complete', [], null, {},
    { attempts: 2, completedAt: 'never' },
    { attempts: 0, completedAt: valid.completedAt },
    { attempts: Number.POSITIVE_INFINITY, completedAt: valid.completedAt },
    { attempts: 1, mistakes: 2, completedAt: valid.completedAt },
    { attempts: 1, hints: -1, completedAt: valid.completedAt },
    { attempts: 2, hints: 1, firstTry: 'yes', completedAt: valid.completedAt },
  ]) {
    const result = parseScenarioProgress({ 'guest-ac': item }, ids);
    expect(result['guest-ac'], JSON.stringify(item)).toBeUndefined();
  }
});

test('earlier hints and mistakes override an inconsistent unassisted flag', () => {
  const result = parseScenarioProgress({ 'guest-ac': {
    ...valid, firstTry: true,
  } }, ids);
  expect(result['guest-ac']?.firstTry).toBe(false);
  const legacy = parseScenarioProgress({ 'guest-ac': {
    attempts: 3, completedAt: valid.completedAt,
  } }, ids);
  expect(legacy['guest-ac']?.attempts).toBe(3);
  expect(legacy['guest-ac']?.hints).toBe(0);
  expect(legacy['guest-ac']?.firstTry).toBe(false);
});

test('saved records from an unknown schema do not crash training', () => {
  for (const raw of [null, undefined, [], 123, 'old', new Date(), {}]) {
    expect(parseScenarioProgress(raw, ids)).toEqual({});
  }
});
