import { expect, test } from '@playwright/test';
import { COURSE_GUIDES } from '../lib/training-course';
import { INDEPENDENT_CHECKS, independentActionMatches } from '../lib/training-independent';
import { buildTrainingReport, mergePortableLearning, parseTrainingReport, portableLearningCredit } from '../lib/training-progress-report';
import { decryptTrainingReport, encryptTrainingReport } from '../lib/training-encrypted-report';
import { readFile } from 'node:fs/promises';
import { practiceScenariosFor } from '../lib/practice-scenarios';
import { mergeScenarioBackup, readScenarioBackup } from '../lib/training-scenario-backup';

const trainee = {
  id: 8401, name: 'Fictional Practice Staff', email: 'offline-training@training.invalid',
  role: 'staff', is_active: true, departments: [{ id: 41, name: 'Front Desk', is_primary: true }],
  primary_department_id: 41, capabilities: {},
};
const completed = ['orientation','staff-handover','staff-rooms','room-arrivals','staff-my-work'];
function reportFor(id = '8401') {
  return buildTrainingReport({
    lessonId: 'team-tasks', stage: 'learn', question: 0,
    passed: [...completed,'team-tasks'],
    metrics: { orientation: { incorrectAnswers: 2, repeats: 1, completedAt: '2026-11-02T00:00:00Z' } },
  },{id,name:'Fictional Practice Staff',role:'staff'},{},'2026-11-02T01:00:00Z');
}
async function init(page: import('@playwright/test').Page, user: Record<string,unknown>, course: Record<string,unknown>) {
  await page.addInitScript(({account, progress}) => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id','41');
    localStorage.setItem('ho-ops-structured-course-v2:'+String(account.id),JSON.stringify(progress));
  },{account:user,progress:course});
  await page.route('**/api/**',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({items:[],groups:{},counts:{},unread_count:0}),
  }));
}

test('every role lesson has a two-action independent skills check', () => {
  for (const [id,guide] of Object.entries(COURSE_GUIDES)) {
    const challenges = INDEPENDENT_CHECKS[id];
    expect(challenges,id).toHaveLength(2);
    expect(challenges[0].selector.length,id).toBeGreaterThan(10);
    expect(challenges[1].selector.length,id).toBeGreaterThan(10);
    expect(guide.explanation.length,id).toBeGreaterThan(75);
    if (guide.branches?.length) {
      for (const branch of guide.branches) {
        expect(branch.choices).toHaveLength(3);
        expect(branch.response.length).toBeGreaterThan(25);
      }
    }
  }
});

test('portable reports reject malformed data and never restore saved-record lessons', () => {
  const report=reportFor();
  expect(parseTrainingReport(report)?.trainee.id).toBe('8401');
  expect(report.metrics.orientation.incorrectAnswers).toBe(2);
  expect(portableLearningCredit(report,['orientation','staff-handover','staff-rooms','room-arrivals','staff-my-work','team-tasks']))
    .toEqual(['orientation','staff-my-work']);
  const barReport = {...report, completedLessons: [...report.completedLessons, 'bar'], verifiedPractice: [{kind:'bar-report',reference:'TRN-BAR-ABCDEFGH',completedAt:'2026-11-02T01:00:00Z',stages:2}]};
  expect(parseTrainingReport(barReport)?.verifiedPractice).toHaveLength(1);
  expect(portableLearningCredit(barReport, ['orientation','bar'])).toEqual(['orientation']);
  expect(parseTrainingReport({...report,schema:'other'})).toBeNull();
  expect(parseTrainingReport({...report,trainee:{id:'x'}})).toBeNull();
});

test('encrypted lesson backups reject wrong passwords, changed files and other logins', async () => {
  const report = reportFor();
  const backup = await encryptTrainingReport(report, trainee.email, 'hidden oasis practice 123');
  expect(JSON.parse(backup).format).toBe('hidden-oasis-encrypted-report-v1');
  expect(backup).not.toContain(trainee.email);
  expect(backup).not.toContain('Fictional Practice Staff');
  expect(await decryptTrainingReport(backup, trainee.email, 'hidden oasis practice 123')).toEqual(report);
  await expect(decryptTrainingReport(backup, trainee.email, 'incorrect password')).rejects.toThrow();
  await expect(decryptTrainingReport(backup, 'other@training.invalid', 'hidden oasis practice 123')).rejects.toThrow();
  const modified = JSON.parse(backup); modified.data = modified.data.slice(0, -8) + 'AAAAAAAA';
  await expect(decryptTrainingReport(JSON.stringify(modified), trainee.email, 'hidden oasis practice 123')).rejects.toThrow();
});

