import { ScheduledCallSlot, MedicineTimingSlot, FoodRelation, LinkedMedicineDetail } from './types';

export const DEFAULT_SLOT_TIMES: Record<string, string> = {
  morning: '08:30 AM',
  afternoon: '01:00 PM',
  evening: '06:30 PM',
  bedtime: '09:00 PM',
  wellness: '09:30 AM'
};

export const SLOT_DISPLAY_NAMES: Record<string, string> = {
  morning: 'Morning Call',
  afternoon: 'Afternoon Call',
  evening: 'Evening Call',
  bedtime: 'Night / Bedtime Call',
  wellness: 'Daily Wellness Check-in',
  custom: 'Custom Check-in'
};

export const AVAILABLE_CALL_TIMES: string[] = [
  '06:00 AM', '06:15 AM', '06:30 AM', '06:45 AM',
  '07:00 AM', '07:15 AM', '07:30 AM', '07:45 AM',
  '08:00 AM', '08:15 AM', '08:30 AM', '08:45 AM',
  '09:00 AM', '09:15 AM', '09:30 AM', '09:45 AM',
  '10:00 AM', '10:15 AM', '10:30 AM', '10:45 AM',
  '11:00 AM', '11:15 AM', '11:30 AM', '11:45 AM',
  '12:00 PM', '12:15 PM', '12:30 PM', '12:45 PM',
  '01:00 PM', '01:15 PM', '01:30 PM', '01:45 PM',
  '02:00 PM', '02:15 PM', '02:30 PM', '02:45 PM',
  '03:00 PM', '03:15 PM', '03:30 PM', '03:45 PM',
  '04:00 PM', '04:15 PM', '04:30 PM', '04:45 PM',
  '05:00 PM', '05:15 PM', '05:30 PM', '05:45 PM',
  '06:00 PM', '06:15 PM', '06:30 PM', '06:45 PM',
  '07:00 PM', '07:15 PM', '07:30 PM', '07:45 PM',
  '08:00 PM', '08:15 PM', '08:30 PM', '08:45 PM',
  '09:00 PM', '09:15 PM', '09:30 PM', '09:45 PM',
  '10:00 PM', '10:15 PM', '10:30 PM'
];

/**
 * Parses "hh:mm AM/PM" into minutes from 00:00 for chronological comparisons
 */
export function timeToMinutes(timeStr: string): number {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/**
 * Returns available call times guaranteed to include currentTime if provided,
 * preventing HTML select dropdowns from falling back to the first option.
 */
export function getSelectableCallTimes(currentTime?: string): string[] {
  if (!currentTime) return AVAILABLE_CALL_TIMES;
  const trimmed = currentTime.trim();
  if (AVAILABLE_CALL_TIMES.includes(trimmed)) {
    return AVAILABLE_CALL_TIMES;
  }
  return [...AVAILABLE_CALL_TIMES, trimmed].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
}

export interface ScheduleGenerationResult {
  schedule: ScheduledCallSlot[];
  unspecifiedMedicines: Array<{ name: string; dosage?: string; index: number }>;
  asNeededMedicines: string[];
  distinctSlotsCount: number;
}

/**
 * Clean medicine brand name for natural, friendly voice call phrasing
 */
export function cleanMedicineNameForSpeech(rawName: string): string {
  return rawName
    .replace(/^(\d+[\.\)]|[-•*]|\bTab\.?|\bCap\.?|\bSyp\.?|\bInj\.?|\bOint\.?|\bGel\.?|\bCream\.?|\bT\.|\bTablet|\bCapsule|\bSyrup|\bOintment)\s*/i, '')
    .replace(/\s+x\s+\d+\s*(days|months|wks)/i, '')
    .trim();
}

/**
 * Generates an empathetic, precise check-in question for a specific medicine based on its food relation & session slot
 */
export function generateMedicineCheckinQuestion(
  rawName: string,
  foodRelation: FoodRelation = 'not_specified',
  slot: string = 'morning'
): string {
  const name = cleanMedicineNameForSpeech(rawName);
  const mealName = slot === 'morning' ? 'breakfast' : slot === 'afternoon' ? 'lunch' : 'dinner';

  switch (foodRelation) {
    case 'before_food':
      if (slot === 'bedtime') {
        return `Did you take your ${name} before dinner?`;
      }
      return `Did you take your ${name} before ${mealName}?`;

    case 'after_food':
      if (slot === 'bedtime') {
        return `Did you take your ${name} after dinner?`;
      }
      return `Did you have your ${name} after ${mealName}?`;

    case 'with_food':
      if (slot === 'bedtime') {
        return `Did you take your ${name} with dinner?`;
      }
      return `Did you take your ${name} with ${mealName}?`;

    case 'not_specified':
    default:
      if (slot === 'bedtime') {
        return `Did you take your ${name} before going to bed?`;
      }
      if (slot === 'as_needed') {
        return `Did you need to take or apply your ${name} today?`;
      }
      return `Did you take your ${name}?`;
  }
}

