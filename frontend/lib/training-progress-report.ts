import type { CourseProgress } from './training-course';
import type { TrainingWorkflowResults } from './training-workflows';

export type LessonMetrics = { incorrectAnswers?: number; hintsViewed?: number; completedAt?: string; repeats?: number };
export type TrainingProgressReport = {
  schema: 'hidden-oasis-course-report-v1';
  source: 'isolated-training-device';
  exportedAt: string;
  trainee: { id: string; name: string; role: string };
  currentLesson: string;
  currentStage: string;
  completedLessons: string[];
  metrics: Record<string, LessonMetrics>;
  verifiedPractice: { kind: string; reference: string; completedAt: string; stages: number }[];
};
/** Reports contain no real guest records or credentials and are never
 * automatically accepted as a qualification or proof of actual work.
 */
export function buildTrainingReport(
  course: CourseProgress,
  trainee: { id?: string|number; name?: string; role?: string },
  workflows: TrainingWorkflowResults,
  exportedAt: string,
): TrainingProgressReport {
  const metric = course.metrics || {};
  const metrics: Record<string, LessonMetrics> = {};
  for (const id of course.passed) {
    const m = metric[id] || {};
    metrics[id] = {
      incorrectAnswers: Math.max(0, Math.floor(Number(m.incorrectAnswers) || 0)),
      hintsViewed: Math.max(0, Math.floor(Number(m.hintsViewed) || 0)),
      repeats: Math.max(0, Math.floor(Number(m.repeats) || 0)),
      ...(m.completedAt ? { completedAt: m.completedAt } : {}),
    };
  }
  const verifiedPractice = Object.entries(workflows || {}).flatMap(([kind, data]) =>
    data && typeof data.reference === 'string' && /^TRN-(GUEST|TASK|SHIFT|FIX|REQ|LINK)-[A-Z0-9]{8,20}$/.test(data.reference)
      ? [{kind, reference:data.reference, completedAt:data.completedAt, stages:data.steps?.length || 0}]
      : []);
  return {
    schema:'hidden-oasis-course-report-v1',source:'isolated-training-device',exportedAt,
    trainee:{id:String(trainee.id || ''),name:String(trainee.name || 'Fictional trainee').slice(0,100),
      role:String(trainee.role || 'staff').slice(0,30)},
    currentLesson:course.lessonId,currentStage:course.stage,
    completedLessons:[...new Set(course.passed)].slice(0,50),metrics,
    verifiedPractice,
  };
}
export function parseTrainingReport(input: unknown): TrainingProgressReport | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const obj = input as Record<string,unknown>;
  if (obj.schema !== 'hidden-oasis-course-report-v1' || obj.source !== 'isolated-training-device' ||
    typeof obj.exportedAt !== 'string' || !Array.isArray(obj.completedLessons) ||
    typeof obj.currentLesson !== 'string' || typeof obj.currentStage !== 'string') return null;
  const person = obj.trainee;
  if (!person || typeof person !== 'object' || Array.isArray(person)) return null;
  const p = person as Record<string,unknown>;
  if (!['id','name','role'].every(k=>typeof p[k]==='string') ||
    !p.id || String(p.id).length > 100 || String(p.name).length > 100 ||
    obj.completedLessons.length > 50 ||
    obj.completedLessons.some(id=>typeof id!=='string'||id.length>90) ||
    typeof obj.metrics!=='object'||!obj.metrics||Array.isArray(obj.metrics) ||
    !Array.isArray(obj.verifiedPractice) || obj.verifiedPractice.length > 50) return null;
  const metrics: Record<string, LessonMetrics>={};
  for (const [id,raw] of Object.entries(obj.metrics as Record<string,unknown>).slice(0,50)) {
    if (id.length>90 || !raw || typeof raw!=='object'||Array.isArray(raw)) continue;
    const m=raw as Record<string,unknown>;
    metrics[id]={
      incorrectAnswers: Math.max(0,Math.min(999,Number(m.incorrectAnswers)||0)),
      hintsViewed: Math.max(0,Math.min(999,Number(m.hintsViewed)||0)),
      repeats: Math.max(0,Math.min(999,Number(m.repeats)||0)),
      ...(typeof m.completedAt==='string'&&m.completedAt.length<40?{completedAt:m.completedAt}:{}),
    };
  }
  const verifiedPractice = obj.verifiedPractice.flatMap(raw => {
    if (!raw||typeof raw!=='object'||Array.isArray(raw)) return [];
    const v=raw as Record<string,unknown>;
    if (typeof v.kind!=='string'||v.kind.length>60||
      typeof v.reference!=='string'||!/^TRN-(GUEST|TASK|SHIFT|FIX|REQ|LINK)-[A-Z0-9]{8,20}$/.test(v.reference)||
      typeof v.completedAt!=='string'||v.completedAt.length>40) return [];
    return [{kind:v.kind,reference:v.reference,completedAt:v.completedAt,stages:Math.min(15,Math.max(0,Number(v.stages)||0))}];
  });
  return {schema:'hidden-oasis-course-report-v1',source:'isolated-training-device',
    exportedAt:obj.exportedAt.slice(0,40),trainee:{id:String(p.id),name:String(p.name),role:String(p.role).slice(0,30)},
    currentLesson:obj.currentLesson.slice(0,90),currentStage:obj.currentStage.slice(0,40),
    completedLessons:obj.completedLessons as string[],metrics,verifiedPractice};
}

/** Restore only read-only training navigation/decision lessons as local learning history.
 * Saved-record skills are NEVER restored across devices without the original
 * isolated training database and a new verified hands-on run.
 */
export function portableLearningCredit(report: TrainingProgressReport, available: readonly string[]): string[] {
  const recordEditing = new Set(['team-tasks','guest-matters','maintenance','requests','shift-writing']);
  const known = new Set(available);
  return report.completedLessons.filter(id => known.has(id) && !recordEditing.has(id));
}
