/** Only practice state is portable. Sign-in and account settings never travel. */
export const TRAINING_COPY_PREFIXES = ['ho-ops-structured-course-v2:','ho-ops-training-complete-v1:','ho-ops-verified-workflow-v1:','ho-ops-workflow-results-v1:','ho-ops-scenario-practice-v1:','ho-ops-scenario-drafts-v1:','ho-training-room-mission-v1:','ho-training-shift-mission-v1:','ho-independent-shift-v1:','ho-ops-task-inspection-v1:','ho-ops-handover-inspection-v1:','ho-ops-guest-inspection-v1:','ho-ops-fix-inspection-v1:','ho-ops-notification-read-v1:','ho-ops-local-trainer-reports-v1:','ho-ops-room-arrivals-practice-v1:evidence:','ho-ops-room-arrivals-practice-v1:','ho-ops-handbook-training-v1:'];
export type CopyStorage = Pick<Storage,'length'|'key'|'getItem'|'setItem'|'removeItem'>;
export function trainingCopyStorage(storage:CopyStorage, userId?:string):Record<string,string> {
  const output:Record<string,string>={};
  for(let index=0;index<storage.length;index++) {
    const key=storage.key(index);if(!key)continue;
    const prefix=TRAINING_COPY_PREFIXES.find(value=>key.startsWith(value));if(!prefix)continue;
    const suffix=key.slice(prefix.length);
    if(userId && suffix!==userId && !suffix.startsWith(userId+':'))continue;
    const value=storage.getItem(key);if(value!==null)output[key]=value;
  }
  return output;
}
export function restoreTrainingCopy(storage:CopyStorage,userId:string,profile:{profile_id:string;restore_id?:string;storage:Record<string,string>}) {
  const marker='ho-training-profile-v1:'+userId;
  const revision=profile.profile_id+':'+(profile.restore_id||'original');
  const previousMarker=storage.getItem(marker);
  if(previousMarker===revision)return;
  if(!profile.restore_id){storage.setItem(marker,revision);return;}
  const before=trainingCopyStorage(storage,userId);
  const restored=profile.storage;
  // A malformed response cannot replace another participant's local practice.
  for(const [key,value] of Object.entries(restored)) {
    const prefix=TRAINING_COPY_PREFIXES.find(item=>key.startsWith(item));
    const suffix=prefix?key.slice(prefix.length):'';
    if(!prefix || suffix!==userId && !suffix.startsWith(userId+':') || typeof value!=='string')throw new Error('Invalid training progress');
    const auxiliary=key.startsWith('ho-ops-scenario-practice-v1:') && (key.endsWith(':last') && /^[a-z0-9-]{1,100}$/.test(value) || key.endsWith(':guide-intro-v2') && value==='yes') || key.startsWith('ho-ops-handbook-training-v1:') && value==='completed';
    if(!auxiliary)JSON.parse(value);
  }
  // Keep the earlier browser state before changing any current keys. The native
  // initializer separately archives the complete previous training profile.
  const archive='ho-training-before-transfer-v1:'+userId+':'+revision;
  if(storage.getItem(archive)===null)storage.setItem(archive,JSON.stringify({marker:previousMarker,storage:before}));
  try {
    for(const key of Object.keys(before))storage.removeItem(key);
    for(const [key,value] of Object.entries(restored))storage.setItem(key,value);
    storage.setItem(marker,revision);
  } catch(error) {
    for(const key of Object.keys(restored))storage.removeItem(key);
    for(const [key,value] of Object.entries(before))storage.setItem(key,value);
    if(previousMarker===null)storage.removeItem(marker);else storage.setItem(marker,previousMarker);
    throw error;
  }
}
