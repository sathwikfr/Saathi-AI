import { Resend } from 'resend';
import { PLANS } from './plans';

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? new Resend(apiKey) : null;
}

function getFromEmail() {
  return process.env.RESEND_FROM_EMAIL || 'Aaptha <onboarding@resend.dev>';
}

export interface SentEmailRecord {
  id: string;
  to: string;
  from: string;
  subject: string;
  template: string;
  html: string;
  text: string;
  timestamp: string;
  status: 'sent_resend' | 'simulated_dev' | 'failed';
  error?: string;
}

// In-memory outbox for inspection & testing in development
declare global {
  // eslint-disable-next-line no-var
  var __carecircle_email_outbox: SentEmailRecord[] | undefined;
}

const outbox: SentEmailRecord[] = global.__carecircle_email_outbox || [];
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
/** The dev outbox holds whole emails (reset links, alert text): never kept in production, and capped elsewhere. */
function pushOutbox(record: SentEmailRecord): void {
  if (IS_PRODUCTION) return;
  outbox.push(record);
  if (outbox.length > 50) outbox.splice(0, outbox.length - 50);
}
if (!global.__carecircle_email_outbox) {
  global.__carecircle_email_outbox = outbox;
}

export function getRecentEmails(limit = 20): SentEmailRecord[] {
  return [...outbox].reverse().slice(0, limit);
}

function appUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}${path}`;
}

/** Escapes user-controlled text (names, plan labels) before it goes into email HTML. */
function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function firstName(name?: string): string {
  return name ? esc(name.trim().split(/\s+/)[0] || 'there') : 'there';
}

export function formatMoney(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

/** Dates in emails are shown in IST, like the rest of the product, wherever the server runs. */
export function formatEmailDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function detailRows(rows: Array<[string, string]>): string {
  return `
    <div class="info-card">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        ${rows
          .map(
            ([label, value]) => `
        <tr>
          <td style="padding: 6px 0; color: #7a7267;">${label}</td>
          <td style="padding: 6px 0; text-align: right; font-weight: 600;">${value}</td>
        </tr>`
          )
          .join('')}
      </table>
    </div>`;
}

/**
 * Base email layout matching Aaptha visual style:
 * Cream/Paper background (#f7f3ec), Ocean blue (#006baa) branding, Gold (#c98a3a) accents.
 */
function renderAapthaTemplate({
  title,
  badge,
  contentHtml,
  ctaText,
  ctaUrl,
  secondaryNote
}: {
  title: string;
  badge?: string;
  contentHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  secondaryNote?: string;
}): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f7f3ec;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #2b2621;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #f7f3ec;
      padding: 40px 16px;
    }
    .main-table {
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      border: 1px solid #e7ded0;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(43, 38, 33, 0.05);
    }
    .header {
      background: linear-gradient(135deg, #002038 0%, #006baa 100%);
      padding: 32px 32px 28px;
      text-align: center;
    }
    .logo-text {
      color: #ffffff;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
      text-decoration: none;
      font-family: 'Fraunces', Georgia, serif;
    }
    .logo-dot {
      color: #c98a3a;
    }
    .tagline {
      color: #c4e7fe;
      font-size: 13px;
      margin-top: 4px;
    }
    .body-content {
      padding: 36px 32px 28px;
      font-size: 15px;
      line-height: 1.6;
      color: #2b2621;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      background-color: #e4f5ff;
      color: #006baa;
      margin-bottom: 16px;
    }
    .title {
      font-size: 22px;
      font-weight: 700;
      color: #2b2621;
      margin: 0 0 16px;
      font-family: 'Fraunces', Georgia, serif;
      line-height: 1.3;
    }
    .btn-container {
      margin: 28px 0;
      text-align: center;
    }
    .btn {
      display: inline-block;
      padding: 14px 28px;
      background-color: #006baa;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      border-radius: 12px;
      letter-spacing: 0.2px;
    }
    .info-card {
      background-color: #f7f3ec;
      border: 1px solid #e7ded0;
      border-radius: 12px;
      padding: 16px 20px;
      margin: 20px 0;
    }
    .footer {
      background-color: #f7f3ec;
      border-top: 1px solid #e7ded0;
      padding: 24px 32px;
      text-align: center;
      font-size: 12px;
      color: #7a7267;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <table class="main-table" cellpadding="0" cellspacing="0" width="100%">
      <!-- Header -->
      <tr>
        <td class="header">
          <div class="logo-text">Aaptha<span class="logo-dot">.</span></div>
          <div class="tagline">Daily AI Care Companion for Aging Parents</div>
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td class="body-content">
          ${badge ? `<div class="badge">${badge}</div>` : ''}
          <h1 class="title">${title}</h1>
          ${contentHtml}
          ${
            ctaText && ctaUrl
              ? `
          <div class="btn-container">
            <a href="${ctaUrl}" class="btn" target="_blank" rel="noopener noreferrer">${ctaText}</a>
          </div>
          <p style="font-size: 12px; color: #7a7267; word-break: break-all; margin-top: 12px;">
            If the button above does not work, copy and paste this link into your browser:<br />
            <a href="${ctaUrl}" style="color: #006baa;">${ctaUrl}</a>
          </p>
          `
              : ''
          }
          ${
            secondaryNote
              ? `<p style="font-size: 13px; color: #7a7267; margin-top: 24px;">${secondaryNote}</p>`
              : ''
          }
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td class="footer">
          <p style="margin: 0 0 6px;">Aaptha${process.env.NEXT_PUBLIC_SUPPORT_EMAIL ? ` &bull; ${process.env.NEXT_PUBLIC_SUPPORT_EMAIL}` : ''}</p>
          <p style="margin: 0; color: #9c9488;">
            Security Notice: Aaptha will never ask for your password via phone or message. If you did not initiate this request, please contact our support team.
          </p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>
  `;
}

