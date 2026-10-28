import { expect, test } from '@playwright/test';
import { verifyWorkflowStep } from '../lib/training-workflows';
import type { TrainingWorkflowSession } from '../lib/training-workflows';

const owner = '9701';
function state(kind: TrainingWorkflowSession['kind'], step: number, recordId?: number, relatedRecordId?: number): TrainingWorkflowSession {
  const prefix = {
    'guest-ac': 'TRN-GUEST-', 'shared-no-owner': 'TRN-TASK-',
    'shift-unresolved': 'TRN-SHIFT-', 'mt-light-fault': 'TRN-FIX-',
    'manager-evidence': 'TRN-REQ-', 'fd-broken-shower': 'TRN-LINK-',
  }[kind];
  return { kind, ownerId: owner, reference: prefix + 'ABC12345',
    createdAt: '2026-10-28T00:00:00.000Z', step, recordId, relatedRecordId };
}

test('cannot pass linked handoff with a same-title maintenance ticket that lacks reciprocal guest id', () => {
  const session = state('fd-broken-shower', 1, 501);
  const guest = { id: 501, title: 'Shower broken TRN-LINK-ABC12345', status: 'Follow', linked_fix_id: 702 };
  const unrelatedFix = { id: 702, title: guest.title, linked_guest_note_id: 999, status: 'Open' };
  expect(verifyWorkflowStep(session, [], guest, unrelatedFix).passed).toBe(false);
  const rightFix = { ...unrelatedFix, linked_guest_note_id: 501 };
  expect(verifyWorkflowStep(session, [], guest, rightFix)).toMatchObject({
    passed: true, recordId: 501, relatedRecordId: 702,
  });
});

test('cannot substitute another work order after the original handoff was verified', () => {
  const guest = { id: 501, title: 'Shower issue TRN-LINK-ABC12345', status: 'Follow', linked_fix_id: 703 };
  const replacement = { id: 703, title: guest.title, linked_guest_note_id: 501, status: 'Working' };
  expect(verifyWorkflowStep(state('fd-broken-shower', 2, 501, 702), [], guest, replacement).passed).toBe(false);
});

test('linked Fix verification must atomically complete the Guest Matter', () => {
  const guest = { id: 501, title: 'Shower issue TRN-LINK-ABC12345', linked_fix_id: 702, status: 'Done' };
  const fix = { id: 702, title: guest.title, linked_guest_note_id: 501, status: 'Verified' };
  expect(verifyWorkflowStep(state('fd-broken-shower', 4, 501, 702), [], guest, fix).passed).toBe(true);
  expect(verifyWorkflowStep(state('fd-broken-shower', 4, 501, 702), [], { ...guest, status: 'Follow' }, fix).passed).toBe(false);
  expect(verifyWorkflowStep(state('fd-broken-shower', 3, 501, 702), [], { ...guest, status: 'Follow' }, { ...fix, status: 'Done' }).passed).toBe(true);
});

test('cannot pass equipment request with unassigned cost and no quote status, or mistake review for approval', () => {
  const session = state('manager-evidence', 0);
  const inadequate = { id: 901, title: 'New kitchen machine TRN-REQ-ABC12345',
    request_type: 'Equipment', urgency: 'Urgent', reason: 'Kitchen wants equipment urgently.' };
  expect(verifyWorkflowStep(session, [inadequate]).passed).toBe(false);
  const complete = { ...inadequate,
    reason: 'Urgently necessary for safe service; estimated cost PHP 12000; supplier quotation pending, no quotation attached.' };
  expect(verifyWorkflowStep(session, [complete]).passed).toBe(true);
  const reviewSession = state('manager-evidence', 1, 901);
  expect(verifyWorkflowStep(reviewSession, [], { ...complete, status: 'Approved' }).passed).toBe(false);
  expect(verifyWorkflowStep(reviewSession, [], { ...complete, status: 'Review' }).passed).toBe(true);
});

test('task requires a saved real assignee, not merely High priority and title', () => {
  const session = state('shared-no-owner', 0);
  const orphan = { id: 601, title: 'Follow up TRN-TASK-ABC12345', priority: 'High', assigned_to_id: null };
  expect(verifyWorkflowStep(session, [orphan]).passed).toBe(false);
  expect(verifyWorkflowStep(session, [{ ...orphan, assigned_to_id: 77 }]).passed).toBe(true);
});