test('restoring an older report preserves saved practice and the current lesson', () => {
  const current = {lessonId:'staff-rooms', stage:'quiz' as const, question:1, passed:['orientation','staff-handover'],
    metrics:{'staff-handover':{incorrectAnswers:2}}};
  const merged = mergePortableLearning(current, reportFor(), ['orientation','staff-handover','staff-rooms','staff-my-work','team-tasks']);
  expect(merged.passed).toEqual(['orientation','staff-handover','staff-my-work']);
  expect(merged.lessonId).toBe('staff-rooms');
  expect(merged.stage).toBe('quiz');
  expect(merged.metrics?.['staff-handover']?.incorrectAnswers).toBe(2);
  expect(merged.passed).not.toContain('team-tasks');
});

test('scenario transfer preserves destination attempts and imports unfinished drafts', () => {
  const scenarios = practiceScenariosFor(trainee), first = scenarios[0], second = scenarios[1];
  const data = new Map<string,string>();
  const storage = {
    getItem: (key:string) => data.get(key) ?? null,
    setItem: (key:string, value:string) => {data.set(key,value);},
    removeItem: (key:string) => {data.delete(key);},
  } as Storage;
  storage.setItem('ho-ops-scenario-practice-v1:9', JSON.stringify({
    [first.id]: {attempts:5, mistakes:1, hints:0, completedAt:'2026-11-02T01:00:00Z'},
  }));
  mergeScenarioBackup(storage, '9', scenarios, {
    completed: {[first.id]: {attempts:1, mistakes:0, hints:0, completedAt:'2026-11-01T01:00:00Z'}, unknown: {attempts:1}},
    drafts: {[second.id]: {answers:{priority:'', department:'', decision:'', note:'Started', owner:'', followUp:''},
      phase:'assess', attempts:0, hintsUsed:0, mistakesMade:0, reasoning:{consequence:'',timing:''}}},
  });
  const saved = readScenarioBackup(storage, '9', scenarios);
  expect(saved.completed[first.id].attempts).toBe(5);
  expect(saved.drafts[second.id].answers.note).toBe('Started');
  expect(saved.completed.unknown).toBeUndefined();
});

test('scenario transfer rolls back if saving the second section fails', () => {
  const scenarios = practiceScenariosFor(trainee), first = scenarios[0];
  const data = new Map<string,string>();
  const progressKey = 'ho-ops-scenario-practice-v1:9', draftKey = 'ho-ops-scenario-drafts-v1:9';
  data.set(progressKey, '{"older":true}');
  let failOnce = true;
  const storage = {
    getItem: (key:string) => data.get(key) ?? null,
    setItem: (key:string, value:string) => {
      if (key === draftKey && failOnce) { failOnce = false; throw Error('storage full'); }
      data.set(key,value);
    },
    removeItem: (key:string) => {data.delete(key);},
  } as Storage;
  expect(() => mergeScenarioBackup(storage, '9', scenarios, {
    completed: {[first.id]:{attempts:1, mistakes:0, hints:0, completedAt:'2026-11-01T01:00:00Z'}}, drafts:{},
  })).toThrow('storage full');
  expect(data.get(progressKey)).toBe('{"older":true}');
  expect(data.has(draftKey)).toBe(false);
});

test('a malformed known scenario does not get silently dropped from a backup', () => {
  const scenarios = practiceScenariosFor(trainee), first = scenarios[0];
  const data = new Map<string,string>([['ho-ops-scenario-practice-v1:9','{}']]);
  const storage = {getItem:(key:string)=>data.get(key) ?? null,
    setItem:(key:string,value:string)=>{data.set(key,value);}, removeItem:(key:string)=>{data.delete(key);}} as Storage;
  expect(() => mergeScenarioBackup(storage, '9', scenarios,
    {completed:{[first.id]:{attempts:-1}}, drafts:{}})).toThrow('Invalid scenario history');
  expect(data.get('ho-ops-scenario-practice-v1:9')).toBe('{}');
  expect(data.has('ho-ops-scenario-drafts-v1:9')).toBe(false);
});