/**
 * Core send helper: sends via Resend if API key is configured,
 * otherwise logs formatted message to console and saves to outbox.
 */
async function dispatchEmail({
  to,
  subject,
  html,
  text,
  templateName
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
  templateName: string;
}): Promise<{ success: boolean; id?: string; error?: string; simulated?: boolean }> {
  const client = getResendClient();
  const senderEmail = getFromEmail();

  if (client && senderEmail.includes('@resend.dev')) {
    // Resend's shared test sender only delivers to the Resend account owner's
    // own address; every other recipient is rejected. Set RESEND_FROM_EMAIL to
    // an address on a domain verified in Resend.
    console.warn(
      `[Aaptha Email] Sending from ${senderEmail}: Resend only delivers this to your own Resend account email. ` +
        'Verify a domain in Resend and set RESEND_FROM_EMAIL to fix delivery to real users.'
    );
  }

  const emailRecord: SentEmailRecord = {
    id: 'eml_' + Math.random().toString(36).substring(2, 10),
    to,
    from: senderEmail,
    subject,
    template: templateName,
    html,
    text,
    timestamp: new Date().toISOString(),
    status: 'simulated_dev'
  };

  console.log(`\n======================================================`);
  console.log(`[Aaptha Email Gateway] Trigger: ${templateName}`);
  if (IS_PRODUCTION) {
    // Server logs are readable by more people than the family: no names, health words or addresses there.
    console.log(`  To:      ${to.replace(/^(.).*(@.*)$/, '$1***$2')}`);
  } else {
    console.log(`  To:      ${to}`);
    console.log(`  From:    ${senderEmail}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Preview: ${text.substring(0, 160)}...`);
  }

  if (client) {
    try {
      const response = await client.emails.send({
        from: senderEmail,
        to: [to],
        subject,
        html,
        text,
        // Customers reply to a monitored inbox, not to the no-reply sender.
        ...(process.env.NEXT_PUBLIC_SUPPORT_EMAIL ? { replyTo: process.env.NEXT_PUBLIC_SUPPORT_EMAIL } : {})
      });

      if (response.error) {
        console.error(`  [Resend API Error]:`, response.error);
        emailRecord.status = 'failed';
        emailRecord.error = response.error.message;
        pushOutbox(emailRecord);
        return { success: false, error: response.error.message };
      }

      console.log(`  [Resend API Success] Email Dispatched! ID: ${response.data?.id}`);
      console.log(`======================================================\n`);
      emailRecord.id = response.data?.id || emailRecord.id;
      emailRecord.status = 'sent_resend';
      pushOutbox(emailRecord);
      return { success: true, id: response.data?.id };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [Resend Exception]:`, errMsg);
      console.log(`======================================================\n`);
      emailRecord.status = 'failed';
      emailRecord.error = errMsg;
      pushOutbox(emailRecord);
      return { success: false, error: errMsg };
    }
  } else {
    // Development fallback without Resend key
    console.log(`  [Notice]: RESEND_API_KEY is not set in environment.`);
    console.log(`  Email recorded in dev outbox (Mock Delivered).`);
    console.log(`======================================================\n`);
    emailRecord.status = 'simulated_dev';
    pushOutbox(emailRecord);
    return { success: true, id: emailRecord.id, simulated: true };
  }
}

// --------------------------------------------------------------------------
// 1. PASSWORD RESET EMAIL
// --------------------------------------------------------------------------
export async function sendPasswordResetEmail({
  to,
  name,
  resetUrl,
  expiresInMinutes = 20
}: {
  to: string;
  name?: string;
  resetUrl: string;
  expiresInMinutes?: number;
}) {
  const recipientName = firstName(name);
  const title = 'Reset your Aaptha password';
  const contentHtml = `
    <p>Hi ${recipientName},</p>
    <p>We received a request to reset the password for your Aaptha account associated with <strong>${to}</strong>.</p>
    <p>Click the button below to choose a new password. For your security, this single-use link will expire in <strong>${expiresInMinutes} minutes</strong>.</p>
  `;
  const html = renderAapthaTemplate({
    title,
    badge: 'Security Request',
    contentHtml,
    ctaText: 'Reset My Password',
    ctaUrl: resetUrl,
    secondaryNote: `If you didn't request a password reset, you can safely ignore this email. Your current password remains secure.`
  });
  const text = `Hi ${recipientName},\n\nWe received a request to reset your Aaptha password. Use the following link within ${expiresInMinutes} minutes to choose a new password:\n\n${resetUrl}\n\nIf you did not request this, please ignore this email.`;

  return dispatchEmail({
    to,
    subject: 'Reset your Aaptha password',
    html,
    text,
    templateName: 'password_reset'
  });
}

