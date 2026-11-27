import {readFileSync} from 'node:fs';
import {expect,test,type Page} from '@playwright/test';
import {TRAINING_LESSONS} from '../lib/interactive-training';
const privateAccounts=process.env.TRAINING_TEST_ACCOUNTS;
test.skip(!privateAccounts,'Requires its own newly seeded fictional training profile.');
async function setup(page:Page,kind:string,reference:string,path:string){
  const roster=JSON.parse(readFileSync(privateAccounts!,'utf8'));
  const account=roster.accounts.find((item:{email:string})=>item.email==='owner@training.invalid');
  const response=await page.request.post('/api/auth/login',{data:{email:account.email,password:account.password}});expect(response.ok()).toBeTruthy();const user=await response.json();
  await page.addInitScript(({user,kind,reference,passed})=>{
    if(localStorage.getItem('live-exercise')===reference)return;
    localStorage.setItem('live-exercise',reference);localStorage.setItem('cc_user',JSON.stringify(user));localStorage.setItem('cc_department_id',String(user.primary_department_id||user.departments[0].id));
    localStorage.setItem('ho-ops-structured-course-v2:'+user.id,JSON.stringify({practiceRevision:2,stage:'finished',lessonId:'orientation',passed,question:0}));
    localStorage.setItem('ho-ops-verified-workflow-v1:'+user.id,JSON.stringify({kind,reference,ownerId:String(user.id),createdAt:new Date().toISOString(),step:0}));
  },{user,kind,reference,passed:TRAINING_LESSONS.map(lesson=>lesson.id)});
  await page.goto(path);await expect(page.getByTestId('training-check-work')).toBeVisible();
  await page.getByTestId('show-workflow-arrows').click();return user;
}
async function check(page:Page,step:number,user:any){await page.getByTestId('training-check-work').click();await expect.poll(()=>page.evaluate(id=>JSON.parse(localStorage.getItem('ho-ops-verified-workflow-v1:'+id)||'{}').step,user.id)).toBe(step)}
const suffix=()=>Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,5).toUpperCase();
test('actual project plan and discussion survive reload and require saved work',async({page})=>{
 const ref='TRN-PROJECT-'+suffix();const user=await setup(page,'project-plan',ref,'/projects');
 await page.getByTestId('training-check-work').click();await expect(page.getByTestId('training-workflow-message')).toContainText('Save a Planned project');
 await page.getByRole('button',{name:'New project',exact:true}).click();const form=page.getByTestId('create-project-form');
 await form.getByLabel('Project title').fill('Pool event preparation '+ref);await form.getByLabel('Due date').fill('2026-12-15');await form.getByRole('combobox',{name:'Priority'}).selectOption('High');await form.getByLabel('Notes').fill('Prepare the fictional pool event seating and check supplies with the team.');await form.getByRole('button',{name:'Create project',exact:true}).click();await expect(form).toHaveCount(0);await check(page,1,user);
 await page.getByTestId('training-open-module').click();await page.getByLabel('Discussion message').fill('Next, check the fictional seating layout and ask the team to confirm supplies. '+ref);await page.getByRole('button',{name:'Post',exact:true}).click();await expect(page.getByLabel('Discussion message')).toHaveValue('');await page.reload();await check(page,2,user);await expect(page.locator('.training-workflow-finished')).toContainText('Practice finished');
});
test('actual Pool post reaches Review through its real actions',async({page})=>{
 const ref='TRN-POST-'+suffix();const user=await setup(page,'marketing-review',ref,'/posts');
 await page.getByRole('button',{name:'New content',exact:true}).click();const form=page.locator('.marketing-workspace .marketing-form').filter({has:page.locator('input[name="concept-title"]')});
 await form.getByLabel('Post title',{exact:true}).fill('Fictional Pool offer '+ref);
 await form.getByRole('combobox',{name:'Default format',exact:true}).selectOption('Static');
 await form.getByLabel('Publishing date',{exact:true}).fill(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'}));
 await form.getByRole('checkbox',{name:'Pool',exact:true}).check();await form.getByRole('checkbox',{name:'Instagram',exact:true}).uncheck();
 await form.getByLabel('Caption for all platforms').fill('Enjoy a fictional Pool afternoon offer with friends. Ask our team for the practice details.');
 await form.getByRole('button',{name:'Create 1 post',exact:true}).click();await expect(form).toHaveCount(0);await page.getByRole('button',{name:'Close details',exact:true}).click();await check(page,1,user);
 for(const [index,action] of ['Start draft','Submit review'].entries()){
  await page.locator('.marketing-workspace button').filter({hasText:ref}).click();const drawer=page.locator('.drawer-backdrop');await drawer.getByRole('button',{name:action,exact:true}).click();await drawer.getByRole('button',{name:'Close details',exact:true}).click();await check(page,index+2,user);
 }
 await expect(page.locator('.training-workflow-finished')).toContainText('Practice finished');
});
test('actual colleague approvals require both decisions and survive a fresh attempt',async({page})=>{
 const ref='TRN-DECISION-'+suffix();const user=await setup(page,'decision-review',ref,'/approvals');await page.getByTestId('training-prepare-review').click();await expect(page.getByTestId('training-prepare-review')).toHaveCount(0);await page.reload();await page.getByTestId('show-workflow-arrows').click();
 const original=await page.evaluate(id=>JSON.parse(localStorage.getItem('ho-ops-verified-workflow-v1:'+id)||'{}'),user.id);
 for(const [index,[title,action,note]] of [['Missing supplier quote','Reject','Supplier quote is missing; please provide it first.'],['Checked supplier quote','Approve','Supplier quote checked and the amount supports this work.']].entries()){
  await page.locator('.ops-work-card').filter({hasText:title+' '+ref}).click();const drawer=page.locator('.drawer-backdrop');await drawer.locator('textarea').fill(note);await drawer.getByRole('button',{name:action,exact:true}).click();await expect(drawer).toHaveCount(0);await check(page,index+1,user);
 }
 await page.getByTestId('repeat-real-workflow').click();await page.getByTestId('training-prepare-review').click();
 await expect(page.getByTestId('training-prepare-review')).toHaveCount(0);
 const earlier=await page.evaluate(async id=>{const response=await fetch('/api/approvals/'+id,{credentials:'same-origin'});return response.json()},original.recordId);expect(earlier.status).toBe('Rejected');
});
test('trainer saves a private complete copy and stages it without replacing current saved work',async({page})=>{
 const user=await setup(page,'project-plan','TRN-PROJECT-'+suffix(),'/training');
 await page.getByRole('button',{name:/Staff training results/}).click();const transfer=page.getByRole('region',{name:'Move training',exact:true});await expect(transfer).toBeVisible();
 await transfer.getByLabel('New copy password',{exact:true}).fill('private-training-copy-20261127');await transfer.getByLabel('Confirm password',{exact:true}).fill('private-training-copy-20261127');
 const downloading=page.waitForEvent('download');await transfer.getByRole('button',{name:'Save complete training copy',exact:true}).click();const download=await downloading;const path=await download.path();expect(path).toBeTruthy();
 const original=await page.evaluate(id=>localStorage.getItem('ho-ops-verified-workflow-v1:'+id),user.id);
 await transfer.getByText('Open a training copy on this computer',{exact:true}).click();await transfer.getByLabel('Training copy',{exact:true}).setInputFiles(path!);await transfer.getByLabel('Copy password',{exact:true}).fill('wrong-copy-password');await transfer.getByRole('button',{name:'Open complete training copy',exact:true}).click();await expect(transfer.getByRole('status')).toContainText('Check the password');
 await transfer.getByLabel('Copy password',{exact:true}).fill('private-training-copy-20261127');await transfer.getByRole('button',{name:'Open complete training copy',exact:true}).click();await expect(transfer.getByRole('status')).toContainText('Close this app');expect(await page.evaluate(id=>localStorage.getItem('ho-ops-verified-workflow-v1:'+id),user.id)).toBe(original);
});
