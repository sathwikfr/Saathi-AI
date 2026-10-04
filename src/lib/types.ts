export type PlanId = 'free' | 'solo' | 'family' | 'extended';

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  priceMonthly: number;
  currency: string;
  hasTrial: boolean;
  trialDays: number;
  popular?: boolean;
  features: string[];
  parentsIncluded: number;
  /** Max scheduled Saathi calls per parent per day (controls call cost). */
  callsPerDay: number;
  /** Free plan only: it lasts this many days from account creation, then calls stop. */
  expiresAfterDays?: number;
  /** True for the synthetic "trial ended" plan returned once a free trial is over. */
  expired?: boolean;
  razorpayPlanId?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatar?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  /** True when the email is listed in ADMIN_EMAILS (shows the Admin menu link; /admin re-checks on the server). */
  isAdmin?: boolean;
  createdAt: string;
  subscription?: UserSubscription;
  notificationPreferences?: NotificationPreferences;
}

export interface DBSession {
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  rememberMe: boolean;
  revoked: boolean;
}

export interface OTPRecord {
  phone: string;
  codeHash: string;
  expiresAt: string;
  attempts: number;
  purpose: 'login' | 'signup';
}

export interface PasswordResetRecord {
  token: string;
  userId: string;
  expiresAt: string;
  used: boolean;
}

