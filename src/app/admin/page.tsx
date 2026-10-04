import type { Metadata } from 'next';
import { Navbar } from '@/components/Navbar';
import { requireAdminPage } from '@/lib/admin';
import { getAdminStats, AdminCustomer, PlanBucket } from '@/lib/adminStats';
import { Users, UserCheck, PhoneCall, PhoneIncoming, IndianRupee, HeartHandshake, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false }
};

const BUCKET_LABEL: Record<PlanBucket, string> = {
  free_active: 'Free trial (running)',
  free_ended: 'Free trial (ended)',
  solo: 'Solo Care',
  family: 'Family Care',
  extended: 'Extended Family'
};

const STATUS_BADGE: Record<string, string> = {
  active: 'badge-green',
  trial: 'badge-teal',
  trialing: 'badge-teal',
  past_due: 'badge-red',
  cancelled: 'badge-amber',
  ended: 'badge-neutral'
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Paying',
  trial: 'Free trial',
  trialing: 'Paid trial',
  past_due: 'Payment overdue',
  cancelled: 'Cancelled',
  ended: 'Trial ended'
};

const IST = 'Asia/Kolkata';
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: IST });
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const CALL_STATUS_ROWS: Array<[string, string]> = [
  ['answered', 'Answered'],
  ['unanswered', 'No answer'],
  ['busy', 'Busy'],
  ['failed', 'Failed'],
  ['placed', 'Ringing / waiting for result'],
  ['scheduled', 'Scheduled']
];

function CustomerRow({ c }: { c: AdminCustomer }) {
  return (
    <tr>
      <td>
        <strong>{c.name}</strong>
        <div style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>{c.email}</div>
      </td>
      <td>{fmtDate(c.createdAt)}</td>
      <td>
        {c.planLabel}{' '}
        <span className={`badge ${STATUS_BADGE[c.subscriptionStatus] || 'badge-neutral'}`}>
          {STATUS_LABEL[c.subscriptionStatus] || c.subscriptionStatus}
        </span>
      </td>
      <td>{c.trialDaysLeft === null ? '—' : `${c.trialDaysLeft} day${c.trialDaysLeft === 1 ? '' : 's'}`}</td>
      <td>{c.parents}</td>
      <td>{c.calls7d}</td>
      <td>{c.lastCallAt ? fmtDateTime(c.lastCallAt) : '—'}</td>
    </tr>
  );
}