/**
 * Calculates optimal slot time based on the food relation distribution of medicines in that slot
 */
export function inferSlotTimeFromFoodRelation(
  slot: 'morning' | 'afternoon' | 'evening' | 'bedtime',
  foodRelations: FoodRelation[]
): string {
  const hasBefore = foodRelations.includes('before_food');
  const hasAfter = foodRelations.includes('after_food');
  const hasWith = foodRelations.includes('with_food');

  // If slot contains before_food (or mixed with before_food), time it early so parent is reminded before meal
  if (hasBefore && !hasAfter) {
    switch (slot) {
      case 'morning': return '08:15 AM'; // 30m before breakfast
      case 'afternoon': return '12:45 PM'; // Before lunch
      case 'evening': return '06:30 PM';
      case 'bedtime': return '08:45 PM';
    }
  }

  // If slot is exclusively after_food
  if (hasAfter && !hasBefore) {
    switch (slot) {
      case 'morning': return '08:45 AM'; // After 8:30 AM breakfast
      case 'afternoon': return '01:30 PM'; // After 1:00 PM lunch
      case 'evening': return '07:30 PM'; // After 7:00 PM dinner
      case 'bedtime': return '09:15 PM'; // After dinner / winding down
    }
  }

  // If slot is with_food
  if (hasWith && !hasBefore && !hasAfter) {
    switch (slot) {
      case 'morning': return '08:30 AM';
      case 'afternoon': return '01:00 PM';
      case 'evening': return '07:00 PM';
      case 'bedtime': return '09:00 PM';
    }
  }

  // Mixed or default: if before_food is present, prioritize before-meal reminder; otherwise use standard defaults
  if (hasBefore) {
    switch (slot) {
      case 'morning': return '08:15 AM';
      case 'afternoon': return '12:45 PM';
      case 'evening': return '06:30 PM';
      case 'bedtime': return '08:45 PM';
    }
  }

  return DEFAULT_SLOT_TIMES[slot] || '08:30 AM';
}

export interface MedicineScheduleInput {
  name: string;
  dosage?: string;
  timeOfDay?: string;
  timingSlots?: MedicineTimingSlot[];
  foodRelation?: FoodRelation;
}

/**
 * Generates an intelligent call roadmap derived directly from confirmed medicine timing slots and food relations
 */
