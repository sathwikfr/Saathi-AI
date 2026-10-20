import { NextResponse } from 'next/server';
import { confirmMedicineReport, getMedicineReportById, cleanEndsOn, newId } from '@/lib/db';
import { requireParentAccess } from '@/lib/access';
import { applyConfirmedMedicines, ConfirmRow } from '@/lib/prescriptionConfirm';
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
 * New prescription vs the current list: medicines already on the list (same
 * prescription name) are not added twice; a medicine the family marks as
 * replacing one (`replacesId`) takes over its nickname and the old one is
 * archived; `stopMedicineIds` (ticked in the "no longer on this prescription"
 * list) are paused. Nothing is deleted, nothing changes without the family's
 * explicit choice, and every active tablet keeps its own nickname.
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

    const rows: ConfirmRow[] = (confirmedMedicines as (Partial<Medicine> & { replacesId?: unknown })[])
      .filter(m => m.name && m.name.trim())
      .map(m => {
        const timeOfDay = TIMES_OF_DAY.includes(m.timeOfDay as Medicine['timeOfDay']) ? m.timeOfDay! : 'morning';
        const slots = Array.isArray(m.timingSlots)
          ? m.timingSlots.filter((s): s is MedicineTimingSlot => TIMING_SLOTS.includes(s))
          : [];
        return {
          med: {
            id: newId('med'),
            parentId: id,
            name: m.name!.trim().slice(0, 120),
            dosage: (m.dosage || '1 tablet daily').toString().slice(0, 120),
            timeOfDay,
            timingSlots: slots.length > 0 ? slots : [timeOfDay],
            foodRelation: FOOD_RELATIONS.includes(m.foodRelation as FoodRelation) ? m.foodRelation : 'not_specified',
            frequency: FREQUENCIES.includes(m.frequency as Medicine['frequency']) ? m.frequency! : 'daily',
            isActive: true,
            purpose: typeof m.purpose === 'string' ? m.purpose : undefined,
            endsOn: cleanEndsOn(m.endsOn) || undefined,
            officialName: typeof m.officialName === 'string' && m.officialName.trim() ? m.officialName.trim().slice(0, 120) : undefined
          },
          replacesId: typeof m.replacesId === 'string' ? m.replacesId : undefined
        };
      });

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Please confirm at least one medicine with a name' }, { status: 400 });
    }
    const stopIds = Array.isArray(stopMedicineIds) ? (stopMedicineIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const result = await applyConfirmedMedicines(id, rows, stopIds);
    if (!result.ok) return NextResponse.json({ error: result.error, suggestion: result.suggestion }, { status: 400 });
    const { saved, scheduleNotes, alreadyListed, replaced, stopped } = result;
    await confirmMedicineReport(reportId, saved.map(m => m.id), { userId: access.user.id, parentId: id });

    const added = saved.length - replaced.length;
    const parts = [
      added ? `${added} new medicine${added === 1 ? '' : 's'} added to ${access.parent.name}'s daily routine.` : null,
      ...replaced.map(r => `${r.med.name} is now ${r.med.officialName || 'the new medicine'}; ${r.old.officialName || r.old.name} was archived.`),
      alreadyListed.length ? `${alreadyListed.map(m => m.officialName || m.name).join(', ')} ${alreadyListed.length === 1 ? 'was' : 'were'} already on the list.` : null,
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