export default async function AdminPage() {
  await requireAdminPage();
  const s = await getAdminStats();
  const maxDay = Math.max(1, ...s.calls.days.map((d) => d.total));
  const paidCustomers = s.plans.payingActive;

  return (
    <>
      <Navbar />
      <main id="main" className="wrap dash-page admin-page">
        <div className="dash-head" style={{ marginBottom: '20px' }}>
          <div>
            <span className="eyebrow">Admin · read only</span>
            <h1 style={{ fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', letterSpacing: '-0.03em' }}>Business overview</h1>
            <p style={{ color: 'var(--ink-muted)', marginTop: '6px' }}>
              Live from the database · updated {fmtDateTime(s.generatedAt)} IST · test accounts are left out
            </p>
          </div>
        </div>

        <div className="stat-grid admin">
          <div className="stat">
            <span className="panel-label"><Users size={13} /> Customers</span>
            <div className="stat-value">{s.customers.total}</div>
            <p>{s.customers.new7d} new this week · {s.customers.new30d} in 30 days</p>
          </div>
          <div className="stat">
            <span className="panel-label"><UserCheck size={13} /> Paying now</span>
            <div className="stat-value" style={{ color: 'var(--green)' }}>{paidCustomers}</div>
            <p>{s.plans.onPaidTrial} more on a paid-plan trial</p>
          </div>
          <div className="stat">
            <span className="panel-label"><IndianRupee size={13} /> Monthly revenue</span>
            <div className="stat-value">{inr(s.plans.estimatedMrr)}</div>
            <p>Estimate: paying customers × plan price</p>
          </div>
          <div className="stat">
            <span className="panel-label"><HeartHandshake size={13} /> Parents</span>
            <div className="stat-value">{s.parents.active}</div>
            <p>{s.parents.paused} paused · {s.parents.archived} archived</p>
          </div>
          <div className="stat">
            <span className="panel-label"><PhoneCall size={13} /> Calls today</span>
            <div className="stat-value" style={{ color: 'var(--teal)' }}>{s.calls.today}</div>
            <p>{s.calls.last30} in the last 30 days</p>
          </div>
          <div className="stat">
            <span className="panel-label"><PhoneIncoming size={13} /> Answer rate</span>
            <div className="stat-value" style={{ color: 'var(--green)' }}>
              {s.calls.answerRatePct === null ? '—' : `${s.calls.answerRatePct}%`}
            </div>
            <p>{s.calls.answered30} answered, last 30 days</p>
            <div className="meter" aria-hidden="true"><i style={{ width: `${s.calls.answerRatePct ?? 0}%`, background: 'var(--green)' }} /></div>
          </div>
        </div>

        <section className="panel" aria-labelledby="engagement-title">
          <div className="panel-head">
            <div>
              <h3 id="engagement-title">Is it working for families?</h3>
              <p>Active = opened the dashboard in the last 7 days. Acted on = someone said &ldquo;I&apos;m on it&rdquo; or recorded what happened.</p>
            </div>
          </div>
          <div className="kv">
            <div>
              <span>Families active this week</span>
              <strong>{s.engagement.activeFamilies7d} of {s.engagement.familiesWithParents}</strong>
            </div>
            <div>
              <span>Alerts acted on (30 days)</span>
              <strong>
                {s.engagement.alertsNeedingAction30
                  ? `${Math.round((s.engagement.alertsActedOn30 / s.engagement.alertsNeedingAction30) * 100)}% (${s.engagement.alertsActedOn30} of ${s.engagement.alertsNeedingAction30})`
                  : 'No alerts'}
              </strong>
            </div>
            <div>
              <span>Emergency escalations (30 days)</span>
              <strong>{s.engagement.escalations30.total} · {s.engagement.escalations30.handled} handled · {s.engagement.escalations30.exhausted} nobody answered</strong>
            </div>
            <div>
              <span>Parents&apos; own consent</span>
              <strong>{s.engagement.parentConsent.given} yes · {s.engagement.parentConsent.pending} not asked yet · {s.engagement.parentConsent.said_no} said no</strong>
            </div>
            <div>
              <span>Siblings and carers joined</span>
              <strong>{s.engagement.familyMembers}</strong>
            </div>
          </div>
          {s.engagement.cancelReasons.length > 0 && (
            <>
              <h4 style={{ marginTop: '16px', marginBottom: '6px', fontSize: '0.95rem' }}>Why people cancelled</h4>
              <ul style={{ paddingLeft: '18px', display: 'grid', gap: '4px', fontSize: '0.9rem' }}>
                {s.engagement.cancelReasons.map((c, i) => <li key={i}>{fmtDate(c.at)}: {c.reason}</li>)}
              </ul>
            </>
          )}
        </section>

        <section className="panel" aria-labelledby="calls-title">
          <div className="panel-head">
            <div>
              <h3 id="calls-title">Calls per day</h3>
              <p>Last 14 days, Indian time</p>
            </div>
          </div>
          {s.calls.last30 === 0 ? (
            <p style={{ color: 'var(--ink-muted)' }}>
              No calls yet. They will appear here once Saathi calling is switched on.
            </p>
          ) : (
            <>
              <div className="admin-bars" role="img" aria-label="Calls per day, last 14 days, split into answered, not answered and waiting">
                {s.calls.days.map((d) => (
                  <div key={d.date} className="admin-bar">
                    <span>{d.total || ''}</span>
                    <div className="admin-bar-stack" style={{ height: d.total ? `${Math.max((d.total / maxDay) * 140, 6)}px` : '3px' }}>
                      <i style={{ height: `${(d.answered / Math.max(d.total, 1)) * 100}%`, background: 'var(--teal)' }} />
                      <i style={{ height: `${(d.notAnswered / Math.max(d.total, 1)) * 100}%`, background: 'var(--gold)' }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="admin-bar-days">
                {s.calls.days.map((d) => <span key={d.date}>{d.label}</span>)}
              </div>
              <div className="legend" style={{ marginTop: '16px' }}>
                <span><i style={{ background: 'var(--teal)' }} />Answered</span>
                <span><i style={{ background: 'var(--gold)' }} />No answer, busy or failed</span>
                <span><i style={{ background: 'var(--line-subtle)' }} />Waiting for result</span>
              </div>
            </>
          )}
        </section>

        <div className="admin-two">
          <section className="panel" aria-labelledby="plans-title">
            <div className="panel-head"><div><h3 id="plans-title">Customers by plan</h3></div></div>
            <dl className="admin-kv">
              {(Object.keys(BUCKET_LABEL) as PlanBucket[]).map((k) => (
                <div key={k}><dt>{BUCKET_LABEL[k]}</dt><dd>{s.plans.buckets[k]}</dd></div>
              ))}
              <div><dt>Payment overdue</dt><dd>{s.plans.pastDue}</dd></div>
              <div><dt>Cancelled, still in paid period</dt><dd>{s.plans.cancelling}</dd></div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="status-title">
            <div className="panel-head"><div><h3 id="status-title">Call results, last 30 days</h3></div></div>
            <dl className="admin-kv">
              {CALL_STATUS_ROWS.map(([key, label]) => (
                <div key={key}><dt>{label}</dt><dd>{s.calls.byStatus30[key] || 0}</dd></div>
              ))}
            </dl>
          </section>
        </div>

        <section className="panel" aria-labelledby="customers-title">
          <div className="panel-head">
            <div>
              <h3 id="customers-title">Customers</h3>
              <p>Newest first{s.customers.total > s.customerList.length ? ` · showing ${s.customerList.length} of ${s.customers.total}` : ''}</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Customer</th><th>Joined</th><th>Plan</th><th>Trial left</th>
                  <th>Parents</th><th>Calls (7d)</th><th>Last call</th>
                </tr>
              </thead>
              <tbody>
                {s.customerList.length === 0 ? (
                  <tr><td colSpan={7} style={{ color: 'var(--ink-muted)' }}>No customers yet.</td></tr>
                ) : s.customerList.map((c) => <CustomerRow key={c.id} c={c} />)}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel" aria-labelledby="alerts-title">
          <div className="panel-head">
            <div>
              <h3 id="alerts-title"><ShieldCheck size={16} style={{ verticalAlign: '-2px' }} /> Recent alerts</h3>
              <p>Latest 20 across all customers · level 0 fine … 4 emergency</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>When</th><th>Level</th><th>Alert</th><th>Parent</th><th>Customer</th></tr>
              </thead>
              <tbody>
                {s.alerts.length === 0 ? (
                  <tr><td colSpan={5} style={{ color: 'var(--ink-muted)' }}>No alerts yet.</td></tr>
                ) : s.alerts.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDateTime(a.createdAt)}</td>
                    <td><span className={`badge ${a.level >= 4 ? 'badge-red' : a.level >= 2 ? 'badge-amber' : 'badge-neutral'}`}>Level {a.level}</span></td>
                    <td>{a.title}</td>
                    <td>{a.parentName}</td>
                    <td>{a.customerName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
