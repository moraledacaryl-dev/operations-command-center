import { expect } from '@playwright/test';
import { availableTrainingLessons } from '../lib/interactive-training';
import { courseGuideFor } from '../lib/training-course';
import { INDEPENDENT_CHECKS } from '../lib/training-independent';

export async function completeReadOnlyLesson(page: import('@playwright/test').Page, lesson: ReturnType<typeof availableTrainingLessons>[number], department = 'Front Desk') {
    const course = page.getByRole('dialog', { name: 'Required training lesson', exact: true });
    await expect(page.getByTestId('course-lesson-title')).toContainText(lesson.title);
    await page.getByTestId('course-start-quiz').click();
    for (const question of courseGuideFor(lesson.id, department, department === 'Front Desk')!.questions) {
      await course.getByRole('radio', { name: question.choices[question.correct], exact: true }).check();
      await page.getByTestId('course-check-answer').click();
    }
    if (lesson.id === 'staff-handover' && (await page.evaluate(() => JSON.parse(localStorage.getItem('cc_user') || '{}').role)) === 'staff') {
      const mission = page.getByTestId('department-shift-practice');
      await expect(mission).toContainText('Read a real-looking handover');
      await mission.getByRole('button', { name: 'Help me do it' }).click();
      await page.getByRole('tab', { name: 'Urgent', exact: true }).click();
      await expect(mission).toContainText('Open your department');
      await page.getByRole('button', { name: new RegExp(department + ' Night handover #3') }).click();
      await expect(mission).toContainText('Check the saved handover status');
      await page.getByRole('button', { name: 'Close details' }).click();
      await mission.getByLabel('What status is shown on this handover?').selectOption('Follow');
      await mission.getByRole('button', { name: 'Check my answer' }).click();
      await expect(mission).toContainText('Your turn: Find the PM handover');
      await page.getByRole('tab', { name: 'PM', exact: true }).click();
      await page.getByRole('button', { name: new RegExp(department + ' PM handover #2') }).click();
      await expect(mission).toContainText('Your turn: Read its status');
      await page.getByRole('button', { name: 'Close details' }).click();
      await mission.getByLabel('What status is shown on this handover?').selectOption('Seen');
      await mission.getByRole('button', { name: 'Check my answer' }).click();
    } else if (lesson.id === 'staff-rooms' && department === 'Front Desk' && (await page.evaluate(() => JSON.parse(localStorage.getItem('cc_user') || '{}').role)) === 'staff') {
      const mission = page.getByTestId('frontdesk-room-mission');
      await expect(mission).toContainText('Solace');
      await mission.getByRole('button', { name: 'Help me do it' }).click();
      await page.getByRole('button', { name: 'Guest rooms' }).click();
      await page.getByRole('textbox', { name: 'Search rooms and areas' }).fill('Solace');
      await page.getByRole('link', { name: 'Open Solace' }).click();
      await expect(mission).toContainText('Read the saved guest report');
      await expect(page.getByText('[TRAINING] Solace AC not cooling')).toBeVisible();
      await mission.getByLabel('What status is shown on the guest report?').selectOption('Follow');
      await mission.getByRole('button', { name: 'Check my answer' }).click();
      await expect(mission).toContainText('Your turn: Find Perch 1');
      await page.getByRole('textbox', { name: 'Search rooms and areas' }).fill('Perch 1');
      await page.getByRole('link', { name: 'Open Perch 1' }).click();
      await expect(page.getByText('[TRAINING] Perch 1 towel request')).toBeVisible();
      await mission.getByLabel('What status is shown on the guest report?').selectOption('Open');
      await mission.getByRole('button', { name: 'Check my answer' }).click();
    } else {
      const coach = page.locator('.ops-guide-tip');
      for (const [index, step] of lesson.steps.entries()) {
      await expect(coach.getByRole('heading')).toHaveText(step.title);
      if (step.advanceOnClick) {
        let target = page.locator(step.selector).filter({ visible: true });
        if (step.targetText) target = target.filter({ hasText: step.targetText });
        await target.first().click();
      }
      else await coach.getByRole('button', { name: index === lesson.steps.length - 1 ? 'Finish practice' : 'Next →', exact: true }).click();
      }
      if (lesson.id === 'room-arrivals' && department === 'Front Desk' && (await page.evaluate(() => JSON.parse(localStorage.getItem('cc_user') || '{}').role)) === 'staff') {
        const mission = page.getByTestId('room-arrival-practice');
        const pm = await page.evaluate(() => String(JSON.parse(localStorage.getItem('cc_user') || '{}').email).startsWith('reception-pm@'));
        for (const [index, room] of (pm ? ['Grandeur', 'Skyroom'] : ['Cafe Suite', 'Crown']).entries()) {
          await mission.getByRole('button', { name: index === 0 ? 'Start with a guide' : 'Try the next room', exact: true }).click();
          if (index === 0) await mission.getByRole('button', { name: 'Hide arrow', exact: true }).click();
          await page.getByRole('button', { name: 'Check saved work', exact: true }).click();
          await expect(page.getByText(/Your new check-in has not been found/)).toBeVisible();
          await page.getByLabel('Find room', { exact: true }).fill(room);
          const card = page.locator('.hk-room-card').filter({ has: page.getByRole('heading', { name: room, exact: true }) });
          page.once('dialog', dialog => dialog.accept());
          await card.getByRole('button', { name: 'Record check-in', exact: true }).click();
          await expect(card).toContainText('Checked in.');
          await page.getByRole('button', { name: 'Check saved work', exact: true }).click();
          await expect(mission.getByRole('heading')).toHaveText('Record checkout in ' + room);
          if (index === 0) await mission.getByRole('button', { name: 'Hide arrow', exact: true }).click();
          await page.getByRole('button', { name: 'Check saved work', exact: true }).click();
          await expect(page.getByText(/Your checkout has not been found/)).toBeVisible();
          page.once('dialog', dialog => dialog.accept());
          await card.getByRole('button', { name: 'Record checkout', exact: true }).click();
          await expect(card).toContainText('Last checkout recorded');
          await page.getByRole('button', { name: 'Check saved work', exact: true }).click();
        }
      } else for (const action of INDEPENDENT_CHECKS[lesson.id]) {
      if (lesson.id === 'maintenance-status' && action.title === 'Return to active repairs') {
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('button', { name: 'Close details', exact: true }).click();
      }
      await expect(page.getByTestId('course-independent-challenge')).toContainText(action.title);
      // The last tour click can navigate while the independent stage is opening.
      // Click only after its real target screen is active.
      await expect.poll(() => new URL(page.url()).pathname).toBe(action.path);
      let target = page.locator(action.selector).filter({ visible: true });
      if (action.containsText) target = target.filter({ hasText: action.containsText });
      if (action.type === 'input') await target.first().fill('repair');
      else await target.first().click();
      }
    }
    await expect(page.getByTestId('course-completed')).toBeVisible();
    await page.getByTestId('course-next-lesson').click();
}