// --------------------------------------------------------------------------
// 2. EMAIL VERIFICATION / WELCOME EMAIL
// --------------------------------------------------------------------------
export async function sendVerificationEmail({
  to,
  name,
  verifyUrl
}: {
  to: string;
  name?: string;
  verifyUrl: string;
}) {
  const recipientName = firstName(name);
  const title = 'Welcome to Aaptha! Please verify your email';
  const contentHtml = `
    <p>Hi ${recipientName},</p>
    <p>Thank you for joining Aaptha. We are honored to help you look after your parents with caring, daily AI check-ins.</p>
    <p>Please verify your email address to secure your account and activate your family notifications.</p>
  `;
  const html = renderAapthaTemplate({
    title,
    badge: 'Welcome to Aaptha',
    contentHtml,
    ctaText: 'Verify My Email',
    ctaUrl: verifyUrl,
    secondaryNote: 'After verifying, you will be directed straight to parent routine setup.'
  });
  const text = `Hi ${recipientName},\n\nWelcome to Aaptha! Please verify your email by clicking the link below:\n\n${verifyUrl}`;

  return dispatchEmail({
    to,
    subject: 'Welcome to Aaptha — Please verify your email',
    html,
    text,
    templateName: 'email_verification'
  });
}

// --------------------------------------------------------------------------
// 3. OTP VERIFICATION CODE (BACKUP VIA EMAIL)
// --------------------------------------------------------------------------
export async function sendOtpEmail({
  to,
  name,
  code,
  expiresInMinutes = 10
}: {
  to: string;
  name?: string;
  code: string;
  expiresInMinutes?: number;
}) {
  const recipientName = firstName(name);
  const title = 'Your Aaptha Verification Code';
  const contentHtml = `
    <p>Hi ${recipientName},</p>
    <p>Here is your one-time verification code to sign in to Aaptha:</p>
    <div style="background-color: #f7f3ec; border: 2px dashed #006baa; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0;">
      <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #006baa; font-family: monospace;">${code}</span>
    </div>
    <p style="font-size: 13px; color: #7a7267;">This code is valid for <strong>${expiresInMinutes} minutes</strong>. Do not share this code with anyone.</p>
  `;
  const html = renderAapthaTemplate({
    title,
    badge: 'Security Code',
    contentHtml,
    secondaryNote: `If you didn't request this code, someone may have entered your email address by mistake.`
  });
  const text = `Hi ${recipientName},\n\nYour Aaptha verification code is: ${code}\n\nIt expires in ${expiresInMinutes} minutes.`;

  return dispatchEmail({
    to,
    subject: `${code} is your Aaptha verification code`,
    html,
    text,
    templateName: 'otp_code'
  });
}