test('staff can move encrypted lesson history without erasing local progress', async ({page}) => {
  await init(page, trainee, {lessonId:'staff-handover', stage:'learn', question:0, passed:['orientation','staff-my-work']});
  const scenario = practiceScenariosFor(trainee)[0];
  await page.addInitScript(({id, scenarioId}) => {
    localStorage.setItem('ho-ops-scenario-practice-v1:'+id, JSON.stringify({
      [scenarioId]: {attempts:2, mistakes:1, hints:0, completedAt:'2026-11-02T01:00:00Z'},
    }));
  }, {id:trainee.id,scenarioId:scenario.id});
  await page.goto('/');
  const source = page.getByTestId('encrypted-learning-backup');
  await source.locator('summary').click();
  await source.getByLabel('Backup password (at least 12 characters)').fill('practice password 123');
  await source.getByLabel('Enter it again when saving').fill('practice password 123');
  const downloading = page.waitForEvent('download');
  await source.getByRole('button', {name:'Save encrypted lesson backup'}).click();
  const download = await downloading;
  const content = await readFile((await download.path())!);
  expect(JSON.parse(content.toString()).format).toBe('hidden-oasis-encrypted-report-v2');
  expect(content.toString()).not.toContain(trainee.email);

  const target = await page.context().newPage();
  const otherDeviceUser = {...trainee, id: 99841};
  await init(target, otherDeviceUser, {lessonId:'orientation', stage:'learn', question:0, passed:['staff-handover']});
  await target.goto('/');
  const backup = target.getByTestId('encrypted-learning-backup');
  await backup.locator('summary').click();
  await backup.getByLabel('Backup password (at least 12 characters)').fill('wrong password 123');
  await backup.getByLabel('Open an encrypted lesson backup').setInputFiles({name:'backup.json', mimeType:'application/json', buffer:content});
  await expect(backup).toContainText('Could not open this backup');
  await backup.getByLabel('Backup password (at least 12 characters)').fill('practice password 123');
  await backup.getByLabel('Open an encrypted lesson backup').setInputFiles({name:'backup.json', mimeType:'application/json', buffer:content});
  await expect(backup).toContainText('Lesson and scenario history added');
  const restored = await target.evaluate(id=>JSON.parse(localStorage.getItem('ho-ops-structured-course-v2:'+id)||'null'), otherDeviceUser.id);
  expect(restored.passed).toContain('staff-handover');
  expect(restored.passed).toContain('orientation');
  expect(restored.passed).toContain('staff-my-work');
  const scenarios = await target.evaluate(id=>JSON.parse(localStorage.getItem('ho-ops-scenario-practice-v1:'+id)||'{}'), otherDeviceUser.id);
  expect(scenarios[scenario.id]).toMatchObject({attempts:2, mistakes:1});
  await target.close();
});

