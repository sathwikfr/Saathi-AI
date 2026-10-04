'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { getEffectivePlan, getPlan } from '@/lib/plans';
import { PlanId, Medicine, EmergencyContact, MedicineTimingSlot, ExtractedMedicineCandidate, ScheduledCallSlot, FoodRelation } from '@/lib/types';
import {
  Heart,
  Pill,
  PhoneCall,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Plus,
  Trash2,
  Volume2,
  AlertCircle,
  Play,
  UserPlus,
  UploadCloud,
  FileText,
  Sparkles,
  AlertTriangle,
  Sun,
  Sunset,
  Moon,
  Coffee,
  Check,
  Camera,
  CalendarClock,
  ShieldAlert,
  MessageCircle,
  Download
} from 'lucide-react';
import { WizardShell, StepHeader, SlotPicker, FoodPicker, foodLabel } from '@/components/onboarding/WizardUI';
import { PhoneField } from '@/components/auth/AuthUI';
import { SAMPLE_PRESCRIPTIONS } from '@/lib/medicineExtractor';
import {
  generateProposedSchedule,
  formatScheduleSummary,
  DEFAULT_SLOT_TIMES,
  SLOT_DISPLAY_NAMES,
  getSelectableCallTimes
} from '@/lib/scheduleGenerator';
import { PARENT_LANGUAGES } from '@/lib/parentLanguages';
import { introScript, noticeLangFor, NOTICES } from '@/lib/parentNotices';

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const currentPlan = getEffectivePlan(user?.subscription, user?.createdAt);

  // Room on the plan for another parent, checked up front so nobody fills in every step only to be stopped at the end.
  const [parentLimit, setParentLimit] = useState<{
    canAddMore: boolean;
    expired: boolean;
    paymentRequired: boolean;
    allowedParents: number;
    currentCount: number;
    planName: string;
    upgradePlanId: PlanId | null;
  } | null | undefined>(undefined); // undefined = still checking, null = check failed (the server still enforces it)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/parents')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled) setParentLimit(data?.planLimits ?? null);
      })
      .catch(() => {
        if (!cancelled) setParentLimit(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Step state (1 to 6)
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorUpgradeHref, setErrorUpgradeHref] = useState<string | null>(null);

  // Step 1: Parent Info
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('Mother');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState('Hindi & English');
  const [timezone, setTimezone] = useState('Asia/Kolkata (IST)');

  // Step 2: Medicines State
  const [hasMedicines, setHasMedicines] = useState<boolean | null>(null);
  const [medicineEntryMode, setMedicineEntryMode] = useState<'choice' | 'upload' | 'manual'>('choice');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('Analyzing medical report...');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedReportId, setUploadedReportId] = useState<string | null>(null);
  const [extractedCandidates, setExtractedCandidates] = useState<ExtractedMedicineCandidate[]>([]);
  const [batchConfidence, setBatchConfidence] = useState<'high' | 'medium' | 'low'>('high');
  const [batchQualityWarning, setBatchQualityWarning] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);

  const [medicines, setMedicines] = useState<Array<{
    name: string;
    dosage: string;
    timeOfDay: Medicine['timeOfDay'];
    timingSlots?: MedicineTimingSlot[];
    foodRelation?: FoodRelation;
    frequency: Medicine['frequency'];
    purpose?: string;
  }>>([
    { name: '', dosage: '1 tablet after breakfast', timeOfDay: 'morning', timingSlots: ['morning'], foodRelation: 'after_food', frequency: 'daily' }
  ]);

  // Step 3: Call Schedule & Roadmap (Auto-generated from confirmed medicines)
  const [callTime, setCallTime] = useState('08:15 AM');
  const [callSchedule, setCallSchedule] = useState<ScheduledCallSlot[]>([]);
  const [unspecifiedMeds, setUnspecifiedMeds] = useState<Array<{ name: string; dosage?: string; index: number }>>([]);

  // Step 4: Emergency Contacts
  const [emergencyContacts, setEmergencyContacts] = useState<Array<{ name: string; relation: string; phone: string; priority: 'primary' | 'secondary'; isLocal?: boolean }>>([
    { name: user?.name || '', relation: 'Son / Primary Caregiver', phone: user?.phone || '', priority: 'primary', isLocal: false }
  ]);
  const [address, setAddress] = useState('');
  const [livesAlone, setLivesAlone] = useState(false);

  // Step 5: Consent
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  // Step 6: Confirmation & Test Call State
  const [createdParentId, setCreatedParentId] = useState<string>('');
  const [testCalling, setTestCalling] = useState(false);
  const [testCallResult, setTestCallResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saathiNumber, setSaathiNumber] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);

  // --------------------------------------------------------------------------
  // MEDICINE REPORT EXTRACTION HANDLERS
  // --------------------------------------------------------------------------
  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setUploadLoading(true);
    setExtractionError(null);
    setUploadedFileName(file.name);
    setUploadProgressText('Uploading document & reading prescription...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      setTimeout(() => setUploadProgressText('Running medical OCR & entity recognition...'), 700);
      setTimeout(() => setUploadProgressText('Matching candidate medications & dosages...'), 1400);

      const res = await fetch('/api/medicine-reports/extract', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        setExtractionError(data.error || 'Failed to extract medicines from the uploaded report.');
        return;
      }

      setUploadedReportId(data.reportId);
      setBatchConfidence(data.batchConfidence || 'high');
      setBatchQualityWarning(data.batchQualityWarning || null);
      setExtractedCandidates(
        data.extractedMedicines.map((m: ExtractedMedicineCandidate) => ({
          ...m,
          selected: m.selected !== undefined ? m.selected : (m.confidence !== 'low'),
          verifiedByUser: m.confidence === 'high'
        }))
      );
    } catch {
      setExtractionError('Network error while processing report. You can enter medicines manually.');
    } finally {
      setUploadLoading(false);
    }
  };

  const handleSampleExtract = async (sampleId: string) => {
    setUploadLoading(true);
    setExtractionError(null);
    const sample = SAMPLE_PRESCRIPTIONS.find(s => s.id === sampleId);
    setUploadedFileName(sample ? `${sample.title}.pdf` : 'Sample_Prescription.pdf');
    setUploadProgressText('Analyzing clinical record with medical vision...');

    try {
      setTimeout(() => setUploadProgressText('Extracting candidate medications, dosages & timings...'), 600);

      const res = await fetch('/api/medicine-reports/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ samplePreset: sampleId })
      });

      const data = await res.json();
      if (!res.ok) {
        setExtractionError(data.error || 'Failed to extract sample medicines.');
        return;
      }

      setUploadedReportId(data.reportId);
      setBatchConfidence(data.batchConfidence || 'high');
      setBatchQualityWarning(data.batchQualityWarning || null);
      setExtractedCandidates(
        data.extractedMedicines.map((m: ExtractedMedicineCandidate) => ({
          ...m,
          selected: m.selected !== undefined ? m.selected : (m.confidence !== 'low'),
          verifiedByUser: m.confidence === 'high'
        }))
      );
    } catch {
      setExtractionError('Network error while processing sample report.');
    } finally {
      setUploadLoading(false);
    }
  };

  const toggleCandidateSelection = (index: number) => {
    const updated = [...extractedCandidates];
    updated[index].selected = !updated[index].selected;
    updated[index].verifiedByUser = true;
    setExtractedCandidates(updated);
  };

  const updateCandidateField = (index: number, field: keyof ExtractedMedicineCandidate, value: string) => {
    const updated = [...extractedCandidates];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updated[index] as any)[field] = value;
    updated[index].verifiedByUser = true;
    updated[index].isEditedByUser = true;
    setExtractedCandidates(updated);
  };

  const toggleCandidateSlot = (index: number, slot: MedicineTimingSlot) => {
    const updated = [...extractedCandidates];
    const item = updated[index];
    const currentSlots: MedicineTimingSlot[] = item.timingSlots && item.timingSlots.length > 0
      ? [...item.timingSlots]
      : [item.timeOfDay || 'morning'];

    let newSlots: MedicineTimingSlot[];
    if (slot === 'as_needed') {
      newSlots = currentSlots.includes('as_needed') ? ['morning'] : ['as_needed'];
    } else {
      const withoutAsNeeded = currentSlots.filter((s): s is MedicineTimingSlot => s !== 'as_needed' && s !== 'unspecified');
      if (withoutAsNeeded.includes(slot)) {
        newSlots = withoutAsNeeded.filter(s => s !== slot);
        if (newSlots.length === 0) newSlots = ['morning'];
      } else {
        newSlots = [...withoutAsNeeded, slot];
      }
    }

    item.timingSlots = newSlots;
    item.timeOfDay = (newSlots.includes('morning') ? 'morning' : (newSlots[0] === 'as_needed' ? 'morning' : newSlots[0])) as Medicine['timeOfDay'];
    item.isEditedByUser = true;
    item.verifiedByUser = true;
    setExtractedCandidates(updated);
  };

  const addCandidateRow = () => {
    setExtractedCandidates([
      ...extractedCandidates,
      {
        id: `custom_${Date.now()}`,
        name: '',
        dosage: '1 tablet after food',
        timeOfDay: 'morning',
        timingSlots: ['morning'],
        foodRelation: 'after_food',
        frequency: 'daily',
        confidence: 'high',
        selected: true
      }
    ]);
  };

  const removeCandidateRow = (index: number) => {
    setExtractedCandidates(extractedCandidates.filter((_, i) => i !== index));
  };

  const handleConfirmExtraction = () => {
    const selected = extractedCandidates.filter(c => c.selected && c.name.trim());
    if (selected.length === 0) {
      setErrorMsg('Please select at least one medicine row to confirm, or switch to manual entry.');
      return;
    }

    // Convert to medicines state with multi-slot support and food relations
    setMedicines(
      selected.map(c => ({
        name: c.name.trim(),
        dosage: c.dosage.trim() || '1 tablet',
        timeOfDay: c.timeOfDay,
        timingSlots: c.timingSlots && c.timingSlots.length > 0 ? c.timingSlots : [c.timeOfDay || 'morning'],
        foodRelation: c.foodRelation || 'not_specified',
        frequency: c.frequency || 'daily'
      }))
    );

    // Proceed to Step 3
    setStep(3);
  };

  // Add / remove manual medicine rows
  const addMedicineRow = () => {
    setMedicines([
      ...medicines,
      { name: '', dosage: '1 tablet', timeOfDay: 'morning', timingSlots: ['morning'], foodRelation: 'after_food', frequency: 'daily' }
    ]);
  };

  const removeMedicineRow = (index: number) => {
    setMedicines(medicines.filter((_, i) => i !== index));
  };

  const updateMedicineField = (index: number, field: string, value: string) => {
    const updated = [...medicines];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updated[index] as any)[field] = value;
    setMedicines(updated);
  };

  const updateManualMedicineFoodRelation = (index: number, relation: FoodRelation) => {
    const updated = [...medicines];
    updated[index].foodRelation = relation;
    setMedicines(updated);
  };

  const toggleManualMedicineSlot = (index: number, slot: MedicineTimingSlot) => {
    const updated = [...medicines];
    const item = updated[index];
    const currentSlots: MedicineTimingSlot[] = item.timingSlots && item.timingSlots.length > 0
      ? [...item.timingSlots]
      : [item.timeOfDay || 'morning'];

    let newSlots: MedicineTimingSlot[];
    if (slot === 'as_needed') {
      newSlots = currentSlots.includes('as_needed') ? ['morning'] : ['as_needed'];
    } else {
      const withoutAsNeeded = currentSlots.filter((s): s is MedicineTimingSlot => s !== 'as_needed' && s !== 'unspecified');
      if (withoutAsNeeded.includes(slot)) {
        newSlots = withoutAsNeeded.filter(s => s !== slot);
        if (newSlots.length === 0) newSlots = ['morning'];
      } else {
        newSlots = [...withoutAsNeeded, slot];
      }
    }

    item.timingSlots = newSlots;
    item.timeOfDay = (newSlots.includes('morning') ? 'morning' : (newSlots[0] === 'as_needed' ? 'morning' : newSlots[0])) as Medicine['timeOfDay'];
    setMedicines(updated);
  };

  // Auto-generate call schedule roadmap upon entering Step 3
  useEffect(() => {
    if (step === 3) {
      const activeMeds = hasMedicines ? medicines.filter(m => m.name.trim() !== '') : [];
      const res = generateProposedSchedule(activeMeds);
      setCallSchedule(res.schedule);
      setUnspecifiedMeds(res.unspecifiedMedicines);
      if (res.schedule.length > 0) {
        setCallTime(res.schedule[0].time);
      }
    }
  }, [step, medicines, hasMedicines]);

  // Call schedule slot handlers
  const updateCallSlotTime = (index: number, newTime: string) => {
    const updated = [...callSchedule];
    updated[index].time = newTime;
    setCallSchedule(updated);
    if (index === 0) setCallTime(newTime);
  };

  const updateCallSlotLabel = (index: number, newLabel: string) => {
    const updated = [...callSchedule];
    updated[index].label = newLabel;
    setCallSchedule(updated);
  };

  const removeCallSlot = (index: number) => {
    const updated = callSchedule.filter((_, i) => i !== index);
    setCallSchedule(updated);
  };

  const CANDIDATE_CHECKIN_TIMES = [
    { time: '10:30 AM', label: 'Mid-Morning Wellness Check-in' },
    { time: '04:30 PM', label: 'Afternoon Tea & Wellbeing Check-in' },
    { time: '05:30 PM', label: 'Evening Walk & Hydration Check-in' },
    { time: '07:30 PM', label: 'Pre-Dinner Conversation & Mood Check' },
    { time: '02:00 PM', label: 'Post-Lunch Rest & Health Check' },
    { time: '11:30 AM', label: 'Late-Morning Check-in' }
  ];

  const addCustomCallSlot = () => {
    const existingTimes = new Set(callSchedule.map(s => s.time));
    const candidate = CANDIDATE_CHECKIN_TIMES.find(c => !existingTimes.has(c.time));

    let newTime = '04:30 PM';
    let newLabel = 'Custom Check-in Call';

    if (candidate) {
      newTime = candidate.time;
      newLabel = candidate.label;
    } else {
      const customCount = callSchedule.filter(s => s.slot === 'custom').length + 1;
      newTime = '03:30 PM';
      newLabel = `Additional Care Check-in #${customCount}`;
    }

    const newSlot: ScheduledCallSlot = {
      id: `slot_custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      time: newTime,
      slot: 'custom',
      label: newLabel,
      linkedMedicineNames: [],
      isActive: true
    };
    setCallSchedule(prev => [...prev, newSlot]);
  };

  const resolveUnspecifiedMed = (medIndex: number, newSlot: MedicineTimingSlot) => {
    const updatedMeds = [...medicines];
    if (updatedMeds[medIndex]) {
      updatedMeds[medIndex].timingSlots = [newSlot];
      updatedMeds[medIndex].timeOfDay = (newSlot === 'as_needed' || newSlot === 'unspecified') ? 'morning' : (newSlot as any);
      setMedicines(updatedMeds);
      const res = generateProposedSchedule(updatedMeds);
      setCallSchedule(res.schedule);
      setUnspecifiedMeds(res.unspecifiedMedicines);
    }
  };

  // Add emergency contact row
  const addContactRow = () => {
    setEmergencyContacts([
      ...emergencyContacts,
      { name: '', relation: 'Neighbour', phone: '', priority: 'secondary', isLocal: true }
    ]);
  };

  const removeContactRow = (index: number) => {
    if (emergencyContacts.length <= 1) return;
    setEmergencyContacts(emergencyContacts.filter((_, i) => i !== index));
  };

  // Navigation handlers
  const handleNextStep = () => {
    setErrorMsg('');
    if (step === 1) {
      if (!name.trim()) {
        setErrorMsg('Please enter parent name');
        return;
      }
      if (!phone || phone.replace(/\D/g, '').length < 10) {
        setErrorMsg('Please enter a valid 10-digit mobile or landline number');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      if (unspecifiedMeds.length > 0) {
        setErrorMsg('Please assign a timing slot for all medicines before proceeding.');
        return;
      }
      if (callSchedule.filter(s => s.isActive).length === 0) {
        setErrorMsg('Please configure at least one call time for your parent.');
        return;
      }
      setStep(4);
    } else if (step === 4) {
      if (!emergencyContacts[0]?.name || !emergencyContacts[0]?.phone) {
        setErrorMsg('At least one primary emergency contact is required');
        return;
      }
      if (livesAlone && !emergencyContacts.some(c => c.isLocal && c.name.trim() && c.phone.trim())) {
        setErrorMsg(`Since ${name} lives alone, please add someone who lives nearby and can go and check on them.`);
        return;
      }
      setStep(5);
    }
  };

  // Final Submit Handler
  const handleFinalSubmit = async () => {
    if (!consentConfirmed) {
      setErrorMsg('Parent awareness and consent is mandatory to initiate calls');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');
    setErrorUpgradeHref(null);

    try {
      const validMeds = hasMedicines ? medicines.filter(m => m.name.trim() !== '') : [];
      const activeSchedule = callSchedule.filter(s => s.isActive);

      const res = await fetch('/api/parents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          relationship,
          phone,
          language,
          timezone,
          callTime: activeSchedule[0]?.time || callTime,
          callSchedule: activeSchedule,
          consentGiven: true,
          medicines: validMeds,
          emergencyContacts,
          details: { address: address.trim() || null, livesAlone }
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to create parent profile');
        if (data.code === 'PARENT_LIMIT' || data.code === 'PAYMENT_REQUIRED') {
          setErrorUpgradeHref(`/checkout/confirm?plan=${data.upgradePlanId || 'family'}`);
        }
        setSubmitting(false);
        return;
      }

      setCreatedParentId(data.parent.id);
      setStep(6);
      // Saathi's fixed calling number, for the contact card on the last step.
      fetch(`/api/parents/${data.parent.id}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => setSaathiNumber(d?.saathiNumber || null))
        .catch(() => undefined);
    } catch {
      setErrorMsg('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Request a real 1-time test call (reports honestly if calling isn't live yet)
  const triggerTestCall = async () => {
    if (!createdParentId) return;
    setTestCalling(true);
    try {
      const res = await fetch(`/api/parents/${createdParentId}/test-call`, { method: 'POST' });
      const data = await res.json();
      setTestCallResult({ ok: res.ok, message: data.message || data.error || 'Test call unavailable right now.' });
    } catch {
      setTestCallResult({ ok: false, message: 'Could not reach the server to place a test call.' });
    } finally {
      setTestCalling(false);
    }
  };

  const selectedCandidateCount = extractedCandidates.filter(c => c.selected && c.name.trim().length >= 3).length;
  const showSamples = process.env.NODE_ENV === 'development';

  const slotIcon = (slot: ScheduledCallSlot['slot']) => {
    if (slot === 'morning') return <Sun size={19} />;
    if (slot === 'afternoon') return <Coffee size={19} />;
    if (slot === 'evening') return <Sunset size={19} />;
    if (slot === 'bedtime') return <Moon size={19} />;
    return <Heart size={19} />;
  };

  if (parentLimit === undefined) {
    return (
      <WizardShell step={1}>
        <div className="skeleton" style={{ height: '320px', borderRadius: 'var(--r-xl)' }} aria-label="Loading" />
      </WizardShell>
    );
  }

  if (parentLimit && !parentLimit.canAddMore && step < 6) {
    const upgradePlan = parentLimit.upgradePlanId ? getPlan(parentLimit.upgradePlanId) : null;
    // No plan yet: payment details come first, even though the first 7 days are free.
    const paymentFirst = parentLimit.paymentRequired && !parentLimit.expired;
    const trialDays = upgradePlan?.trialDays || 7;
    return (
      <WizardShell step={1}>
        <div className="animate-fade-in">
          <StepHeader
            eyebrow="Add a parent"
            title={
              parentLimit.expired
                ? 'Your free trial has ended'
                : paymentFirst
                  ? `Start your ${trialDays}-day free trial first`
                  : `Your ${parentLimit.planName} plan is full`
            }
          >
            {parentLimit.expired
              ? 'Choose a plan to add a parent and restart the daily check-in calls.'
              : paymentFirst
                ? `Pick a plan and set up AutoPay with Razorpay. Nothing is charged for ${trialDays} days (Razorpay checks your card or bank with about ₹5 and refunds it), and you can cancel any time before then. Once AutoPay is set up you can add your parent here.`
                : `It includes ${parentLimit.allowedParents} parent${parentLimit.allowedParents === 1 ? '' : 's'} and you've added ${parentLimit.currentCount}. ` +
                  (upgradePlan
                    ? `${upgradePlan.name} covers up to ${upgradePlan.parentsIncluded}. Once your payment is confirmed you can add another parent here.`
                    : 'To add someone new, archive a parent from the dashboard first.')}
          </StepHeader>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {upgradePlan && (
              <Link href={`/checkout/confirm?plan=${upgradePlan.id}`} className="btn btn-primary btn-lg">
                {parentLimit.expired || paymentFirst ? 'Choose a plan' : `Upgrade to ${upgradePlan.name}`} <ArrowRight size={18} className="arrow" />
              </Link>
            )}
            <Link href="/dashboard" className="btn btn-ghost">Back to dashboard</Link>
          </div>
        </div>
      </WizardShell>
    );
  }

  return (
    <WizardShell step={step}>
      {errorMsg && (
        <div className="alert-box error" role="alert">
          <AlertCircle size={18} />
          <span>
            {errorMsg}
            {errorUpgradeHref && (
              <>
                {' '}
                <Link href={errorUpgradeHref} className="link">See plans</Link>
              </>
            )}
          </span>
        </div>
      )}

      {/* STEP 1: PARENT INFO */}
      {step === 1 && (
        <div className="animate-fade-in">
          <StepHeader eyebrow="Step 1 · About your parent" title="Who should Saathi call?">
            Saathi will greet them by name and speak in the language they&apos;re most comfortable with.
          </StepHeader>

          <div className="form-group">
            <label className="form-label" htmlFor="parent-name">What should Saathi call them?</label>
            <input
              id="parent-name"
              type="text"
              placeholder="e.g. Amma, Appa, Dadi, Lakshmi Aunty"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-input"
              autoFocus
              required
            />
            <span className="form-hint">This is how they&apos;ll be greeted on every call.</span>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="relationship">They are your…</label>
              <select id="relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)} className="form-input">
                <option value="Mother">Mother</option>
                <option value="Father">Father</option>
                <option value="Mother-in-law">Mother-in-law</option>
                <option value="Father-in-law">Father-in-law</option>
                <option value="Grandmother">Grandmother</option>
                <option value="Grandfather">Grandfather</option>
                <option value="Aunt / Uncle">Aunt / Uncle</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="language">Call language</label>
              <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)} className="form-input">
                {PARENT_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="parent-phone">Their phone number</label>
            <PhoneField id="parent-phone" value={phone} onChange={setPhone} indiaOnly />
            <span className="form-hint">A mobile or a landline. No smartphone needed.</span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="timezone">Where do they live?</label>
            <select id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="form-input">
              <option value="Asia/Kolkata (IST)">India (IST)</option>
              <option value="America/New_York (EST)">US Eastern (EST)</option>
              <option value="America/Los_Angeles (PST)">US Pacific (PST)</option>
              <option value="Europe/London (GMT)">UK (GMT / BST)</option>
              <option value="Asia/Dubai (GST)">UAE (GST)</option>
              <option value="Asia/Singapore (SGT)">Singapore (SGT)</option>
            </select>
            <span className="form-hint">Calls follow their local clock, wherever you are.</span>
          </div>

          <div className="wizard-nav">
            <button onClick={handleNextStep} className="btn btn-primary btn-lg">
              Continue <ArrowRight size={18} className="arrow" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: MEDICINES */}
      {step === 2 && (
        <div className="animate-fade-in">
          <StepHeader eyebrow="Step 2 · Medicines" title={<>Does {name || 'your parent'} take daily medicines?</>}>
            Saathi will gently ask about each one at the right time of day.
          </StepHeader>

          {/* YES / NO */}
          {hasMedicines === null && (
            <div className="choice-grid">
              <button
                type="button"
                className="choice-card recommended"
                onClick={() => {
                  setHasMedicines(true);
                  setMedicineEntryMode('choice');
                }}
              >
                <span className="icon-tile"><Pill size={22} /></span>
                <strong>Yes, add their medicines</strong>
                <p>BP, diabetes, thyroid, vitamins and so on.</p>
                <span className="choice-cta">Add medicines <ArrowRight size={15} /></span>
              </button>

              <button
                type="button"
                className="choice-card"
                onClick={() => {
                  setHasMedicines(false);
                  setStep(3);
                }}
              >
                <span className="icon-tile gold"><Heart size={22} /></span>
                <strong>No medicines right now</strong>
                <p>Just a daily call to check in on how they&apos;re feeling.</p>
                <span className="choice-cta" style={{ color: 'var(--ink-muted)' }}>Skip for now <ArrowRight size={15} /></span>
              </button>
            </div>
          )}

          {/* UPLOAD VS MANUAL */}
          {hasMedicines === true && medicineEntryMode === 'choice' && (
            <>
              <div className="choice-grid">
                <button type="button" className="choice-card recommended" onClick={() => setMedicineEntryMode('upload')}>
                  <span className="badge badge-gold choice-flag"><Sparkles size={12} /> Fastest</span>
                  <span className="icon-tile"><Camera size={22} /></span>
                  <strong>Snap the prescription</strong>
                  <p>Upload a photo of a prescription, discharge summary or pharmacy bill. We draft the list and you check it.</p>
                  <span className="choice-cta">Upload a photo <ArrowRight size={15} /></span>
                </button>

                <button type="button" className="choice-card" onClick={() => setMedicineEntryMode('manual')}>
                  <span className="icon-tile gold"><Pill size={22} /></span>
                  <strong>Type them in</strong>
                  <p>Add each medicine&apos;s name, dose and when it&apos;s taken.</p>
                  <span className="choice-cta" style={{ color: 'var(--ink)' }}>Enter manually <ArrowRight size={15} /></span>
                </button>
              </div>

              <div className="wizard-nav">
                <button type="button" className="btn btn-ghost" onClick={() => setHasMedicines(null)}>
                  <ArrowLeft size={16} /> Back
                </button>
              </div>
            </>
          )}

          {/* UPLOAD + DRAFT REVIEW */}
          {hasMedicines === true && medicineEntryMode === 'upload' && (
            <div>
              {uploadLoading && (
                <div className="dropzone" style={{ borderStyle: 'solid', borderColor: 'var(--teal)', background: 'var(--teal-light)' }} role="status">
                  <span className="icon-tile" style={{ width: '56px', height: '56px', borderRadius: '50%', margin: '0 auto 16px', background: 'var(--panel-elevated)' }}>
                    <span className="spinner" style={{ width: '24px', height: '24px' }} />
                  </span>
                  <div style={{ fontWeight: 600, fontSize: '1.05rem', marginBottom: '4px' }}>Reading the prescription…</div>
                  <p style={{ fontSize: '0.88rem', color: 'var(--ink-muted)' }}>{uploadProgressText}</p>
                </div>
              )}

              {!uploadLoading && extractedCandidates.length === 0 && (
                <div>
                  <div className="dropzone" style={{ marginBottom: '16px' }}>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,text/plain"
                      aria-label="Upload a prescription photo"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                      }}
                    />
                    <span className="icon-tile" style={{ width: '56px', height: '56px', borderRadius: '50%', margin: '0 auto 14px', background: 'var(--panel-elevated)', boxShadow: 'var(--shadow-sm)' }}>
                      <UploadCloud size={26} />
                    </span>
                    <div style={{ fontWeight: 600, fontSize: '1.02rem', marginBottom: '4px' }}>
                      Drop a photo here, or <span style={{ color: 'var(--teal)' }}>browse</span>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
                      JPG, PNG or WebP, up to 8 MB. Make sure the writing is clear and in focus.
                    </p>
                  </div>

                  {extractionError && (
                    <div className="alert-box error" role="alert">
                      <AlertCircle size={18} />
                      <div style={{ flex: 1 }}>
                        <div>{extractionError}</div>
                        <button type="button" onClick={() => setMedicineEntryMode('manual')} className="btn btn-ghost btn-sm" style={{ marginTop: '10px' }}>
                          Type them in instead
                        </button>
                      </div>
                    </div>
                  )}

                  {showSamples && (
                    <div className="card-flat" style={{ marginBottom: '16px', background: 'var(--paper)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '0.84rem', fontWeight: 600 }}>
                        <FileText size={16} color="var(--teal)" /> Sample prescriptions
                        <span className="badge badge-neutral">Dev only</span>
                      </div>
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {SAMPLE_PRESCRIPTIONS.map((sample) => (
                          <button
                            key={sample.id}
                            type="button"
                            onClick={() => handleSampleExtract(sample.id)}
                            className="choice-card"
                            style={{ padding: '12px 14px', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                          >
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{sample.title}</div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>{sample.subtitle}</div>
                            </div>
                            <ArrowRight size={16} color="var(--teal)" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="wizard-nav">
                    <button type="button" onClick={() => setMedicineEntryMode('choice')} className="btn btn-ghost">
                      <ArrowLeft size={16} /> Back
                    </button>
                    <button type="button" onClick={() => setMedicineEntryMode('manual')} className="btn btn-quiet">
                      Type them in instead
                    </button>
                  </div>
                </div>
              )}

              {!uploadLoading && extractedCandidates.length > 0 && (
                <div>
                  <div className="notice teal" style={{ alignItems: 'center' }}>
                    <Sparkles size={20} />
                    <div style={{ flex: 1 }}>
                      <strong>We found {extractedCandidates.length} medicine{extractedCandidates.length === 1 ? '' : 's'}{uploadedFileName ? ` in ${uploadedFileName}` : ''}</strong>
                      <span style={{ fontSize: '0.84rem' }}>This is a draft. Check each one carefully; nothing is saved until you confirm.</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setExtractedCandidates([]);
                        setUploadedFileName(null);
                        setBatchQualityWarning(null);
                      }}
                    >
                      Upload another
                    </button>
                  </div>

                  {batchQualityWarning && (
                    <div className="notice amber">
                      <AlertTriangle size={18} />
                      <div><strong>Please double-check</strong>{batchQualityWarning}</div>
                    </div>
                  )}

                  <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
                    {extractedCandidates.map((candidate, idx) => {
                      const isLowConf = candidate.confidence === 'low';
                      return (
                        <div
                          key={candidate.id || idx}
                          className={`row-card${!candidate.selected ? ' muted' : isLowConf ? ' flagged' : ''}`}
                        >
                          <div className="row-card-head">
                            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none', minWidth: 0 }}>
                              <input
                                type="checkbox"
                                checked={candidate.selected}
                                onChange={() => toggleCandidateSelection(idx)}
                                style={{ width: '18px', height: '18px', accentColor: 'var(--teal)', cursor: 'pointer', flexShrink: 0 }}
                              />
                              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                                {candidate.selected ? 'Include' : 'Skipped'}
                              </span>
                            </label>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              {candidate.category && <span className="badge badge-neutral">{candidate.category}</span>}
                              {isLowConf ? (
                                <span className="badge badge-amber"><AlertTriangle size={12} /> Please check</span>
                              ) : (
                                <span className="badge badge-teal"><Check size={12} /> Clear read</span>
                              )}
                              <button type="button" onClick={() => removeCandidateRow(idx)} className="icon-btn danger" aria-label="Remove medicine">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>

                          {candidate.flagReason && (
                            <div className="alert-box warning" style={{ padding: '8px 12px', fontSize: '0.8rem', marginBottom: '12px' }}>
                              <AlertTriangle size={14} />
                              <span>{candidate.flagReason}</span>
                            </div>
                          )}

                          <div className="row-grid">
                            <div className="form-group">
                              <label className="mini-label" htmlFor={`cand-name-${idx}`}>Medicine name</label>
                              <input
                                id={`cand-name-${idx}`}
                                type="text"
                                value={candidate.name}
                                onChange={(e) => updateCandidateField(idx, 'name', e.target.value)}
                                className="form-input"
                                placeholder="e.g. Telmisartan 40mg"
                              />
                            </div>
                            <div className="form-group">
                              <label className="mini-label" htmlFor={`cand-dose-${idx}`}>Dose</label>
                              <input
                                id={`cand-dose-${idx}`}
                                type="text"
                                value={candidate.dosage}
                                onChange={(e) => updateCandidateField(idx, 'dosage', e.target.value)}
                                className="form-input"
                                placeholder="e.g. 1 tablet (1-0-1)"
                              />
                            </div>
                            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                              <span className="mini-label">When is it taken?</span>
                              <SlotPicker
                                isSelected={(s) => !!candidate.timingSlots?.includes(s) || (s === candidate.timeOfDay && (!candidate.timingSlots || candidate.timingSlots.length === 0))}
                                onToggle={(s) => toggleCandidateSlot(idx, s)}
                              />
                            </div>
                            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                              <span className="mini-label">With food?</span>
                              <FoodPicker value={candidate.foodRelation} onChange={(v) => updateCandidateField(idx, 'foodRelation', v)} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button type="button" onClick={addCandidateRow} className="add-row">
                    <Plus size={16} /> Add a medicine we missed
                  </button>

                  <div className="wizard-nav">
                    <button type="button" onClick={() => setMedicineEntryMode('choice')} className="btn btn-ghost">
                      <ArrowLeft size={16} /> Back
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmExtraction}
                      disabled={selectedCandidateCount === 0}
                      className="btn btn-primary btn-lg"
                    >
                      <CheckCircle2 size={18} /> Confirm {selectedCandidateCount} medicine{selectedCandidateCount === 1 ? '' : 's'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MANUAL ENTRY */}
          {hasMedicines === true && medicineEntryMode === 'manual' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
                <button type="button" onClick={() => setMedicineEntryMode('upload')} className="btn btn-quiet btn-sm">
                  <Camera size={15} /> Upload a photo instead
                </button>
              </div>

              <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
                {medicines.map((med, idx) => (
                  <div key={idx} className="row-card">
                    <div className="row-card-head">
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <span className="icon-tile" style={{ width: '30px', height: '30px', borderRadius: '9px' }}><Pill size={15} /></span>
                        {med.name.trim() || `Medicine ${idx + 1}`}
                      </span>
                      {medicines.length > 1 && (
                        <button type="button" onClick={() => removeMedicineRow(idx)} className="icon-btn danger" aria-label="Remove medicine">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>

                    <div className="row-grid">
                      <div className="form-group">
                        <label className="mini-label" htmlFor={`med-name-${idx}`}>Medicine name</label>
                        <input
                          id={`med-name-${idx}`}
                          type="text"
                          placeholder="e.g. Telmisartan, Metformin"
                          value={med.name}
                          onChange={(e) => updateMedicineField(idx, 'name', e.target.value)}
                          className="form-input"
                        />
                      </div>
                      <div className="form-group">
                        <label className="mini-label" htmlFor={`med-dose-${idx}`}>Dose</label>
                        <input
                          id={`med-dose-${idx}`}
                          type="text"
                          placeholder="e.g. 40mg, 1 tablet"
                          value={med.dosage}
                          onChange={(e) => updateMedicineField(idx, 'dosage', e.target.value)}
                          className="form-input"
                        />
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <span className="mini-label">When is it taken?</span>
                        <SlotPicker
                          isSelected={(s) => !!med.timingSlots?.includes(s) || (s === med.timeOfDay && (!med.timingSlots || med.timingSlots.length === 0))}
                          onToggle={(s) => toggleManualMedicineSlot(idx, s)}
                        />
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <span className="mini-label">With food?</span>
                        <FoodPicker value={med.foodRelation} onChange={(v) => updateManualMedicineFoodRelation(idx, v)} />
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label className="mini-label" htmlFor={`med-why-${idx}`}>Why it matters, in your words (optional)</label>
                        <input
                          id={`med-why-${idx}`}
                          type="text"
                          placeholder="e.g. keeps your BP steady"
                          value={med.purpose || ''}
                          onChange={(e) => updateMedicineField(idx, 'purpose', e.target.value)}
                          className="form-input"
                          maxLength={160}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button type="button" onClick={addMedicineRow} className="add-row">
                <Plus size={16} /> Add another medicine
              </button>

              <div className="wizard-nav">
                <button onClick={() => setMedicineEntryMode('choice')} className="btn btn-ghost">
                  <ArrowLeft size={16} /> Back
                </button>
                <button onClick={handleNextStep} className="btn btn-primary btn-lg">
                  Continue <ArrowRight size={18} className="arrow" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 3: CALL SCHEDULE */}
      {step === 3 && (
        <div className="animate-fade-in">
          <StepHeader eyebrow="Step 3 · Call times" title={<>When should Saathi call {name || 'them'}?</>}>
            {hasMedicines && medicines.filter(m => m.name.trim()).length > 0
              ? 'We timed each call around their medicines. Change any time or wording below.'
              : 'We suggested one daily check-in call. Change the time or add another below.'}
          </StepHeader>

          {unspecifiedMeds.length > 0 && (
            <div className="notice amber" style={{ display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, marginBottom: '4px' }}>
                <AlertTriangle size={18} />
                When are {unspecifiedMeds.length === 1 ? 'this medicine' : `these ${unspecifiedMeds.length} medicines`} taken?
              </div>
              <p style={{ fontSize: '0.86rem', margin: '0 0 12px' }}>
                Pick a time of day so Saathi knows which call to ask about {unspecifiedMeds.length === 1 ? 'it' : 'them'} on.
              </p>
              <div style={{ display: 'grid', gap: '10px' }}>
                {unspecifiedMeds.map((u) => (
                  <div key={u.index} className="card-flat" style={{ padding: '12px 14px', color: 'var(--ink)' }}>
                    <div style={{ marginBottom: '8px' }}>
                      <strong style={{ display: 'inline', fontSize: '0.9rem' }}>{u.name}</strong>
                      {u.dosage && <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginLeft: '6px' }}>{u.dosage}</span>}
                    </div>
                    <SlotPicker isSelected={() => false} onToggle={(s) => resolveUnspecifiedMed(u.index, s)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
            {callSchedule.map((slot, idx) => {
              const isDuplicateTime = callSchedule.filter(s => s.time === slot.time).length > 1;
              return (
                <div key={slot.id || idx} className={`row-card tone-${slot.slot}${isDuplicateTime ? ' flagged' : ''}`}>
                  <div className="row-card-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                      <span className="tone-tile">{slotIcon(slot.slot)}</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{SLOT_DISPLAY_NAMES[slot.slot] || 'Check-in call'}</div>
                        {isDuplicateTime && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <AlertTriangle size={12} /> Same time as another call
                          </div>
                        )}
                      </div>
                    </div>
                    {callSchedule.length > 1 && (
                      <button type="button" onClick={() => removeCallSlot(idx)} className="icon-btn danger" aria-label="Remove this call">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>

                  <div className="row-grid" style={{ gridTemplateColumns: 'minmax(140px, 0.6fr) 1fr' }}>
                    <div className="form-group">
                      <label className="mini-label" htmlFor={`slot-time-${idx}`}>Time</label>
                      <select
                        id={`slot-time-${idx}`}
                        value={slot.time}
                        onChange={(e) => updateCallSlotTime(idx, e.target.value)}
                        className="form-input"
                        style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                      >
                        {getSelectableCallTimes(slot.time).map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="mini-label" htmlFor={`slot-label-${idx}`}>What&apos;s this call for?</label>
                      <input
                        id={`slot-label-${idx}`}
                        type="text"
                        value={slot.label}
                        onChange={(e) => updateCallSlotLabel(idx, e.target.value)}
                        className="form-input"
                        placeholder="e.g. Morning medicines and how they slept"
                      />
                    </div>
                  </div>

                  {((slot.linkedMedicines && slot.linkedMedicines.length > 0) || (slot.linkedMedicineNames && slot.linkedMedicineNames.length > 0)) && (
                    <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px dashed var(--line)' }}>
                      <div className="pill-group" style={{ marginBottom: slot.linkedMedicines?.length ? '12px' : 0 }}>
                        {slot.linkedMedicines && slot.linkedMedicines.length > 0
                          ? slot.linkedMedicines.map((lm, mIdx) => (
                              <span key={mIdx} className="badge badge-neutral" style={{ gap: '6px' }}>
                                <Pill size={12} /> <b style={{ fontWeight: 600, color: 'var(--ink)' }}>{lm.name}</b> · {foodLabel(lm.foodRelation)}
                              </span>
                            ))
                          : slot.linkedMedicineNames?.map((medName, mIdx) => (
                              <span key={mIdx} className="badge badge-neutral"><Pill size={12} /> {medName}</span>
                            ))}
                      </div>

                      {slot.linkedMedicines && slot.linkedMedicines.length > 0 && (
                        <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-sm)', padding: '12px 14px' }}>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-subtle)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Volume2 size={13} /> Saathi will ask
                          </div>
                          <div style={{ display: 'grid', gap: '4px' }}>
                            {slot.linkedMedicines.map((lm, mIdx) => (
                              <div key={mIdx} className="quote">&ldquo;{lm.questionScript || `Did you take your ${lm.name}?`}&rdquo;</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button type="button" onClick={addCustomCallSlot} className="add-row" style={{ marginBottom: '16px' }}>
            <Plus size={16} /> Add another check-in call
          </button>

          <div className="notice teal" style={{ alignItems: 'center', marginBottom: 0 }}>
            <CalendarClock size={20} />
            <div>
              <strong style={{ marginBottom: 0 }}>{formatScheduleSummary(callSchedule)}</strong>
              <span style={{ fontSize: '0.84rem' }}>You can change these times any time from the dashboard.</span>
            </div>
          </div>

          <div className="wizard-nav">
            <button onClick={() => setStep(2)} className="btn btn-ghost">
              <ArrowLeft size={16} /> Back
            </button>
            <button
              onClick={handleNextStep}
              disabled={unspecifiedMeds.length > 0 || callSchedule.filter(s => s.isActive).length === 0}
              className="btn btn-primary btn-lg"
            >
              Looks good <ArrowRight size={18} className="arrow" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: EMERGENCY CONTACTS */}
      {step === 4 && (
        <div className="animate-fade-in">
          <StepHeader eyebrow="Step 4 · Emergency plan" title="Who should we reach if something is wrong?">
            If Saathi hears an emergency, we phone you and the first person who lives near {name}, with the address. If nobody answers in 10 minutes, we phone the next person.
          </StepHeader>

          <div className="notice amber" role="note" style={{ marginBottom: '16px' }}>
            <ShieldAlert size={18} />
            <div>
              <b>Aaptha is not an emergency service.</b> In an emergency, {name} or anyone nearby should call <b>112</b>. Saathi says this on the call too.
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="parent-address">{name}&apos;s home address</label>
            <textarea
              id="parent-address"
              className="form-input"
              rows={2}
              placeholder="House, street, area, city, PIN, landmark"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <span className="form-hint">Read out to the nearby contact during an emergency call.</span>
          </div>

          <div className="toggle-row" style={{ marginBottom: '12px' }}>
            <div>
              <strong>{name} lives alone</strong>
              <p>If {name} can&apos;t be reached all day, we ask someone nearby to go and check.</p>
            </div>
            <button type="button" role="switch" aria-checked={livesAlone} aria-label="Lives alone" className="switch" onClick={() => setLivesAlone(v => !v)} />
          </div>

          <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
            {emergencyContacts.map((c, idx) => (
              <div key={idx} className="row-card">
                <div className="row-card-head">
                  <span className={`badge ${idx === 0 ? 'badge-teal' : 'badge-neutral'}`}>
                    {idx === 0 ? 'Contact first' : `Backup contact ${idx}`}
                  </span>
                  {idx > 0 && (
                    <button type="button" onClick={() => removeContactRow(idx)} className="icon-btn danger" aria-label="Remove contact">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>

                <div className="row-grid">
                  <div className="form-group">
                    <label className="mini-label" htmlFor={`c-name-${idx}`}>Name</label>
                    <input
                      id={`c-name-${idx}`}
                      type="text"
                      placeholder="e.g. Priya Sharma"
                      value={c.name}
                      onChange={(e) => {
                        const updated = [...emergencyContacts];
                        updated[idx].name = e.target.value;
                        setEmergencyContacts(updated);
                      }}
                      className="form-input"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="mini-label" htmlFor={`c-rel-${idx}`}>Relationship</label>
                    <input
                      id={`c-rel-${idx}`}
                      type="text"
                      placeholder="e.g. Daughter, neighbour, doctor"
                      value={c.relation}
                      onChange={(e) => {
                        const updated = [...emergencyContacts];
                        updated[idx].relation = e.target.value;
                        setEmergencyContacts(updated);
                      }}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '0.88rem', fontWeight: 500 }}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!c.isLocal}
                        className="switch"
                        onClick={() => {
                          const updated = [...emergencyContacts];
                          updated[idx].isLocal = !updated[idx].isLocal;
                          setEmergencyContacts(updated);
                        }}
                      />
                      Lives near {name || 'them'} and can go there
                    </label>
                  </div>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="mini-label" htmlFor={`c-phone-${idx}`}>Mobile number</label>
                    <input
                      id={`c-phone-${idx}`}
                      type="tel"
                      inputMode="tel"
                      placeholder="+91 98765 43210"
                      value={c.phone}
                      onChange={(e) => {
                        const updated = [...emergencyContacts];
                        updated[idx].phone = e.target.value;
                        setEmergencyContacts(updated);
                      }}
                      className="form-input"
                      required
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addContactRow} className="add-row">
            <Plus size={16} /> Add a backup contact (sibling, neighbour, doctor)
          </button>

          <div className="wizard-nav">
            <button onClick={() => setStep(3)} className="btn btn-ghost">
              <ArrowLeft size={16} /> Back
            </button>
            <button onClick={handleNextStep} className="btn btn-primary btn-lg">
              Continue <ArrowRight size={18} className="arrow" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: CONSENT */}
      {step === 5 && (
        <div className="animate-fade-in">
          <StepHeader eyebrow="Step 5 · Consent" title={<>Have you told {name} about the calls?</>}>
            Saathi only calls people who know to expect it. On the first call Saathi also asks {name} directly, in their language, and calls only continue if they say yes.
          </StepHeader>

          <div className="card-flat" style={{ background: 'var(--paper)', marginBottom: '20px', padding: '20px 22px' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: '8px' }}>
              What you could tell {name}
            </div>
            <p className="quote" style={{ fontSize: '1.05rem' }}>
              &ldquo;A friendly voice assistant called Saathi will phone you around {callTime} to ask if you&apos;ve taken your medicines and how you&apos;re feeling. It&apos;s from me, so do pick up.&rdquo;
            </p>
          </div>

          <label
            className="checkbox-group"
            style={{
              margin: 0,
              padding: '18px',
              borderRadius: 'var(--r-md)',
              border: `1.5px solid ${consentConfirmed ? 'var(--teal)' : 'var(--line)'}`,
              background: consentConfirmed ? 'var(--teal-light)' : 'var(--panel-elevated)',
              transition: 'all 200ms ease'
            }}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={consentConfirmed}
              onChange={(e) => setConsentConfirmed(e.target.checked)}
            />
            <span className={`checkbox-custom ${consentConfirmed ? 'checked' : ''}`} aria-hidden="true">
              {consentConfirmed && <Check size={14} strokeWidth={3} />}
            </span>
            <span>
              <strong style={{ color: 'var(--ink)', display: 'block', marginBottom: '2px', fontSize: '0.95rem' }}>
                I have told {name} about Saathi, and that I will see what they say on the calls.
              </strong>
              <span style={{ fontSize: '0.84rem' }}>{name} can say &ldquo;stop calling me&rdquo; on any call, and you can pause calls whenever you like.</span>
            </span>
          </label>

          <div className="wizard-nav">
            <button onClick={() => setStep(4)} className="btn btn-ghost">
              <ArrowLeft size={16} /> Back
            </button>
            <button onClick={handleFinalSubmit} disabled={submitting || !consentConfirmed} className="btn btn-primary btn-lg">
              {submitting ? <><span className="spinner" /> Setting things up…</> : <>Finish setup <ArrowRight size={18} className="arrow" /></>}
            </button>
          </div>
        </div>
      )}

      {/* STEP 6: DONE */}
      {step === 6 && (
        <div style={{ textAlign: 'center' }} className="animate-fade-in">
          <div className="success-burst">
            <CheckCircle2 size={38} />
          </div>
          <h1 style={{ fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', letterSpacing: '-0.03em', marginBottom: '10px' }}>
            {name} is all set
          </h1>
          <p style={{ fontSize: '1.02rem', color: 'var(--ink-muted)', marginBottom: '28px', maxWidth: '46ch', marginInline: 'auto' }}>
            Check-ins are scheduled for <strong style={{ color: 'var(--ink)' }}>{formatScheduleSummary(callSchedule.filter(s => s.isActive))}</strong>, in {language}.
          </p>

          {(() => {
            const lang = noticeLangFor(language);
            const firstTime = callSchedule.filter(s => s.isActive)[0]?.time || callTime;
            const script = introScript(lang, { parentName: name, time: firstTime, familyName: (user?.name || '').split(' ')[0] });
            const digits = phone.replace(/\D/g, '');
            const waTo = digits.length === 10 ? `91${digits}` : digits;
            return (
              <div className="card-flat" style={{ textAlign: 'left', marginBottom: '16px', padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <span className="icon-tile gold"><MessageCircle size={20} /></span>
                  <div>
                    <div style={{ fontWeight: 600 }}>Tell {name} Saathi will call</div>
                    <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)' }}>Elders rightly hang up on strangers. A voice note from you makes Saathi a caller they expect.</div>
                  </div>
                </div>
                <p className="quote" style={{ fontSize: '0.98rem', marginBottom: '12px' }}>{script}</p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <a className="btn btn-primary btn-sm" href={`https://wa.me/${waTo}?text=${encodeURIComponent(script)}`} target="_blank" rel="noreferrer">
                    <MessageCircle size={14} /> Send on WhatsApp
                  </a>
                  <a className="btn btn-ghost btn-sm" href={`/notice/${lang}`} target="_blank" rel="noreferrer">Short notice in {NOTICES[lang].label}</a>
                  {saathiNumber && (
                    <a className="btn btn-ghost btn-sm" href="/api/saathi/contact" download="Saathi.vcf">
                      <Download size={14} /> Save Saathi&apos;s number
                    </a>
                  )}
                  {createdParentId && !introDone && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={async () => {
                        const res = await fetch(`/api/parents/${createdParentId}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'setup_step', step: 'introduced', done: true })
                        });
                        if (res.ok) setIntroDone(true);
                      }}
                    >
                      <Check size={14} /> I&apos;ve told them
                    </button>
                  )}
                  {introDone && <span className="badge badge-green"><Check size={12} /> Done</span>}
                </div>
              </div>
            );
          })()}

          <div className="card-flat" style={{ textAlign: 'left', marginBottom: '24px', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <span className="icon-tile"><PhoneCall size={20} /></span>
              <div>
                <div style={{ fontWeight: 600 }}>Try a test call</div>
                <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)' }}>Hear what Saathi sounds like on {phone || 'their phone'}.</div>
              </div>
            </div>

            {testCallResult ? (
              <div className={`alert-box ${testCallResult.ok ? 'success' : 'warning'}`} style={{ margin: 0 }} role="status">
                {testCallResult.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                <span>{testCallResult.message}</span>
              </div>
            ) : (
              <button type="button" onClick={triggerTestCall} disabled={testCalling} className="btn btn-ghost btn-block">
                {testCalling ? <><span className="spinner" /> Requesting…</> : <><Play size={15} fill="currentColor" /> Request a test call</>}
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gap: '10px' }}>
            <Link href="/dashboard" className="btn btn-primary btn-lg btn-block">
              Go to your dashboard <ArrowRight size={18} className="arrow" />
            </Link>

            {currentPlan.parentsIncluded > 1 && (
              <button
                type="button"
                onClick={() => {
                  setName('');
                  setPhone('');
                  setHasMedicines(null);
                  setConsentConfirmed(false);
                  setStep(1);
                }}
                className="btn btn-ghost btn-block"
              >
                <UserPlus size={16} /> Add another parent
                <span style={{ color: 'var(--ink-subtle)', fontWeight: 500 }}>· {currentPlan.name} includes {currentPlan.parentsIncluded}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </WizardShell>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="wrap" style={{ paddingTop: '120px' }}><div className="skeleton" style={{ height: '480px', maxWidth: '720px', margin: '0 auto' }} /></div>}>
      <OnboardingContent />
    </Suspense>
  );
}