// --------------------------------------------------------------------------
// 4. PAYMENT RECEIPT / CONFIRMATION EMAIL
// --------------------------------------------------------------------------
export async function sendPaymentReceiptEmail({
  to,
  name,
  planName,
  amount,
  invoiceNumber,
  date,
  nextBillingDate,
  paymentMethod = 'UPI AutoPay'
}: {
  to: string;
  name?: string;
  planName: string;
  amount: number;
  invoiceNumber: string;
  date: string;
  nextBillingDate?: string;
  paymentMethod?: string;
}) {
  const recipientName = firstName(name);
  const title = 'Payment Confirmation & Receipt';
  const contentHtml = `
    <p>Hi ${recipientName},</p>
    <p>Thank you. We received your Aaptha subscription payment.</p>
    <div class="info-card">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 6px 0; color: #7a7267;">Invoice Number:</td>
          <td style="padding: 6px 0; text-align: right; font-weight: 600;">${invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #7a7267;">Plan:</td>
          <td style="padding: 6px 0; text-align: right; font-weight: 600;">${planName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #7a7267;">Amount Paid:</td>
          <td style="padding: 6px 0; text-align: right; font-weight: 700; color: #006baa;">₹${amount}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #7a7267;">Payment Method:</td>
          <td style="padding: 6px 0; text-align: right;">${paymentMethod}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #7a7267;">Date:</td>
          <td style="padding: 6px 0; text-align: right;">${date}</td>
        </tr>
        ${
          nextBillingDate
            ? `
        <tr>
          <td style="padding: 6px 0; color: #7a7267;">Next Renewal:</td>
          <td style="padding: 6px 0; text-align: right;">${nextBillingDate}</td>
        </tr>
        `
            : ''
        }
      </table>
    </div>
    <p>Your parents' daily calls, medicine reminders, and family health summaries are actively configured.</p>
  `;
  const html = renderAapthaTemplate({
    title,
    badge: 'Payment Receipt',
    contentHtml,
    ctaText: 'View Dashboard & Billing',
    ctaUrl: appUrl('/account/billing'),
    secondaryNote: 'You can download your receipts anytime from Account → Billing.'
  });
  const text =
    `Hi ${recipientName},\n\nPayment receipt from Aaptha\nInvoice: ${invoiceNumber}\nPlan: ${planName}\nAmount: ₹${amount}\nDate: ${date}` +
    `${nextBillingDate ? `\nNext renewal: ${nextBillingDate}` : ''}\n\nThank you for choosing Aaptha.\nBilling: ${appUrl('/account/billing')}`;

  return dispatchEmail({
    to,
    subject: `Receipt for your Aaptha subscription (${invoiceNumber})`,
    html,
    text,
    templateName: 'payment_receipt'
  });
}

// --------------------------------------------------------------------------
// 5. PAYMENT FAILED NOTIFICATION
// --------------------------------------------------------------------------
export async function sendPaymentFailedEmail({
  to,
  name,
  planName,
  amount,
  retryUrl
}: {
  to: string;
  name?: string;
  planName: string;
  amount: number;
  retryUrl: string;
}) {
  const recipientName = firstName(name);
  const title = 'Payment Issue with Your Aaptha Subscription';
  const contentHtml = `
    <p>Hi ${recipientName},</p>
    <p>We were unable to process your recurring subscription payment of <strong>₹${amount}</strong> for the <strong>${planName}</strong> plan.</p>
    <p>To avoid any interruption in your parents' daily check-in calls and medication alerts, please check that your card or UPI mandate is active and has enough balance, then update your payment details from your billing page.</p>
  `;
  const html = renderAapthaTemplate({
    title,
    badge: 'Payment Action Required',
    contentHtml,
    ctaText: 'Open Billing',
    ctaUrl: retryUrl,
    secondaryNote: 'Your daily calls continue for now. Your bank or Razorpay may try the payment again automatically; if it keeps failing, the subscription is stopped and the calls will pause.'
  });
  const text = `Hi ${recipientName},\n\nYour Aaptha payment of ₹${amount} could not be processed. Please update your payment method to ensure uninterrupted service:\n\n${retryUrl}`;

  return dispatchEmail({
    to,
    subject: 'Action Required: Aaptha subscription payment failed',
    html,
    text,
    templateName: 'payment_failed'
  });
}