export function generateProposedSchedule(
  medicines: MedicineScheduleInput[] = []
): ScheduleGenerationResult {
  const validMeds = medicines.filter(m => m.name && m.name.trim().length > 0);
  const unspecified: Array<{ name: string; dosage?: string; index: number }> = [];
  const asNeededMeds: string[] = [];

  // Group medicines by distinct slot with full metadata
  const slotGroups: Record<'morning' | 'afternoon' | 'evening' | 'bedtime', MedicineScheduleInput[]> = {
    morning: [],
    afternoon: [],
    evening: [],
    bedtime: []
  };

  validMeds.forEach((med, idx) => {
    const medName = med.name.trim();
    // Resolve slots
    let slots: MedicineTimingSlot[] = [];
    if (Array.isArray(med.timingSlots) && med.timingSlots.length > 0) {
      slots = med.timingSlots;
    } else if (med.timeOfDay) {
      const single = med.timeOfDay.toLowerCase();
      if (single === 'bedtime' || single === 'night') slots = ['bedtime'];
      else if (single === 'afternoon' || single === 'lunch') slots = ['afternoon'];
      else if (single === 'evening' || single === 'dinner') slots = ['evening'];
      else if (single === 'as_needed' || single === 'sos') slots = ['as_needed'];
      else if (single === 'unspecified') slots = ['unspecified'];
      else slots = ['morning'];
    } else {
      slots = ['unspecified'];
    }

    // Check for unspecified
    if (slots.includes('unspecified') || slots.length === 0) {
      unspecified.push({
        name: medName,
        dosage: med.dosage,
        index: idx
      });
      return;
    }

    // Check for as_needed
    if (slots.includes('as_needed') && slots.length === 1) {
      asNeededMeds.push(medName);
      return;
    }

    // Map each slot
    slots.forEach(slot => {
      if (slot === 'morning') slotGroups.morning.push(med);
      else if (slot === 'afternoon') slotGroups.afternoon.push(med);
      else if (slot === 'evening') slotGroups.evening.push(med);
      else if (slot === 'bedtime') slotGroups.bedtime.push(med);
      else if (slot === 'as_needed') asNeededMeds.push(medName);
    });
  });

  // If parent has zero medicines or only pure wellness
  if (validMeds.length === 0) {
    return {
      schedule: [
        {
          id: 'slot_wellness_1',
          time: DEFAULT_SLOT_TIMES.wellness,
          slot: 'wellness',
          label: 'Daily Wellness & Morning Conversation Check-in',
          linkedMedicineNames: [],
          linkedMedicines: [],
          isActive: true
        }
      ],
      unspecifiedMedicines: [],
      asNeededMedicines: [],
      distinctSlotsCount: 1
    };
  }

  const generatedSchedule: ScheduledCallSlot[] = [];
  const slotOrder: Array<'morning' | 'afternoon' | 'evening' | 'bedtime'> = ['morning', 'afternoon', 'evening', 'bedtime'];

  slotOrder.forEach(slot => {
    const rawMedsInSlot = slotGroups[slot];
    // Deduplicate by name within slot
    const uniqueMedsMap = new Map<string, MedicineScheduleInput>();
    rawMedsInSlot.forEach(m => {
      if (!uniqueMedsMap.has(m.name.trim())) {
        uniqueMedsMap.set(m.name.trim(), m);
      }
    });

    const uniqueMeds = Array.from(uniqueMedsMap.values());

    if (uniqueMeds.length > 0) {
      const foodRelations = uniqueMeds.map(m => m.foodRelation || 'not_specified');
      const slotTime = inferSlotTimeFromFoodRelation(slot, foodRelations);

      const medNames = uniqueMeds.map(m => m.name.trim());
      const medListPreview = medNames.slice(0, 3).join(', ') + (medNames.length > 3 ? ` +${medNames.length - 3} more` : '');

      const slotLabel = slot === 'morning'
        ? `Morning Medicine Reminder — ${medListPreview}`
        : slot === 'afternoon'
        ? `Afternoon Medicine Check — ${medListPreview}`
        : slot === 'evening'
        ? `Evening Medicine Reminder — ${medListPreview}`
        : `Night Medicine & Sleep Check — ${medListPreview}`;

      const linkedDetails: LinkedMedicineDetail[] = uniqueMeds.map(m => {
        const relation = m.foodRelation || 'not_specified';
        return {
          name: m.name.trim(),
          dosage: m.dosage,
          foodRelation: relation,
          questionScript: generateMedicineCheckinQuestion(m.name, relation, slot)
        };
      });

      generatedSchedule.push({
        id: `slot_${slot}_${Date.now()}`,
        time: slotTime,
        slot,
        label: slotLabel,
        linkedMedicineNames: medNames,
        linkedMedicines: linkedDetails,
        isActive: true
      });
    }
  });

  // If no meal slots were populated (e.g. only as_needed or all unspecified)
  if (generatedSchedule.length === 0) {
    const uniqueAsNeeded = Array.from(new Set(asNeededMeds));
    const linkedDetails: LinkedMedicineDetail[] = uniqueAsNeeded.map(name => ({
      name,
      foodRelation: 'not_specified',
      questionScript: generateMedicineCheckinQuestion(name, 'not_specified', 'as_needed')
    }));

    generatedSchedule.push({
      id: 'slot_wellness_as_needed',
      time: DEFAULT_SLOT_TIMES.wellness,
      slot: 'wellness',
      label: uniqueAsNeeded.length > 0
        ? `Daily Wellness & Symptoms Check-in (${uniqueAsNeeded.slice(0, 2).join(', ')})`
        : 'Daily Wellness & Check-in Call',
      linkedMedicineNames: uniqueAsNeeded,
      linkedMedicines: linkedDetails,
      isActive: true
    });
  }

  return {
    schedule: generatedSchedule,
    unspecifiedMedicines: unspecified,
    asNeededMedicines: Array.from(new Set(asNeededMeds)),
    distinctSlotsCount: generatedSchedule.length
  };
}

/**
 * Creates a human readable summary of the active schedule
 * e.g. "2 calls a day: 8:15 AM, 8:45 PM"
 */
/** "2 WhatsApp reminders a day: 08:00 AM, 09:00 PM" (Remind plan). */
export function formatReminderSummary(schedule: ScheduledCallSlot[]): string {
  const active = schedule.filter(s => s.isActive);
  if (active.length === 0) return 'No reminder times yet';
  const sortedTimes = [...active].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time)).map(s => s.time);
  return active.length === 1
    ? `1 WhatsApp reminder a day at ${sortedTimes[0]}`
    : `${active.length} WhatsApp reminders a day: ${sortedTimes.join(', ')}`;
}

export function formatScheduleSummary(schedule: ScheduledCallSlot[]): string {
  const active = schedule.filter(s => s.isActive);
  if (active.length === 0) return 'No calls scheduled';
  if (active.length === 1) return `1 call a day at ${active[0].time}`;
  const sortedTimes = [...active]
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))
    .map(s => s.time);
  return `${active.length} calls a day: ${sortedTimes.join(', ')}`;
}