export interface OAuthAccount {
  id: string;
  userId: string;
  provider: 'google';
  email: string;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'free';

export interface UserSubscription {
  id: string;
  planId: PlanId;
  status: SubscriptionStatus;
  startDate: string;
  trialEndsAt?: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  amount: number;
  paymentMethodLast4?: string;
  paymentMethodBrand?: string;
  razorpaySubscriptionId?: string;
  razorpayPaymentId?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  date: string;
  amount: number;
  planName: string;
  status: 'paid' | 'pending' | 'failed';
  downloadUrl?: string;
  paymentMethod: string;
}

export type MedicineTimingSlot = 'morning' | 'afternoon' | 'evening' | 'bedtime' | 'as_needed' | 'unspecified';

export type FoodRelation = 'before_food' | 'after_food' | 'with_food' | 'not_specified';

export interface LinkedMedicineDetail {
  name: string;
  dosage?: string;
  foodRelation?: FoodRelation;
  questionScript?: string;
  /** The family's one-line reason ("keeps your BP steady"), filled in from Medicine.purpose when a call is placed. */
  purpose?: string;
}

export interface ScheduledCallSlot {
  id: string;
  time: string;
  slot: 'morning' | 'afternoon' | 'evening' | 'bedtime' | 'wellness' | 'custom';
  label: string;
  linkedMedicineNames?: string[];
  linkedMedicines?: LinkedMedicineDetail[];
  isActive: boolean;
}

export interface ParentProfile {
  id: string;
  userId: string;
  name: string;
  relationship: string;
  phone: string;
  language: string;
  timezone: string;
  callTime: string;
  callSchedule?: ScheduledCallSlot[];
  isPaused: boolean;
  pauseReason?: string;
  pauseUntil?: string;
  consentGiven: boolean;
  consentDate: string;
  createdAt: string;
  isDeleted?: boolean;
  /** The parent's own answer when Saathi asked on a call (consentGiven is the family's confirmation). */
  parentConsent: ParentConsent;
  parentConsentAt?: string;
  address?: string;
  livesAlone: boolean;
  bloodGroup?: string;
  conditions?: string;
  allergies?: string;
  nearestHospital?: string;
  doctorName?: string;
  doctorPhone?: string;
  introducedAt?: string;
  numberSavedAt?: string;
  birthDate?: string;
  companionEnabled: boolean;
  companionDay?: number;
  companionTime?: string;
  companionTopics?: string;
  /** How the logged-in user relates to this parent. */
  accessRole?: ParentAccessRole;
  /** Shown on shared parents: who set them up. */
  ownerName?: string;
}

export type ParentConsent = 'pending' | 'given' | 'declined' | 'withdrawn';
export type ParentAccessRole = 'owner' | 'co_manager' | 'viewer';

export interface Medicine {
  id: string;
  parentId: string;
  name: string;
  dosage: string;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'bedtime';
  timingSlots?: MedicineTimingSlot[];
  foodRelation?: FoodRelation;
  frequency: 'daily' | 'twice_daily' | 'as_needed';
  isActive: boolean;
  /** The family's one-line reason, repeated by Saathi. */
  purpose?: string;
}

export type ContactRole = 'family' | 'neighbour' | 'security' | 'doctor' | 'caregiver' | 'other';

export interface EmergencyContact {
  id: string;
  parentId: string;
  name: string;
  relation: string;
  phone: string;
  priority: 'primary' | 'secondary';
  role?: ContactRole;
  /** Lives near the parent and can go there. */
  isLocal?: boolean;
  practiceAt?: string;
  practiceResult?: string;
}

export interface CallLog {
  id: string;
  parentId: string;
  scheduledTime: string;
  actualAnswerTime?: string;
  /**
   * scheduled: logged, not dialed yet · placed: sent to the calling service, waiting for the result ·
   * answered / unanswered / busy: final outcome · failed: could not be placed or no result received.
   */
  status: 'answered' | 'unanswered' | 'busy' | 'scheduled' | 'placed' | 'failed';
  durationSeconds: number;
  medicationConfirmed: boolean;
  mood: 'cheerful' | 'calm' | 'anxious' | 'unwell' | 'neutral';
  summary: string;
  notes?: string;
  createdAt?: string;
  slot?: string;
  /** The ScheduledCallSlot this call was for; empty for test and manual calls. */
  slotId?: string;
  attemptNumber?: number;
  failureReason?: string;
  /** Parsed from the end-of-call result (answered calls). */
  details?: CallDetails;
}

export type MedicineStatus = 'taken' | 'missed' | 'unknown' | 'later' | 'stopped';

export interface CallDetails {
  medicineResults: { name: string; status: MedicineStatus }[];
  healthConcern?: string | null;
  emergencyFlag?: boolean;
  sleep?: 'good' | 'poor' | null;
  appetite?: 'good' | 'poor' | null;
  pain?: 'none' | 'mild' | 'severe' | null;
  painWhere?: string | null;
  runningLow?: string[];
  stoppedReason?: string | null;
  consent?: string | null;
  callType?: string;
}

export interface AlertRecord {
  id: string;
  parentId: string;
  level: 0 | 1 | 2 | 3 | 4;
  title: string;
  message: string;
  /** How the family was told: 'dashboard' = not sent anywhere else (yet). */
  channel: 'whatsapp' | 'sms' | 'email' | 'dashboard';
  timestamp: string;
  status: 'sent' | 'read' | 'resolved';
  createdAt?: string;
  /** Set when the family tapped "I'll handle it" on WhatsApp. */
  acknowledgedAt?: string;
  handledByName?: string;
  handledVia?: string;
  outcome?: 'fine' | 'doctor_visit' | 'hospital' | 'other';
  outcomeNote?: string;
  outcomeAt?: string;
  escalation?: EscalationSummary;
}

export interface EscalationSummary {
  id: string;
  kind: 'emergency' | 'wellness_check' | 'practice';
  status: 'active' | 'handled' | 'exhausted' | 'closed';
  round: number;
  handledByName?: string;
  handledVia?: string;
  handledAt?: string;
  nextStepAt?: string;
  attempts: { name: string; channel: string; status: string; response?: string; createdAt: string; targetType: string }[];
}

export interface HealthInsight {
  id: string;
  parentId: string;
  kind: string;
  level: number;
  title: string;
  message: string;
  createdAt: string;
  dismissedAt?: string;
}

export interface HealthDocument {
  id: string;
  parentId: string;
  kind: 'prescription' | 'lab_report' | 'scan' | 'bill' | 'discharge' | 'insurance' | 'other';
  title: string;
  docDate?: string;
  renewalDate?: string;
  notes?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ScheduleSuggestion {
  id: string;
  parentId: string;
  currentCallTime: string;
  suggestedTime: string;
  confidencePct: number;
  sampleSize: number;
  reason: string;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: string;
}

export interface CaregiverInvite {
  id: string;
  parentId: string;
  email: string;
  name: string;
  role: 'viewer' | 'co_manager';
  status: 'pending' | 'accepted' | 'revoked';
  invitedAt: string;
  phone?: string;
  acceptedAt?: string;
  /** Pending invites only, shown to the owner so they can resend the link. */
  inviteUrl?: string;
}

export interface NotificationPreferences {
  whatsapp: boolean;
  sms: boolean;
  email: boolean;
  push: boolean;
  minimumAlertLevel: number;
  timezone?: string | null;
  dailySummary?: boolean;
  dailySummaryHour?: number;
  weeklyDigest?: boolean;
  digestDay?: number;
  digestHour?: number;
  monthlySummary?: boolean;
  wakeForEmergency?: boolean;
  emergencyPhone?: string | null;
}

export interface ExtractedMedicineCandidate {
  id?: string;
  name: string;
  dosage: string;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'bedtime';
  timingSlots?: MedicineTimingSlot[];
  foodRelation?: FoodRelation;
  frequency?: 'daily' | 'twice_daily' | 'as_needed';
  confidence: 'high' | 'medium' | 'low';
  flagReason?: string;
  selected?: boolean;
  form?: 'tablet' | 'capsule' | 'syrup' | 'ointment' | 'drops' | 'injection' | 'other';
  category?: string;
  isEditedByUser?: boolean;
  verifiedByUser?: boolean;
}

export interface MedicineReport {
  id: string;
  parentId?: string;
  userId?: string;
  fileName: string;
  fileType: string;
  fileUrl?: string;
  uploadedAt: string;
  rawExtractionJson: ExtractedMedicineCandidate[];
  batchConfidence?: 'high' | 'medium' | 'low';
  batchQualityWarning?: string;
  confirmedAt?: string;
  confirmedMedicineIds?: string[];
  status: 'draft' | 'confirmed' | 'discarded';
}
