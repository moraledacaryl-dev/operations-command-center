import { test,expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { availableTrainingLessons } from '../lib/interactive-training';
import { completeReadOnlyLesson } from './live-course-helpers';
import cases from '../../backend/scripts/shift_challenge_cases.json';
import { modelShiftAnswers } from './shift-challenge-fixtures';

const rosterPath=process.env.TRAINING_WALKTHROUGH_ROSTER;
test.skip(!rosterPath,'Needs isolated fictional training database and private roster');
const accounts=['reception-pm','housekeeper-am','barista-am','cook','technician','marketing-assistant','guard'];
for(const [i,c]of cases.entries())test('real '+c.department+' shift: own login, actual records, saved comment and personal notice',async({page})=>{
 const account=JSON.parse(readFileSync(rosterPath!,'utf8')).accounts.find((a:{email:string})=>a.email===accounts[i]+'@training.invalid');
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);
 const login=page.waitForResponse(r=>r.url().endsWith('/api/auth/login'));await page.getByRole('button',{name:'Sign in',exact:true}).click();const user=await(await login).json();
 for(const lesson of availableTrainingLessons(user.capabilities,user.departments))await completeReadOnlyLesson(page,lesson,c.department);
 await page.getByRole('button',{name:'Close training',exact:true}).click();
 await page.getByRole('link',{name:'Hands-on Training',exact:true}).click();await page.getByRole('link',{name:'Open your shift challenge',exact:true}).click();
 await page.getByRole('button',{name:'Start shift challenge',exact:true}).click();await page.getByRole('button',{name:'Check shift challenge',exact:true}).click();
 await expect(page.getByText('Still to do',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Shift challenge completed'})).toHaveCount(0);
 // Use the actual module menu and real detail drawers. No completed markers or API mocks.
 const shiftLink=page.getByRole('link',{name:'Shift Handover',exact:true});if(!(await shiftLink.isVisible()))await page.locator('.ops-nav-group summary[aria-label="Property"]').click();await shiftLink.click();
 await page.getByRole('button').filter({hasText:c.reference+' — shift handover'}).click();await expect(page.getByRole('dialog').getByText(c.situation,{exact:false}).first()).toBeVisible();
 await page.getByRole('button',{name:'Close details'}).click();await page.getByRole('link',{name:'My Work',exact:true}).click();
 await page.getByRole('button').filter({hasText:c.reference+' — '+c.title}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Close details'}).click();
 await page.getByRole('link',{name:/^Notifications,/}).click();const notice=page.getByRole('article').filter({hasText:c.reference+' — shift notice'});await notice.getByRole('button',{name:'Mark read',exact:true}).click();
 await expect(notice.getByRole('button',{name:'Mark read',exact:true})).toHaveCount(0);await expect(notice).not.toContainText('Unread');await page.getByRole('link',{name:'Return to your challenge',exact:true}).click();
 const answers=modelShiftAnswers(c);
 for(const [label,field]of [['What status is saved on the handover?','status'],['How soon should staff act?','priority'],['Which team should handle the problem?','team'],['What should happen next?','decision']]as const)await page.getByLabel(label,{exact:true}).selectOption(answers[field]);
 for(const [label,field]of [['Who should take responsibility?','owner'],['What will be checked next, and when?','followUp'],['Your note for the next shift','note']]as const)await page.getByLabel(label,{exact:true}).fill(answers[field]);
 await page.reload();await expect(page.getByLabel('Your note for the next shift',{exact:true})).toHaveValue(answers.note);
 await page.getByRole('button',{name:'Check shift challenge',exact:true}).click();await expect(page.getByText('Your follow-up has not been found on this job. Save it below, then check again.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Save follow-up on my job',exact:true}).click();await expect(page.getByText('Your follow-up is saved on your assigned job. Choose Check shift challenge when you are ready.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Check shift challenge',exact:true}).click();await expect(page.getByRole('heading',{name:'Shift challenge completed',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'Shift challenge completed',exact:true})).toBeVisible();await page.getByRole('button',{name:'Check saved records again',exact:true}).click();await expect(page.getByText('Checked against your saved job, follow-up and notice.',{exact:true})).toBeVisible();
});
