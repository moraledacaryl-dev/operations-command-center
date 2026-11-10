import { expect, test } from '@playwright/test';
import { availableTrainingLessons } from '../lib/interactive-training';
import { parseWorkflowSession, verifyWorkflowStep, type TrainingWorkflowSession } from '../lib/training-workflows';

const session: TrainingWorkflowSession = {
  kind: 'bar-report', ownerId: '99', reference: 'TRN-BAR-ABCD1234',
  createdAt: '2026-11-10T01:00:00Z', step: 0, departmentId: 8,
};
const correct = {
  id: 123, title: 'TRN-BAR-ABCD1234 Mocktail syrup low', category: 'Low stock',
  note: 'Mocktail syrup almost gone. Count bottles and tell the next bartender on the next shift.',
  department_id: 8, status: 'New', urgency: 'Normal',
};

test('Bar reporting lesson belongs only to actual Bar members, including ordinary staff', () => {
  const staffCapabilities = { manage_department: false, view_all_operations: false };
  expect(availableTrainingLessons(staffCapabilities, [{ name: 'Bar' }]).some(x => x.id === 'bar')).toBe(true);
  expect(availableTrainingLessons(staffCapabilities, [{ name: 'Kitchen' }, { name: 'Housekeeping' }]).some(x => x.id === 'bar')).toBe(false);
  expect(availableTrainingLessons({ ...staffCapabilities, view_all_operations: true }, [{ name: 'Front Desk' }]).some(x => x.id === 'bar')).toBe(false);
});

test('Bar verified practical requires a saved, department-matched incident with actionable shift details', () => {
  expect(verifyWorkflowStep(session, []).passed).toBe(false);
  expect(verifyWorkflowStep(session, [{ ...correct, department_id: 9 }]).passed).toBe(false);
  expect(verifyWorkflowStep(session, [{ ...correct, category: 'Equipment' }]).passed).toBe(false);
  expect(verifyWorkflowStep(session, [{ ...correct, note: 'Need more syrup' }]).passed).toBe(false);
  expect(verifyWorkflowStep(session, [{ ...correct, title: 'Some unrelated note' }]).passed).toBe(false);
  expect(verifyWorkflowStep(session, [correct])).toMatchObject({ passed: true, recordId: 123 });
});

test('Bar practice refuses unscoped or mismatched training sessions', () => {
  const missing = { ...session, departmentId: undefined };
  expect(parseWorkflowSession(JSON.stringify(missing), session.ownerId)).toBeNull();
  expect(parseWorkflowSession(JSON.stringify(session), 'different-user')).toBeNull();
  expect(parseWorkflowSession(JSON.stringify(session), session.ownerId)).toMatchObject({
    kind: 'bar-report', departmentId: 8, reference: session.reference,
  });
});