test('two independent actual page clicks are required before course can complete', async ({page})=>{
  await init(page,trainee,{lessonId:'orientation',stage:'independent',question:0,independentStep:0,passed:[]});
  await page.goto('/');
  const independent = page.getByTestId('course-independent-challenge');
  await expect(independent).toContainText('No arrows');
  await expect(independent).toContainText('Find My Work and your notifications without an arrow.');
  await expect(independent.getByText('Need help finding it?')).toBeVisible();
  await independent.getByText('Need help finding it?').click();
  await expect(independent).toContainText('Follow the arrow to the menu');
  // The instructions must be ABOVE the real Operations workspace, not at the bottom.
  expect(await independent.evaluate(node => Boolean(
    node.compareDocumentPosition(document.querySelector('#workspace-main')) &
      Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const instructionBox = await independent.boundingBox();
  const workspaceBox = await page.locator('#workspace-main').boundingBox();
  expect(instructionBox && workspaceBox && instructionBox.y < workspaceBox.y).toBeTruthy();
  await expect(page.getByTestId('course-completed')).toHaveCount(0);
  await page.locator('.ops-sidebar a[aria-label="My Work"]').click();
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(page.getByTestId('course-independent-challenge')).toContainText('notifications');
  await expect(page.getByTestId('course-completed')).toHaveCount(0);
  await page.locator('a.ops-notifications').click();
  await expect(page.getByTestId('course-completed')).toContainText('Lesson 1 completed');
});

test('importing an older report repeats real-record lessons on a new device without inventing credit', async ({page})=>{
  await init(page,trainee,{lessonId:'orientation',stage:'learn',question:0,passed:[]});
  await page.goto('/');
  const completedOld = ['orientation','staff-handover','staff-rooms','staff-my-work'];
  const report = buildTrainingReport({
    lessonId:'staff-my-work',stage:'finished',question:0,passed:completedOld,
  },{id:trainee.id,name:trainee.name,role:trainee.role},{},'2026-11-02T01:00:00Z');
  const help = page.locator('details.ops-course-help').filter({hasText:'Need help with this lesson?'});
  await help.locator('summary').click();
  await help.locator('input[type=file]').setInputFiles({
    name:'previous-training.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(report)),
  });
  await expect(page.getByTestId('course-lesson-title')).toContainText('Reading a shift handover');
  await expect(page.getByTestId('training-update-available')).toHaveCount(0);
  const restored = await page.evaluate(id=>JSON.parse(
    localStorage.getItem('ho-ops-structured-course-v2:'+id)||'null'),trainee.id);
  expect(restored.passed).toEqual(['orientation','staff-my-work']);
  expect(restored.stage).toBe('learn');
  expect(restored.lessonId).toBe('staff-handover');
});

test('manager can restore ordinary lessons but must repeat record-backed work', async ({page})=>{
  const manager = {...trainee,role:'manager',capabilities:{manage_department:true,make_decisions:true,view_all_operations:true}};
  await init(page,manager,{lessonId:'orientation',stage:'learn',question:0,passed:[]});
  await page.goto('/');
  await expect(page.getByTestId('course-lesson-title')).toContainText('Getting around');
  const details=page.locator('details.ops-course-help').filter({hasText:'Need help with this lesson?'});
  await details.locator('summary').click();
  const report=reportFor();
  await details.locator('input[type=file]').setInputFiles({
    name:'progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(report)),
  });
  await expect(details).toContainText('Repeat any hands-on practice that needs saved work on this device.');
  await expect(page.getByTestId('course-lesson-title')).toContainText('Reading a shift handover');
  const progress=await page.evaluate(()=>JSON.parse(localStorage.getItem('ho-ops-structured-course-v2:8401')||'null'));
  expect(progress.passed).toEqual(['orientation','staff-my-work']);
  expect(progress.stage).toBe('learn');
});

test('supervisor can import a report, see attempts, and record local-only observation', async ({page})=>{
  const manager={...trainee,id:8501,role:'manager',capabilities:{manage_department:true,make_decisions:true,view_all_operations:true}};
  await init(page,manager,{lessonId:'accounts',stage:'finished',question:0,passed:Object.keys(COURSE_GUIDES)});
  await page.goto('/');
  await page.getByTestId('interactive-training-open').click();
  const dashboard=page.getByTestId('trainer-progress-dashboard');
  await expect(dashboard).toBeVisible();
  await dashboard.locator('.ops-trainer-toggle').click();
  await dashboard.getByLabel("Staff member's name").fill('Ann Clarin');
  await dashboard.locator('input[type=file]').setInputFiles({
    name:'trainee.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(reportFor())),
  });
  await expect(dashboard).toContainText('Ann Clarin');
  await dashboard.getByLabel("Staff member's name").fill('Joel Ucat');
  await dashboard.locator('input[type=file]').setInputFiles({ name:'trainee.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(reportFor())) });
  await expect(dashboard.locator('article')).toHaveCount(2);
  await expect(dashboard).toContainText('Joel Ucat');
  await expect(dashboard).toContainText('Quiz corrections: 2');
  await dashboard.locator('article').filter({hasText:'Ann Clarin'}).locator('textarea').fill('Practised guest communication but needs one more realistic handover scenario.');
  await dashboard.locator('article').filter({hasText:'Ann Clarin'}).getByRole('button',{name:'Save review note locally'}).click();
  await expect(dashboard).toContainText('Your review note was saved on this computer only');
  const saved=await page.evaluate(()=>localStorage.getItem('ho-ops-local-trainer-reports-v1:8501'));
  expect(saved).toContain('Practised guest communication');
});
