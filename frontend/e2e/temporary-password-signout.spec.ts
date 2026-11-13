import { expect, test } from '@playwright/test';

async function prepare(page: import('@playwright/test').Page, logoutStatus: number) {
  await page.addInitScript(() => {
    localStorage.setItem('cc_user', JSON.stringify({id: 51, name: 'Fictional staff', must_change_password: true}));
    localStorage.setItem('cc_department_id', '4');
  });
  let logoutCalls = 0;
  await page.route('**/api/notifications**', route => route.fulfill({status: 200, json: {items: [], unread_count: 0}}));
  await page.route('**/api/auth/logout', route => {
    logoutCalls++;
    return route.fulfill({ status: logoutStatus, json: logoutStatus === 200 ? {ok:true} : {detail:'Unavailable'} });
  });
  await page.goto('/change-password');
  return () => logoutCalls;
}

test('staff can sign out of the temporary-password screen and return to sign-in', async ({page}) => {
  const calls = await prepare(page, 200);
  await page.getByRole('button', {name:'Sign out and use another account'}).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', {name:'Sign in to Operations'})).toBeVisible();
  expect(calls()).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('cc_user'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('cc_department_id'))).toBeNull();
});

test('a failed sign-out stays on the page and explains how to retry', async ({page}) => {
  const calls = await prepare(page, 503);
  await page.getByRole('button', {name:'Sign out and use another account'}).click();
  await expect(page.getByRole('alert').filter({hasText: 'Could not sign out'})).toBeVisible();
  await expect(page).toHaveURL(/\/change-password$/);
  expect(calls()).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('cc_user'))).not.toBeNull();
});
