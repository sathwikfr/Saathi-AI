export type PlanId = 'free' | 'essential' | 'solo' | 'family' | 'extended';

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
  channel: 'call' | 'whatsapp';
  callsPerDay: number;
  remindersPerDay: number;
  weeklyChat: boolean;
  askPerMonth: number;
  whatsappPeople: number;
  premium: boolean;
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
}

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
}

export interface EmergencyContact {
  id: string;
  parentId: string;
  name: string;
  relation: string;
  phone: string;
  priority: 'primary' | 'secondary';
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
  status: 'pending' | 'accepted';
  invitedAt: string;
}

export interface NotificationPreferences {
  whatsapp: boolean;
  sms: boolean;
  email: boolean;
  push: boolean;
  minimumAlertLevel: number;
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
