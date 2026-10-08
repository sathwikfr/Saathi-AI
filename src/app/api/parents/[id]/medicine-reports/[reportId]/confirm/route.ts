import { NextResponse } from 'next/server';
import {
  confirmMedicineReport,
  getMedicineReportById,
  getMedicinesForParent,
  setMedicinesForParent,
  linkMedicinesIntoSchedule,
  deactivateMedicines,
  newId
} from '@/lib/db';
import { requireParentAccess } from '@/lib/access';
import { medicineKey } from '@/lib/callInterpretation';
import { Medicine, MedicineTimingSlot, FoodRelation } from '@/lib/types';

type Ctx = { params: Promise<{ id: string; reportId: string }> };

const TIMING_SLOTS: MedicineTimingSlot[] = ['morning', 'afternoon', 'evening', 'bedtime', 'as_needed'];
const FOOD_RELATIONS: FoodRelation[] = ['before_food', 'after_food', 'with_food', 'not_specified'];
const TIMES_OF_DAY: Medicine['timeOfDay'][] = ['morning', 'afternoon', 'evening', 'bedtime'];
const FREQUENCIES: Medicine['frequency'][] = ['daily', 'twice_daily', 'as_needed'];

/**
 * The user has reviewed the extracted draft and explicitly confirmed these
 * medicines. Only now are they saved to the parent's routine.
 *
 * New prescription vs the current list: medicines already on the list are not
 * added twice, and `stopMedicineIds` (ticked by the family in the "no longer on
 * this prescription" list) are paused, never deleted. Nothing changes without
 * the family's explicit choice.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id, reportId } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;

  try {
    const report = await getMedicineReportById(reportId);
    if (!report || report.userId !== access.user.id || (report.parentId && report.parentId !== id)) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    if (report.status === 'confirmed') {
      return NextResponse.json({ error: 'These medicines were already confirmed.' }, { status: 409 });
    }

    const { confirmedMedicines, stopMedicineIds } = await req.json();
    if (!Array.isArray(confirmedMedicines) || confirmedMedicines.length === 0) {
      return NextResponse.json({ error: 'Please confirm at least one medicine' }, { status: 400 });
    }

    const current = await getMedicinesForParent(id);
    const activeKeys = new Set(current.filter(m => m.isActive).map(m => medicineKey(m.name)));

    const candidates: Medicine[] = (confirmedMedicines as Partial<Medicine>[])
      .filter(m => m.name && m.name.trim())
      .map(m => {
        const timeOfDay = TIMES_OF_DAY.includes(m.timeOfDay as Medicine['timeOfDay']) ? m.timeOfDay! : 'morning';
        const slots = Array.isArray(m.timingSlots)
          ? m.timingSlots.filter((s): s is MedicineTimingSlot => TIMING_SLOTS.includes(s))
          : [];
        return {
          id: newId('med'),
          parentId: id,
          name: m.name!.trim().slice(0, 120),
          dosage: (m.dosage || '1 tablet daily').toString().slice(0, 120),
          timeOfDay,
          timingSlots: slots.length > 0 ? slots : [timeOfDay],
          foodRelation: FOOD_RELATIONS.includes(m.foodRelation as FoodRelation) ? m.foodRelation : 'not_specified',
          frequency: FREQUENCIES.includes(m.frequency as Medicine['frequency']) ? m.frequency! : 'daily',
          isActive: true,
          purpose: typeof m.purpose === 'string' ? m.purpose : undefined
        };
      });

    if (candidates.length === 0) {
      return NextResponse.json({ error: 'Please confirm at least one medicine with a name' }, { status: 400 });
    }
    const alreadyListed = candidates.filter(m => activeKeys.has(medicineKey(m.name)));
    const newMeds = candidates.filter(m => !activeKeys.has(medicineKey(m.name)));

    // Only this parent's own, currently active medicines can be stopped.
    const stopIds = Array.isArray(stopMedicineIds)
      ? current.filter(m => m.isActive && (stopMedicineIds as unknown[]).includes(m.id)).map(m => m.id)
      : [];
    const stopped = await deactivateMedicines(id, stopIds);

    const saved = newMeds.length ? await setMedicinesForParent(id, newMeds) : [];
    const scheduleNotes = saved.length ? await linkMedicinesIntoSchedule(id, saved) : [];
    await confirmMedicineReport(reportId, saved.map(m => m.id), { userId: access.user.id, parentId: id });

    const parts = [
      saved.length ? `${saved.length} new medicine${saved.length === 1 ? '' : 's'} added to ${access.parent.name}'s daily routine.` : null,
      alreadyListed.length ? `${alreadyListed.map(m => m.name).join(', ')} ${alreadyListed.length === 1 ? 'was' : 'were'} already on the list.` : null,
      stopped ? `${stopped} medicine${stopped === 1 ? '' : 's'} marked as stopped; Saathi won't ask about ${stopped === 1 ? 'it' : 'them'} any more.` : null
    ].filter(Boolean);

    return NextResponse.json({
      success: true,
      message: parts.join(' ') || 'Nothing changed.',
      medicines: saved,
      scheduleNotes
    });
  } catch (err) {
    console.error('Confirm report error:', err);
    return NextResponse.json({ error: 'Failed to confirm medicines' }, { status: 500 });
  }
}
