export type Field = {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'select' | 'textarea';
  options?: string[];
  source?: 'users' | 'rooms' | 'departments';
};

export type ModuleConfig = {
  resource: string;
  title: string;
  eyebrow: string;
  createLabel: string;
  statuses: string[];
  filters: string[];
  fields: Field[];
  cardMeta: string[];
};

const priority = ['Low', 'Normal', 'Urgent'];

export const configs: Record<string, ModuleConfig> = {
  projects: {
    resource: 'projects', title: 'Projects', eyebrow: 'Plan', createLabel: 'Project',
    statuses: ['Planned', 'Active', 'Paused', 'Done'], filters: ['Active', 'Planned', 'Paused', 'Done'],
    cardMeta: ['status', 'priority', 'due_date'],
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status', type: 'select', options: ['Planned', 'Active', 'Paused', 'Done'] },
      { key: 'priority', label: 'Priority', type: 'select', options: priority },
      { key: 'due_date', label: 'Due', type: 'date' },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
  },
  tasks: {
    resource: 'tasks', title: 'Tasks', eyebrow: 'Work', createLabel: 'Task',
    statuses: ['To Do', 'Doing', 'Review', 'Done'], filters: ['All', 'To Do', 'Doing', 'Review', 'Done'],
    cardMeta: ['status', 'priority', 'due_date', 'assigned_to_id'],
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status', type: 'select', options: ['To Do', 'Doing', 'Review', 'Done'] },
      { key: 'priority', label: 'Priority', type: 'select', options: priority },
      { key: 'assigned_to_id', label: 'Assigned to', source: 'users' },
      { key: 'due_date', label: 'Due', type: 'date' },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
  },
  shift: {
    resource: 'shift-notes', title: 'Shift', eyebrow: 'Handover', createLabel: 'Note',
    statuses: ['New', 'Seen', 'Follow', 'Done'], filters: ['All', 'New', 'Follow', 'Seen', 'Done'],
    cardMeta: ['shift', 'category', 'status', 'urgency'],
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'shift', label: 'Shift', type: 'select', options: ['AM', 'PM', 'Night'] },
      { key: 'category', label: 'Tag', type: 'select', options: ['Guest', 'Room', 'Fix', 'Supply', 'Payment', 'Event', 'Staff', 'Other'] },
      { key: 'urgency', label: 'Priority', type: 'select', options: priority },
      { key: 'status', label: 'Status', type: 'select', options: ['New', 'Seen', 'Follow', 'Done'] },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
  },
  guests: {
    resource: 'guests', title: 'Guests', eyebrow: 'Follow', createLabel: 'Guest',
    statuses: ['Open', 'Follow', 'Done'], filters: ['All', 'Open', 'Follow', 'Done'],
    cardMeta: ['issue_type', 'urgency', 'status', 'room_area_id'],
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'issue_type', label: 'Type', type: 'select', options: ['AC', 'Towel', 'WiFi', 'Noise', 'Food', 'Payment', 'Checkout', 'Complaint', 'Request', 'Other'] },
      { key: 'urgency', label: 'Priority', type: 'select', options: priority },
      { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Follow', 'Done'] },
      { key: 'room_area_id', label: 'Room / area', source: 'rooms' },
      { key: 'assigned_to_id', label: 'Assigned to', source: 'users' },
      { key: 'guest_name', label: 'Guest' },
      { key: 'follow_up_date', label: 'Follow up', type: 'date' },
      { key: 'action_taken', label: 'Action', type: 'textarea' },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
  },
  fixes: {
    resource: 'fixes', title: 'Fixes', eyebrow: 'Repair', createLabel: 'Fix',
    statuses: ['Open', 'Working', 'Done', 'Verified'], filters: ['All', 'Open', 'Working', 'Done', 'Verified'],
    cardMeta: ['status', 'urgency', 'room_area_id', 'assigned_to_id'],
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'urgency', label: 'Priority', type: 'select', options: priority },
      { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Working', 'Done', 'Verified'] },
      { key: 'room_area_id', label: 'Room / area', source: 'rooms' },
      { key: 'assigned_to_id', label: 'Assigned to', source: 'users' },
      { key: 'problem', label: 'Problem', type: 'textarea' },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
  },
  approve: {
    resource: 'approvals', title: 'Approve', eyebrow: 'Decide', createLabel: 'Item',
    statuses: ['Pending', 'Approved', 'Rejected'], filters: ['All', 'Pending', 'Approved', 'Rejected'],
    cardMeta: ['status', 'priority', 'source_type'],
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'source_type', label: 'Type', type: 'select', options: ['post', 'task', 'guest', 'fix', 'memo', 'project', 'ops_need'] },
      { key: 'priority', label: 'Priority', type: 'select', options: priority },
      { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Approved', 'Rejected'] },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
  },
};

export const extraConfigs: Record<string, ModuleConfig> = {
  requests: {
    resource: 'requests', title: 'Requests', eyebrow: 'Propose', createLabel: 'Request',
    statuses: ['Draft', 'Review', 'Approved', 'Rejected', 'Planned', 'Done'], filters: ['All', 'Draft', 'Review', 'Approved', 'Rejected', 'Planned', 'Done'],
    cardMeta: ['request_type', 'urgency', 'status', 'assigned_to_id'],
    fields: [
      { key: 'title', label: 'Request' },
      { key: 'request_type', label: 'Type', type: 'select', options: ['General', 'Equipment', 'Policy', 'Process', 'Staffing', 'Supply', 'Marketing', 'Maintenance', 'Event', 'Other'] },
      { key: 'urgency', label: 'Priority', type: 'select', options: priority },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Review', 'Approved', 'Rejected', 'Planned', 'Done'] },
      { key: 'assigned_to_id', label: 'Assigned to', source: 'users' },
      { key: 'reason', label: 'Reason', type: 'textarea' },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
  },
  talk: {
    resource: 'talk', title: 'Talk', eyebrow: 'Thread', createLabel: 'Message',
    statuses: ['Open', 'Done'], filters: ['All', 'Open', 'Done'],
    cardMeta: ['message_type', 'status'],
    fields: [
      { key: 'message_type', label: 'Type', type: 'select', options: ['Update', 'Ask', 'Follow', 'Decision', 'File'] },
      { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Done'] },
      { key: 'body', label: 'Message', type: 'textarea' },
    ],
  },
  docs: {
    resource: 'docs', title: 'Docs', eyebrow: 'SOP', createLabel: 'Doc',
    statuses: ['Active', 'Archived'], filters: ['All', 'Active', 'Archived'],
    cardMeta: ['doc_type', 'status'],
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'doc_type', label: 'Type', type: 'select', options: ['SOP', 'Policy', 'Checklist', 'Guide', 'Brand', 'Other'] },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Archived'] },
      { key: 'body', label: 'Body', type: 'textarea' },
    ],
  },
  routines: {
    resource: 'routines', title: 'Routine', eyebrow: 'Repeat', createLabel: 'Routine',
    statuses: ['Active', 'Paused', 'Archived'], filters: ['All', 'Active', 'Paused', 'Archived'],
    cardMeta: ['frequency', 'priority', 'status'],
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'frequency', label: 'Frequency', type: 'select', options: ['Every shift', 'Daily', 'Weekly', 'Monthly', 'Custom'] },
      { key: 'priority', label: 'Priority', type: 'select', options: priority },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Paused', 'Archived'] },
      { key: 'checklist', label: 'Checklist', type: 'textarea' },
    ],
  },
};

Object.assign(configs, extraConfigs);
