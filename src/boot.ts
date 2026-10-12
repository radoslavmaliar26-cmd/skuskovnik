import { installQueueTriggers, queue, resetStaleSegments } from './transcription/queue'
import { recoverGenerations } from './ai/jobs'

/** Spustenie práce na pozadí po otvorení appky (fronta prepisu, obnova nedokončených krokov). */
export function startBackgroundWork() {
  installQueueTriggers()
  void resetStaleSegments()
    .then(() => recoverGenerations())
    .catch((e) => console.error('Obnova po štarte zlyhala', e))
    .finally(() => queue.kick())
}
