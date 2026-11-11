'use client';

import { useEffect, useState } from 'react';
import { HandbookReader } from '@/components/HandbookReader';
import styles from './StaffHandbookTraining.module.css';

type Stage = 'learn' | 'quiz' | 'practice' | 'done';
type Question = { question: string; options: readonly [string, string, string]; answer: number; explanation: string };
const QUESTIONS: readonly Question[] = [
  {
    question: 'Where do you find the official employee handbook?',
    options: ['In Staff Guide, under Available guides or My Reading', 'In the payroll deductions screen', 'In a coworker’s account'],
    answer: 0,
    explanation: 'Staff Guide has the approved handbook. My Reading shows policies you must confirm.',
  },
  {
    question: 'You need to find the rule about being late. What do you do?',
    options: ['Scroll through random pages until you find it', 'Search for “lateness”, then open the result', 'Ask another employee for their password'],
    answer: 1,
    explanation: 'Use Search inside this handbook, then choose the matching result. The contents list is another way to jump directly to a section.',
  },
  {
    question: 'When should you press “I have read and understood” in the real handbook?',
    options: ['As soon as you see the title', 'Only after reading the official version and asking about anything unclear', 'Every time you open the training example'],
    answer: 1,
    explanation: 'The real confirmation records your acknowledgment of that published version. This practice does not count as a real acknowledgment.',
  },
];

/* Fictional practice text only. Company handbook wording stays in the private
   Staff Guide database and is never embedded in the public source repository. */
const DEMO_HANDBOOK = JSON.stringify({
  schema: 'hidden-oasis-handbook/v1',
  title: 'Practice Handbook — Demo Only',
  edition: 'Training copy',
  source_pages: 3,
  chapters: [
    { id: 'section-3', number: '3', title: 'Work Schedules, Attendance, and Timekeeping', page: 1, sections: [
      { id: 'section-3-3', number: '3.3', title: 'Timekeeping', page: 1, blocks: [
        { type: 'paragraph', text: 'Practice example: Use the contents list to find a topic. Official attendance rules are in the published handbook, not this training copy.' },
      ] },
      { id: 'section-3-4', number: '3.4', title: 'Lateness Policy', page: 1, blocks: [
        { type: 'paragraph', text: 'Practice example: You searched for lateness and opened this result. Read the full real policy in the official handbook before following it.' },
      ] },
    ] },
    { id: 'section-9', number: '9', title: 'Safety, Security, and Emergency Procedures', page: 2, sections: [
      { id: 'section-9-5', number: '9.5', title: 'Fire Safety', page: 2, blocks: [
        { type: 'paragraph', text: 'Practice example: You used the contents menu to jump to the Safety chapter. This is not the full safety procedure.' },
      ] },
    ] },
    { id: 'section-10', number: '10', title: 'Guest Interaction and Service Standards', page: 3, sections: [
      { id: 'section-10-3', number: '10.3', title: 'Guest Complaints and Service Recovery', page: 3, blocks: [
        { type: 'paragraph', text: 'Practice example: You can search for a guest service topic without turning PDF pages.' },
      ] },
    ] },
  ],
});