// --------------------------------------------------------------------------
// 6. SUBSCRIPTION CANCELLED EMAIL
// --------------------------------------------------------------------------
export async function sendSubscriptionCancelledEmail({
  to,
  name,
  planName,
  accessUntil
}: {
  to: string;
  name?: string;
  planName: string;
  accessUntil: string;
}) {
  const recipientName = firstName(name);
  const title = 'Your Aaptha subscription has been cancelled';
  const contentHtml = `
    <p>Hi ${recipientName},</p>
    <p>Your subscription to <strong>${planName}</strong> has been cancelled.</p>
    <p>You will retain full access to your parents' daily calls, reports, and AI logs until the end of your billing cycle on <strong>${accessUntil}</strong>.</p>
    <p>Your configured parent preferences and history will be safely preserved in your account if you choose to reactivate in the future.</p>
  `;
  const html = renderAapthaTemplate({
    title,
    badge: 'Subscription Update',
    contentHtml,
    ctaText: 'Reactivate Subscription Anytime',
    ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/account/billing`,
    secondaryNote: 'Thank you for allowing Aaptha to be a part of your family care circle.'
  });
  const text = `Hi ${recipientName},\n\nYour Aaptha subscription to ${planName} has been cancelled. You have access until ${accessUntil}.`;

  return dispatchEmail({
    to,
    subject: 'Aaptha subscription cancellation confirmed',
    html,
    text,
    templateName: 'subscription_cancelled'
  });
}

// --------------------------------------------------------------------------
// 7. URGENT LEVEL 2+ HEALTH ALERT NOTIFICATION
// --------------------------------------------------------------------------
export async function sendUrgentAlertEmail({
  to,
  name,
  parentName,
  alertLevel,
  alertType,
  summary,
  actionUrl
}: {
  to: string;
  name?: string;
  parentName: string;
  alertLevel: 'level_1' | 'level_2' | 'level_3';
  alertType: string;
  summary: string;
  actionUrl: string;
}) {
  const recipientName = firstName(name);
  const levelLabel = alertLevel === 'level_3' ? 'CRITICAL ALERT' : 'IMPORTANT HEALTH UPDATE';
  const title = `${levelLabel}: ${esc(parentName)}`;
  // The summary can quote what the parent said on the call, so everything user-supplied is escaped.
  const contentHtml = `
    <p>Hi ${recipientName},</p>
    <p>Aaptha's AI companion detected a health update during the latest check-in call with <strong>${esc(parentName)}</strong>.</p>
    <div class="info-card" style="border-left: 4px solid #ef4444;">
      <div style="font-weight: 700; color: #b91c1c; margin-bottom: 6px;">${esc(alertType)}</div>
      <p style="margin: 0; font-size: 14px; color: #2b2621;">${esc(summary)}</p>
    </div>
    <p>Please review the full call transcript and verify that your parent is resting comfortably.</p>
  `;
  const html = renderAapthaTemplate({
    title,
    badge: levelLabel,
    contentHtml,
    ctaText: 'Review Call Transcript & Alert',
    ctaUrl: actionUrl,
    secondaryNote: 'If this is an emergency, please contact your parent or their primary doctor immediately.'
  });
  const text = `[${levelLabel}] ${parentName}\n\nType: ${alertType}\nSummary: ${summary}\n\nReview now: ${actionUrl}`;

  return dispatchEmail({
    to,
    subject: `🚨 [${levelLabel}] ${parentName} — ${alertType}`,
    html,
    text,
    templateName: 'urgent_alert'
  });
}

// --------------------------------------------------------------------------
// 8. SUBSCRIPTION ACTIVATED (sent right after checkout, including free-trial starts)
// --------------------------------------------------------------------------
export async function sendSubscriptionActivatedEmail({
  to,
  name,
  planName,
  monthlyAmount,
  paidToday,
  invoiceNumber,
  paymentMethod,
  trialDays,
  firstChargeDate,
  parentsIncluded
}: {
  to: string;
  name?: string;
  planName: string;
  monthlyAmount: number;
  paidToday: number;
  invoiceNumber: string;
  paymentMethod: string;
  /** Set when the plan starts with a free trial. */
  trialDays?: number;
  /** First (or next) charge date, already formatted. */
  firstChargeDate: string;
  parentsIncluded: number;
}) {
  const recipientName = firstName(name);
  const onTrial = Boolean(trialDays && trialDays > 0);
  const title = onTrial ? `Your ${planName} free trial has started` : `Your ${planName} subscription is active`;
  const rows: Array<[string, string]> = [
    ['Plan', esc(planName)],
    ['Paid today', formatMoney(paidToday)],
    [onTrial ? 'First monthly charge' : 'Next renewal', onTrial ? `${formatMoney(monthlyAmount)} on ${firstChargeDate}` : firstChargeDate],
    ['Payment method', esc(paymentMethod)],
    ['Reference', invoiceNumber]
  ];
  const contentHtml = `
    <p>Hi ${recipientName},</p>
    <p>${
      onTrial
        ? `Thank you for choosing Aaptha. Your <strong>${trialDays}-day free trial</strong> of <strong>${esc(planName)}</strong> is now active.`
        : `Thank you for choosing Aaptha. Your <strong>${esc(planName)}</strong> subscription is now active.`
    }</p>
    ${detailRows(rows)}
    <p>You can look after up to ${parentsIncluded} parent${parentsIncluded === 1 ? '' : 's'} on this plan. Add their details, set call times and pause calls anytime from your dashboard.</p>
    ${onTrial ? `<p style="font-size: 13px; color: #7a7267;">To avoid the first monthly charge, cancel before ${firstChargeDate} from Account → Billing.</p>` : ''}
  `;
  const html = renderAapthaTemplate({
    title,
    badge: 'Subscription Active',
    contentHtml,
    ctaText: 'Go to Dashboard',
    ctaUrl: appUrl('/dashboard'),
    secondaryNote: 'Your receipt is saved under Account → Billing.'
  });
  const text =
    `Hi ${name ? name.trim().split(/\s+/)[0] : 'there'},\n\n${title}.\n\nPlan: ${planName}\nPaid today: ${formatMoney(paidToday)}\n` +
    `${onTrial ? `First monthly charge: ${formatMoney(monthlyAmount)} on ${firstChargeDate}` : `Next renewal: ${firstChargeDate}`}\n` +
    `Payment method: ${paymentMethod}\nReference: ${invoiceNumber}\n\nDashboard: ${appUrl('/dashboard')}\nBilling: ${appUrl('/account/billing')}`;

  return dispatchEmail({
    to,
    subject: onTrial ? `Your Aaptha free trial has started (${planName})` : `Your Aaptha subscription is active (${planName})`,
    html,
    text,
    templateName: 'subscription_activated'
  });
}

// --------------------------------------------------------------------------
// 9. SUBSCRIPTION STOPPED AFTER FAILED PAYMENTS (Razorpay gave up)
// --------------------------------------------------------------------------
export async function sendSubscriptionStoppedEmail({
  to,
  name,
  planName,
  amount,
  accessUntil
}: {
  to: string;
  name?: string;
  planName: string;
  amount: number;
  /** End of the period that was already paid for; when it is in the past the calls have already stopped. */
  accessUntil?: Date;
}) {
  const recipientName = firstName(name);
  const stillActive = Boolean(accessUntil && accessUntil.getTime() > Date.now());
  const title = 'Your Aaptha subscription has been stopped';
  const contentHtml = `
    <p>Hi ${recipientName},</p>
    <p>We could not collect the <strong>${formatMoney(amount)}</strong> payment for your <strong>${esc(planName)}</strong> plan after several attempts, so the subscription has been stopped.</p>
    <p>${
      stillActive
        ? `Your parents' daily check-in calls continue until <strong>${formatEmailDate(accessUntil as Date)}</strong>, the end of the period you already paid for. After that the calls stop.`
        : `Your parents' daily check-in calls have paused. Their profiles, medicines and call history are safe.`
    }</p>
    <p>To restart, choose a plan again and make sure your card or UPI mandate has enough balance.</p>
  `;
  const html = renderAapthaTemplate({
    title,
    badge: 'Payment Failed',
    contentHtml,
    ctaText: 'Choose a Plan',
    ctaUrl: appUrl('/account/billing'),
    secondaryNote: 'If you think this is a mistake, just reply to this email and we will look into it.'
  });
  const text =
    `Hi ${name ? name.trim().split(/\s+/)[0] : 'there'},\n\nWe could not collect the ${formatMoney(amount)} payment for your ${planName} plan after several attempts, so the subscription has been stopped.\n` +
    `${stillActive ? `Calls continue until ${formatEmailDate(accessUntil as Date)}.` : "Your parents' daily calls have paused."}\n\nChoose a plan: ${appUrl('/account/billing')}`;

  return dispatchEmail({
    to,
    subject: 'Your Aaptha subscription has been stopped (payment failed)',
    html,
    text,
    templateName: 'subscription_stopped'
  });
}

// --------------------------------------------------------------------------
// 10. TRIAL REMINDERS (free trial ending / ended, paid trial about to convert)
// --------------------------------------------------------------------------
export type TrialEmailInput =
  | { variant: 'free_ending'; to: string; name?: string; endsOn: Date }
  | { variant: 'free_ended'; to: string; name?: string; endedOn: Date }
  | { variant: 'paid_ending'; to: string; name?: string; planName: string; amount: number; chargeOn: Date };

export async function sendTrialEmail(input: TrialEmailInput) {
  const recipientName = firstName(input.name);
  const plainName = input.name ? input.name.trim().split(/\s+/)[0] : 'there';
  const { solo, family } = PLANS;
  const planLinePlain =
    `${solo.name} is ${formatMoney(solo.priceMonthly)} a month for one parent and ${family.name} is ${formatMoney(family.priceMonthly)} a month for two;` +
    ` both start with a ${family.trialDays}-day free trial.`;
  const planLine = esc(planLinePlain);

  let title: string;
  let badge: string;
  let subject: string;
  let bodyHtml: string;
  let bodyText: string;
  let ctaText: string;

  if (input.variant === 'free_ending') {
    const date = formatEmailDate(input.endsOn);
    title = `Your free trial ends on ${date}`;
    badge = 'Free Trial';
    subject = `Your Aaptha free trial ends on ${date}`;
    ctaText = 'Choose a Plan';
    bodyHtml = `
      <p>Your free trial of Aaptha ends on <strong>${date}</strong>. After that, the daily check-in calls to your parent will stop.</p>
      <p>To keep the calls going without a break, choose a plan before then. ${planLine}</p>`;
    bodyText = `Your free trial of Aaptha ends on ${date}. After that the daily check-in calls to your parent will stop. ${planLinePlain}`;
  } else if (input.variant === 'free_ended') {
    title = 'Your free trial has ended';
    badge = 'Free Trial Ended';
    subject = 'Your Aaptha free trial has ended: calls have paused';
    ctaText = 'Restart Daily Calls';
    bodyHtml = `
      <p>Your free trial of Aaptha ended on <strong>${formatEmailDate(input.endedOn)}</strong>, so the daily check-in calls to your parent have paused.</p>
      <p>Everything you set up (your parent's profile, medicines and call history) is safe. Choose a plan to restart the calls. ${planLine}</p>`;
    bodyText = `Your free trial of Aaptha ended on ${formatEmailDate(input.endedOn)}, so the daily calls to your parent have paused. Your parent's profile, medicines and history are safe. Choose a plan to restart the calls.`;
  } else {
    const date = formatEmailDate(input.chargeOn);
    title = `Your free trial ends on ${date}`;
    badge = 'Trial Ending';
    subject = `Your Aaptha trial ends on ${date}: ${formatMoney(input.amount)} will be charged`;
    ctaText = 'Manage Subscription';
    bodyHtml = `
      <p>Your free trial of <strong>${esc(input.planName)}</strong> ends on <strong>${date}</strong>. On that day we will charge <strong>${formatMoney(input.amount)}</strong>, and then once a month.</p>
      <p>If you would rather not continue, cancel before ${date} from Account → Billing and you will not be charged the monthly amount. Your parents' calls keep running until then.</p>`;
    bodyText = `Your free trial of ${input.planName} ends on ${date}. On that day we will charge ${formatMoney(input.amount)}, then once a month. To avoid the charge, cancel before ${date} from Account > Billing.`;
  }

  const html = renderAapthaTemplate({
    title,
    badge,
    contentHtml: `<p>Hi ${recipientName},</p>${bodyHtml}`,
    ctaText,
    ctaUrl: appUrl('/account/billing'),
    secondaryNote: 'Questions? Just reply to this email.'
  });

  return dispatchEmail({
    to: input.to,
    subject,
    html,
    text: `Hi ${plainName},\n\n${bodyText}\n\nBilling: ${appUrl('/account/billing')}`,
    templateName: `trial_${input.variant}`
  });
}

// --------------------------------------------------------------------------
// CARE SUMMARY (daily / weekly / monthly), only while WhatsApp isn't set up
// --------------------------------------------------------------------------
export async function sendCareSummaryEmail({
  to,
  name,
  period,
  parentNames,
  text,
  actionUrl
}: {
  to: string;
  name?: string;
  period: 'daily' | 'weekly' | 'monthly';
  parentNames: string;
  text: string;
  actionUrl: string;
}) {
  const label = period === 'daily' ? 'Today' : period === 'weekly' ? 'This week' : 'This month';
  const paragraphs = text
    .split(/\n+/)
    .filter(Boolean)
    .map(line => `<p style="margin: 0 0 10px;">${esc(line)}</p>`)
    .join('');
  const html = renderAapthaTemplate({
    title: `${label} with ${esc(parentNames)}`,
    badge: `${period.toUpperCase()} SUMMARY`,
    contentHtml: `
      <p>Hi ${firstName(name)},</p>
      <p>Here is ${label.toLowerCase()} from the check-in calls with <strong>${esc(parentNames)}</strong>.</p>
      <div class="info-card">${paragraphs}</div>
    `,
    ctaText: 'Open the dashboard',
    ctaUrl: actionUrl,
    secondaryNote: 'Change how often you get these in Account settings.'
  });
  return dispatchEmail({
    to,
    subject: `${label} with ${parentNames}`,
    html,
    text: `${label} with ${parentNames}\n\n${text}\n\n${actionUrl}`,
    templateName: `care_summary_${period}`
  });
}

// --------------------------------------------------------------------------
// FAMILY INVITE (a sibling / relative asked to help look after a parent)
// --------------------------------------------------------------------------
export async function sendFamilyInviteEmail({
  to,
  name,
  inviterName,
  parentName,
  role,
  inviteUrl
}: {
  to: string;
  name?: string;
  inviterName: string;
  parentName: string;
  role: 'viewer' | 'co_manager';
  inviteUrl: string;
}) {
  const what = role === 'co_manager' ? 'see the calls and help manage them' : 'see how the calls are going';
  const html = renderAapthaTemplate({
    title: `${esc(inviterName)} invited you to help look after ${esc(parentName)}`,
    badge: 'FAMILY INVITE',
    contentHtml: `
      <p>Hi ${firstName(name)},</p>
      <p><strong>${esc(inviterName)}</strong> uses Aaptha for daily check-in calls with <strong>${esc(parentName)}</strong>, and has invited you to ${what}.</p>
      <p>You will get your own updates after each call, and you can say "I'm on it" if something needs attention, so nobody carries it alone.</p>
    `,
    ctaText: 'Accept the invite',
    ctaUrl: inviteUrl,
    secondaryNote: 'If you were not expecting this, you can ignore this email.'
  });
  return dispatchEmail({
    to,
    subject: `${inviterName} invited you to help look after ${parentName}`,
    html,
    text: `${inviterName} invited you to help look after ${parentName} on Aaptha.\n\nAccept: ${inviteUrl}`,
    templateName: 'family_invite'
  });
}
