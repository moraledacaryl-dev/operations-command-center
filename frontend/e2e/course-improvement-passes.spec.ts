import { expect, test } from '@playwright/test';
import { COURSE_GUIDES } from '../lib/training-course';
import { INDEPENDENT_CHECKS, independentActionMatches } from '../lib/training-independent';
import { buildTrainingReport, parseTrainingReport, portableLearningCredit } from '../lib/training-progress-report';

const trainee = {
  id: 8401, name: 'Fictional Practice Staff', email: 'offline-training@training.invalid',
  role: 'staff', is_active: true, departments: [{ id: 41, name: 'Front Desk', is_primary: true }],
  primary_department_id: 41, capabilities: {},
};
const completed = ['orientation','staff-handover','staff-rooms','staff-my-work'];
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
  expect(portableLearningCredit(report,['orientation','staff-handover','staff-rooms','staff-my-work','team-tasks']))
    .toEqual(completed);
  expect(parseTrainingReport({...report,schema:'other'})).toBeNull();
  expect(parseTrainingReport({...report,trainee:{id:'x'}})).toBeNull();
});

test('two independent actual page clicks are required before course can complete', async ({page})=>{
  await init(page,trainee,{lessonId:'orientation',stage:'independent',question:0,independentStep:0,passed:[]});
  await page.goto('/');
  await expect(page.getByTestId('course-independent-challenge')).toContainText('No arrows');
  await expect(page.getByTestId('course-completed')).toHaveCount(0);
  await page.locator('.ops-sidebar a[aria-label="My Work"]').click();
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(page.getByTestId('course-independent-challenge')).toContainText('notifications');
  await expect(page.getByTestId('course-completed')).toHaveCount(0);
  await page.locator('a.ops-notifications').click();
  await expect(page.getByTestId('course-completed')).toContainText('Lesson 1 completed');
});

test('manager can restore read-only lesson history but must recheck saved records', async ({page})=>{
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
  await expect(details).toContainText('saved task/guest/maintenance records must be practised');
  await expect(page.getByTestId('course-lesson-title')).toContainText('Creating and managing a task');
  const progress=await page.evaluate(()=>JSON.parse(localStorage.getItem('ho-ops-structured-course-v2:8401')||'null'));
  expect(progress.passed).toEqual(completed);
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
  await dashboard.locator('input[type=file]').setInputFiles({
    name:'trainee.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(reportFor())),
  });
  await expect(dashboard).toContainText('Fictional Practice Staff');
  await expect(dashboard).toContainText('Quiz corrections: 2');
  await dashboard.locator('textarea').fill('Practised guest communication but needs one more realistic handover scenario.');
  await dashboard.getByRole('button',{name:'Save review note'}).click();
  await expect(dashboard).toContainText('Your review note was saved on this computer only');
  const saved=await page.evaluate(()=>localStorage.getItem('ho-ops-local-trainer-reports-v1:8501'));
  expect(saved).toContain('Practised guest communication');
});