export function StaffHandbookTraining({ identity = 'guest', onClose }: { identity?: string | number; onClose?: () => void }) {
  const [stage, setStage] = useState<Stage>('learn');
  const [question, setQuestion] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [practiceStep, setPracticeStep] = useState(0);
  const [searchUsed, setSearchUsed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const progressKey = 'ho-ops-handbook-training-v1:' + String(identity);

  useEffect(() => {
    try {
      if (localStorage.getItem(progressKey) === 'completed') setStage('done');
    } catch { /* Browser storage is optional. */ }
    setLoaded(true);
  }, [progressKey]);

  function reset() {
    setQuestion(0);
    setAnswer(null);
    setFeedback('');
    setPracticeStep(0);
    setSearchUsed(false);
    setStage('learn');
  }

  function checkAnswer() {
    if (answer === null) return;
    const item = QUESTIONS[question];
    if (answer !== item.answer) {
      setFeedback('Not yet. ' + item.explanation + ' Select another answer.');
      setAnswer(null);
      return;
    }
    setFeedback('');
    setAnswer(null);
    if (question < QUESTIONS.length - 1) setQuestion(i => i + 1);
    else setStage('practice');
  }

  function handleNavigate(id: string, via: 'search' | 'contents') {
    if (stage !== 'practice') return;
    if (practiceStep === 0 && searchUsed && id === 'section-3-4' && via === 'search') {
      setPracticeStep(1);
    } else if (practiceStep === 1 && id === 'section-9' && via === 'contents') {
      setPracticeStep(2);
    }
  }

  function finishPractice() {
    if (stage !== 'practice' || practiceStep !== 2) return;
    setStage('done');
    try { localStorage.setItem(progressKey, 'completed'); } catch { /* Completion remains visible in this session. */ }
  }

  if (!loaded) return null;

  return <section className={styles.training} aria-label="How to use the staff handbook" data-testid="handbook-training">
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>HIDDEN OASIS · STAFF TRAINING</span>
        <h2>How to use the staff handbook</h2>
        <p>Learn where to find the handbook, how to find a rule, and when to confirm that you have read it.</p>
      </div>
      {onClose ? <button type="button" className={styles.close} onClick={onClose} aria-label="Close handbook practice">Close</button> : null}
    </header>
    <div className={styles.stages} aria-label="Training progress">
      <span className={stage === 'learn' ? styles.current : ''}>1. Learn</span>
      <span className={stage === 'quiz' ? styles.current : ''}>2. Answer</span>
      <span className={stage === 'practice' ? styles.current : ''}>3. Try it</span>
      <span className={stage === 'done' ? styles.current : ''}>4. Finished</span>
    </div>

    {stage === 'learn' ? <div className={styles.lesson}>
      <h3>Where do I open the real handbook?</h3>
      <ol>
        <li>Sign in to Hidden Oasis Operations with your own account.</li>
        <li>Open <strong>Staff Guide</strong>. Choose <strong>Available guides</strong> to browse approved documents, or <strong>My Reading</strong> to see those you need to confirm.</li>
        <li>Select the published <strong>Staff Handbook</strong>. If it is missing, ask your supervisor; it may not have been published yet.</li>
        <li>Use <strong>Contents</strong> to jump to a chapter, or <strong>Search inside this handbook</strong> to find a word. Choose a result to jump to that section.</li>
        <li>Read the full policy. If something is unclear, ask your supervisor. When you are done, select <strong>I have read and understood</strong> below the official handbook if confirmation is required.</li>
      </ol>
      <p className={styles.reminder}><strong>Important:</strong> This lesson uses a short practice copy. It does not show the complete official policies. The practice confirmation does not count as a real acknowledgment.</p>
      <button type="button" className={styles.primary} onClick={() => setStage('quiz')}>Next: Answer three questions</button>
    </div> : null}

    {stage === 'quiz' ? <div className={styles.lesson} data-testid="handbook-training-quiz">
      <p className={styles.stepLabel}>Question {question + 1} of {QUESTIONS.length}</p>
      <h3>{QUESTIONS[question].question}</h3>
      <fieldset className={styles.choices}>
        <legend className={styles.srOnly}>Choose one answer</legend>
        {QUESTIONS[question].options.map((option, i) => <label key={option} className={answer === i ? styles.chosen : ''}>
          <input type="radio" name="handbook-answer" checked={answer === i}
            onChange={() => { setAnswer(i); setFeedback(''); }} />{option}
        </label>)}
      </fieldset>
      {feedback ? <p role="alert" className={styles.feedback}>{feedback}</p> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={answer === null} onClick={checkAnswer}>Check my answer</button>
        <button type="button" className={styles.secondary} onClick={() => { setStage('learn'); setAnswer(null); setFeedback(''); }}>Read lesson again</button>
      </div>
    </div> : null}

    {stage === 'practice' ? <div className={styles.practice} data-testid="handbook-training-practice">
      <h3>Your turn — try the handbook controls</h3>
      <p>Use the practice handbook below. You must click and type yourself.</p>
      <div className={styles.instructions} role="status" data-testid="handbook-training-instruction">
        <strong>Step {practiceStep + 1} of 3</strong>
        {practiceStep === 0 ? <p>Type <strong>lateness</strong> in “Search inside this handbook”. Then click the result <strong>3.4 Lateness Policy</strong>.</p> :
          practiceStep === 1 ? <p>Now use the <strong>Contents</strong> menu on the left (or open Contents on a phone). Click <strong>9. Safety, Security, and Emergency Procedures</strong>.</p> :
          <p>Good. This is a practice copy, so select the <strong>practice confirmation</strong> below. In the real handbook, confirm only after reading the complete policy.</p>}
      </div>
      <HandbookReader body={DEMO_HANDBOOK} instance="training-handbook" 
        onSearch={value => { if (stage === 'practice' && practiceStep === 0) setSearchUsed(value.trim().toLowerCase().includes('lateness')); }}
        onNavigate={handleNavigate} />
      {practiceStep === 2 ? <div className={styles.confirm}>
        <p>You have tried Search and Contents. Confirm this <strong>practice copy only</strong> to finish the lesson.</p>
        <button type="button" className={styles.primary} data-testid="handbook-training-confirm" onClick={finishPractice}>I have read and understood (practice only)</button>
      </div> : null}
    </div> : null}

    {stage === 'done' ? <div className={styles.complete} data-testid="handbook-training-done" role="status">
      <h3>Handbook practice complete</h3>
      <p>You practised opening a topic using Search, jumping with Contents, and identifying the confirmation step.</p>
      <p><strong>Next in the real app:</strong> Close this training, open the published handbook under Staff Guide, read its actual policies, and confirm the published version when asked. Your practice result is not the real handbook acknowledgment.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={reset}>Repeat handbook lesson</button>
        {onClose ? <button type="button" className={styles.primary} onClick={onClose}>Back to Staff Guide</button> : null}
      </div>
    </div> : null}
  </section>;
}
