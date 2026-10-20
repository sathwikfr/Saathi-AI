/**
 * Saving a prescription the family has checked, against the parent's current list:
 * - the same medicine (same prescription name) already on the list is not added twice;
 * - a medicine marked as replacing one (`replacesId`) takes over its nickname, so the parent hears
 *   nothing new, and the old one is archived under its prescription name (never deleted);
 * - `stopIds` ticked in "not on this prescription" are paused;
 * - every active tablet keeps its own nickname (else nothing is saved and a free one is suggested).
 */
import { getMedicinesForParent, setMedicinesForParent, linkMedicinesIntoSchedule, deactivateMedicines, renameMedicine } from './db';
import { medicineKey, nameTaken, freeNickname, nameTakenMessage } from './callInterpretation';
import { Medicine } from './types';

export interface ConfirmRow {
  med: Medicine;
  replacesId?: string;
}

export type ConfirmOutcome =
  | { ok: false; error: string; suggestion: string }
  | { ok: true; saved: Medicine[]; scheduleNotes: string[]; alreadyListed: Medicine[]; replaced: { med: Medicine; old: Medicine }[]; stopped: number };

/** "Already on the list" means the same medicine, so prescription names are compared (a nickname can be anything). */
const officialKey = (m: { name: string; officialName?: string }) => medicineKey(m.officialName || m.name);

export async function applyConfirmedMedicines(parentId: string, rows: ConfirmRow[], stopIds: string[] = []): Promise<ConfirmOutcome> {
  const active = (await getMedicinesForParent(parentId)).filter(m => m.isActive);
  const activeKeys = new Set(active.map(officialKey));
  // Only this parent's own active medicines can be replaced.
  const withOld = rows.map(r => ({ med: { ...r.med }, old: r.replacesId ? active.find(a => a.id === r.replacesId) : undefined }));

  const alreadyListed = withOld.filter(r => !r.old && activeKeys.has(officialKey(r.med))).map(r => r.med);
  const adding = withOld.filter(r => r.old || !activeKeys.has(officialKey(r.med)));
  for (const r of adding) if (r.old) r.med.name = r.old.name;
  const oldIds = new Set(adding.flatMap(r => (r.old ? [r.old.id] : [])));

  const names = active.filter(m => !oldIds.has(m.id)).map(m => m.name);
  for (const { med } of adding) {
    if (nameTaken(med.name, names.map(n => ({ name: n })))) {
      const suggestion = freeNickname(med.name, med.timingSlots || [med.timeOfDay], names);
      return { ok: false, error: nameTakenMessage(med.name, suggestion), suggestion };
    }
    names.push(med.name);
  }

  // Archive the old one under its prescription name first, which frees its nickname for the new one.
  for (const r of adding) if (r.old) await renameMedicine(parentId, r.old.id, (r.old.officialName || `Old ${r.old.name}`).slice(0, 120));
  await deactivateMedicines(parentId, [...oldIds]);
  const stopped = await deactivateMedicines(parentId, active.filter(m => !oldIds.has(m.id) && stopIds.includes(m.id)).map(m => m.id));

  const saved = adding.length ? await setMedicinesForParent(parentId, adding.map(r => r.med)) : [];
  const scheduleNotes = saved.length ? await linkMedicinesIntoSchedule(parentId, saved) : [];
  const replaced = adding.flatMap(r => (r.old ? [{ med: saved.find(s => s.id === r.med.id) || r.med, old: r.old }] : []));
  return { ok: true, saved, scheduleNotes, alreadyListed, replaced, stopped };
}
