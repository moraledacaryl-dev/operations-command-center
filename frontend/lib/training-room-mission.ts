/** First Front Desk practice: all names are real room labels, all guests and cases are fictional. */
export const ROOM_PRACTICE_EVENT = 'ho-training-room-action';
export const ROOM_PRACTICE_FINISHED = 'ho-training-room-mission-finished';
export const ROOM_MISSION_PREFIX = 'ho-training-room-mission-v1:';

export type RoomPracticeAction =
  | { kind: 'filter'; value: string }
  | { kind: 'search'; value: string }
  | { kind: 'open'; name: string; id: number };

export type RoomMissionStage = 'intro' | 'filter' | 'search' | 'open' | 'answer' |
  'solo-search' | 'solo-open' | 'solo-answer';

export type RoomMissionProgress = { stage: RoomMissionStage; solaceId?: number; perchId?: number };

export const FIRST_ROOM = { name: 'Solace', title: '[TRAINING] Solace AC not cooling' } as const;
export const SECOND_ROOM = { name: 'Perch 1', title: '[TRAINING] Perch 1 towel request' } as const;

export function readRoomMission(raw: string | null): RoomMissionProgress {
  if (!raw) return { stage: 'intro' };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { stage: 'intro' };
    const obj = value as Record<string, unknown>;
    const valid: RoomMissionStage[] = ['intro', 'filter', 'search', 'open', 'answer',
      'solo-search', 'solo-open', 'solo-answer'];
    if (!valid.includes(obj.stage as RoomMissionStage)) return { stage: 'intro' };
    const id = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0 ? Number(n) : undefined;
    return { stage: obj.stage as RoomMissionStage,
      ...(id(obj.solaceId) ? { solaceId: id(obj.solaceId) } : {}),
      ...(id(obj.perchId) ? { perchId: id(obj.perchId) } : {}) };
  } catch { return { stage: 'intro' }; }
}

export function findPracticeIssue(memory: unknown, roomName: string, issueTitle: string):
  { roomId: number; status: string } | null {
  if (!memory || typeof memory !== 'object') return null;
  const data = memory as Record<string, unknown>;
  const room = data.room as Record<string, unknown> | undefined;
  if (room?.name !== roomName || !Number.isSafeInteger(Number(room?.id))) return null;
  const guests = Array.isArray(data.guests) ? data.guests : [];
  const record = guests.find((x: unknown) => x && typeof x === 'object' &&
    (x as Record<string, unknown>).title === issueTitle) as Record<string, unknown> | undefined;
  if (!record || !['Open', 'Follow', 'Done'].includes(String(record.status))) return null;
  return { roomId: Number(room?.id), status: String(record.status) };
}

export function sendRoomPracticeAction(action: RoomPracticeAction) {
  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_TRAINING_MODE === 'true') {
    window.dispatchEvent(new CustomEvent<RoomPracticeAction>(ROOM_PRACTICE_EVENT, { detail: action }));
  }
}
