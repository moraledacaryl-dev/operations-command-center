/** Staff see the work to do, not the transport fields that delivered it. */
export function displayWorkText(value: unknown): string {
  const text = String(value ?? '');
  if (text === 'Check event date, venue and booking requirements in Accounting') {
    return 'Check the event date, venue and requirements';
  }
  const eventNote = text.match(/^Accounting event ([A-Za-z0-9_-]+) · (\d{4}-\d{2}-\d{2}) · (.+)\. Booking, client, pricing and payments remain in Accounting\. Check the source event for changes before final setup\.$/);
  if (eventNote) return `Event ${eventNote[1]} · ${eventNote[2]} · ${eventNote[3]}. Check the booking details before setup.`;
  const taskNote = text.match(/^Event ([A-Za-z0-9_-]+)\. Coordinate with lead; consult Accounting for booking details\.$/);
  if (taskNote) return `Event ${taskNote[1]}. Check the details with your lead.`;
  return text;
}

export function workErrorText(message: string): string {
  if (/archived.*(?:reconcil|workflow)/i.test(message)) return 'This item is in History and cannot be changed here.';
  if (/canonical|payload|schema|capabilit|integration.*(?:key|credential)|source identity|inbox.*linkage|unknown workflow/i.test(message)) {
    return 'This change could not be saved. Refresh the page or ask your manager for help.';
  }
  return message;
}

export function workTypeLabel(value: unknown): string {
  const labels: Record<string, string> = {
    ops_need: 'Request', request: 'Request', task: 'Task', guest: 'Guest issue',
    fix: 'Repair', post: 'Post', memo: 'Notice', project: 'Project',
    event_booking: 'Event', room_booking: 'Room booking',
  };
  return labels[String(value || '')] || 'Request';
}

export function reviewTitle(item: Record<string, any>): string {
  if (item.title === 'Room booking needs room mapping') return 'Room details need checking';
  const labels: Record<string, string> = {
    'room.booking.updated': 'Room booking changed',
    'event.booking.confirmed': 'New event booking',
    'event.booking.changed': 'Event details changed',
    'event.booking.cancelled': 'Event cancelled',
    'event.booking.completed': 'Event finished',
    'budget.variance.alert': 'Budget needs checking',
    'drawer_reconciliation.pending': 'Cash count needs checking',
    'receivable.issue': 'Unpaid amount needs checking',
    'journal_review.pending': 'Entry needs review',
    'payable.due': 'Payment due',
  };
  return labels[String(item.event_type || '')] || displayWorkText(item.title || item.name || 'Review item');
}

export const detailLabels: Record<string, string> = {
  title: 'Title', name: 'Name', message: 'Message', content: 'Content', reference: 'Reference', event_no: 'Event number', service_date: 'Date', employee_name: 'Employee', effective_date: 'Starts', expires_at: 'Ends', approved_by_name: 'Approved by', status: 'Status', review_status: 'Review status',
  priority: 'Priority', urgency: 'Priority', note: 'Notes', body: 'Message',
  reason: 'Reason', problem: 'Problem', description: 'Description', summary: 'Summary',
  decision_note: 'Decision note', action_taken: 'Work done', resolution_note: 'Result',
  verification_note: 'Inspection note', reopen_reason: 'Reason reopened',
  guest_name: 'Guest', room_name: 'Room', department_name: 'Department',
  assigned_to_name: 'Assigned to', assignee_name: 'Assigned to', owner_name: 'Responsible person',
  requested_by_name: 'Requested by', submitted_by_name: 'Submitted by', author_name: 'Written by',
  reported_by_name: 'Reported by', created_by_name: 'Created by', technician_name: 'Assigned to',
  verified_by_name: 'Checked by', decided_by_name: 'Decided by', reviewed_by_name: 'Reviewed by',
  due_date: 'Due date', target_date: 'Target date', follow_up_date: 'Follow-up date',
  start_date: 'Start date', end_date: 'End date', scheduled_at: 'Scheduled for',
  submitted_at: 'Submitted', verified_at: 'Checked', decided_at: 'Decided',
  shift: 'Shift', category: 'Category', issue_type: 'Issue', request_type: 'Request type',
  message_type: 'Message type', doc_type: 'Document type', frequency: 'Repeat',
  checklist: 'Checklist', caption: 'Caption', caption_snapshot: 'Caption for this version',
  content_pillar: 'Topic', brief: 'Brief', platform: 'Platform', format: 'Format',
  publish_date: 'Publish date', final_publication_url: 'Published post',
  location: 'Location', filename: 'File name', file_url: 'File', proof_url: 'Photo or file',
  notes: 'Notes', topic: 'Topic', instructions: 'Instructions', quantity: 'Quantity',
};
