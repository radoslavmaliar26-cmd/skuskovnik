import { db } from '../db/db'

/** Po štarte appky: generovanie, ktoré bežalo pri zatvorení, sa nedá dokončiť – ponúkni „Skúsiť znova“. */
export async function recoverGenerations() {
  const ls = await db.lectures.where('status').equals('generating').toArray()
  for (const l of ls) {
    await db.lectures.update(l.id, {
      status: 'error',
      errorStep: 'generate',
      error: 'Vytváranie materiálu sa prerušilo (appka bola zatvorená alebo v pozadí). Ťukni na „Skúsiť znova“.',
    })
  }
}
