import { NextResponse } from 'next/server';
import { addMedicine, getMedicinesForParent, toggleMedicineStatus, linkMedicinesIntoSchedule, setMedicinePurpose, setMedicineEndsOn, cleanEndsOn, setMedicineTablets, cleanTabletCount, renameMedicine, setMedicineOfficialName } from '@/lib/db';
import { requireParentAccess } from '@/lib/access';
import { nameTaken, freeNickname, nameTakenMessage } from '@/lib/callInterpretation';
import { Medicine, MedicineTimingSlot, FoodRelation } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

const TIMING_SLOTS: MedicineTimingSlot[] = ['morning', 'afternoon', 'evening', 'bedtime', 'as_needed'];
const FOOD_RELATIONS: FoodRelation[] = ['before_food', 'after_food', 'with_food', 'not_specified'];
const TIMES_OF_DAY: Medicine['timeOfDay'][] = ['morning', 'afternoon', 'evening', 'bedtime'];
const FREQUENCIES: Medicine['frequency'][] = ['daily', 'twice_daily', 'as_needed'];

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;

  try {
    const { name, dosage, timeOfDay, timingSlots, foodRelation, frequency, purpose, endsOn, officialName } = await req.json();

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Medicine name is required' }, { status: 400 });
    }

    const tod: Medicine['timeOfDay'] = TIMES_OF_DAY.includes(timeOfDay) ? timeOfDay : 'morning';
    const slots: MedicineTimingSlot[] = Array.isArray(timingSlots)
      ? timingSlots.filter((s: MedicineTimingSlot) => TIMING_SLOTS.includes(s))
      : [];

    const active = (await getMedicinesForParent(id)).filter(m => m.isActive);
    if (nameTaken(name, active)) {
      const suggestion = freeNickname(name, slots.length > 0 ? slots : [tod], active.map(m => m.name));
      return NextResponse.json({ error: nameTakenMessage(name, suggestion), suggestion }, { status: 400 });
    }

    const newMed = await addMedicine(id, {
      name: name.trim().slice(0, 120),
      dosage: (dosage || '1 tablet').toString().slice(0, 120),
      timeOfDay: tod,
      timingSlots: slots.length > 0 ? slots : [tod],
      foodRelation: FOOD_RELATIONS.includes(foodRelation) ? foodRelation : 'not_specified',
      frequency: FREQUENCIES.includes(frequency) ? frequency : 'daily',
      isActive: true,
      purpose: typeof purpose === 'string' ? purpose : undefined,
      endsOn: typeof endsOn === 'string' ? endsOn : undefined,
      officialName: typeof officialName === 'string' ? officialName : undefined
    });

    // Make sure Saathi actually asks about the new medicine on the right call.
    const scheduleNotes = await linkMedicinesIntoSchedule(id, [newMed]);

    return NextResponse.json({ success: true, medicine: newMed, scheduleNotes });
  } catch (err) {
    console.error('Add medicine error:', err);
    return NextResponse.json({ error: 'Failed to add medicine' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;

  const { medicineId, action, purpose, endsOn, tabletsLeft, name, officialName } = await req.json();
  if (!medicineId || typeof medicineId !== 'string') {
    return NextResponse.json({ error: 'medicineId is required' }, { status: 400 });
  }

  // The family's own name for it ("BP tablet"); the call slots and questions follow, past calls keep the old name.
  if (action === 'rename') {
    const clean = typeof name === 'string' ? name.trim().slice(0, 120) : '';
    if (!clean) return NextResponse.json({ error: 'Medicine name is required' }, { status: 400 });
    const all = await getMedicinesForParent(id);
    const med = all.find(m => m.id === medicineId);
    if (!med) return NextResponse.json({ error: 'Medicine not found' }, { status: 404 });
    const others = all.filter(m => m.isActive && m.id !== med.id);
    if (nameTaken(clean, others)) {
      const suggestion = freeNickname(clean, med.timingSlots || [med.timeOfDay], others.map(m => m.name));
      return NextResponse.json({ error: nameTakenMessage(clean, suggestion), suggestion }, { status: 400 });
    }
    let renamed = await renameMedicine(id, medicineId, clean);
    if (!renamed) return NextResponse.json({ error: 'Medicine not found' }, { status: 404 });
    // The prescription's name can be filled in or corrected in the same form (null clears it).
    if (officialName !== undefined) {
      if (officialName !== null && typeof officialName !== 'string') {
        return NextResponse.json({ error: 'officialName must be text' }, { status: 400 });
      }
      renamed = (await setMedicineOfficialName(id, medicineId, officialName)) || renamed;
    }
    return NextResponse.json({ success: true, medicine: renamed });
  }

  // The family's own words for why it matters; Saathi repeats them and never invents a reason.
  if (action === 'purpose') {
    if (purpose !== null && typeof purpose !== 'string') {
      return NextResponse.json({ error: 'purpose must be text' }, { status: 400 });
    }
    const med = await setMedicinePurpose(id, medicineId, purpose);
    if (!med) return NextResponse.json({ error: 'Medicine not found' }, { status: 404 });
    return NextResponse.json({ success: true, medicine: med });
  }

  // Last day of a course (or null = no end). After it, reminders and calls leave the medicine out.
  if (action === 'ends_on') {
    const clean = endsOn === null || endsOn === '' ? null : cleanEndsOn(endsOn);
    if (endsOn && !clean) return NextResponse.json({ error: 'Please pick a valid date.' }, { status: 400 });
    const med = await setMedicineEndsOn(id, medicineId, clean);
    if (!med) return NextResponse.json({ error: 'Medicine not found' }, { status: 404 });
    return NextResponse.json({ success: true, medicine: med });
  }

  // How many tablets are left (Remind plan); null = stop counting.
  if (action === 'tablets_left') {
    const clean = tabletsLeft === null || tabletsLeft === '' ? null : cleanTabletCount(tabletsLeft);
    if (tabletsLeft !== null && tabletsLeft !== '' && clean === null) {
      return NextResponse.json({ error: 'Please enter a whole number from 0 to 999.' }, { status: 400 });
    }
    const med = await setMedicineTablets(id, medicineId, clean);
    if (!med) return NextResponse.json({ error: 'Medicine not found' }, { status: 404 });
    return NextResponse.json({ success: true, medicine: med });
  }

  // Switching a paused tablet back on: its nickname must still be free.
  const all = await getMedicinesForParent(id);
  const target = all.find(m => m.id === medicineId);
  if (target && !target.isActive) {
    const others = all.filter(m => m.isActive && m.id !== target.id);
    if (nameTaken(target.name, others)) {
      const suggestion = freeNickname(target.name, target.timingSlots || [target.timeOfDay], others.map(m => m.name));
      return NextResponse.json({ error: `${nameTakenMessage(target.name, suggestion)} Rename one of them first.`, suggestion }, { status: 400 });
    }
  }

  const updated = await toggleMedicineStatus(id, medicineId);
  if (!updated) {
    return NextResponse.json({ error: 'Medicine not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, medicine: updated });
}
