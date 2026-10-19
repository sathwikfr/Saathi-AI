import React from 'react';
import { Check, Minus, Heart } from 'lucide-react';
import { Reveal } from '@/components/Reveal';
import { WordReveal } from '@/components/motion/WordReveal';
import { PLANS, FREE_TRIAL_DAYS } from '@/lib/plans';
import s from './home.module.css';
import x from './compare.module.css';

/**
 * "Same worry. Much less effort.": Aaptha against the usual ways families keep
 * an eye on their parents. A real table on wide screens, with the Aaptha column
 * raised like a featured card; on phones each row becomes its own small card. The rows arrive one by
 * one and Aaptha's ticks pop in after them (GsapScroll's data-stagger / data-pop).
 */

type Cell = true | false | string;

const COLUMNS = ['Calling yourself', 'A hired caretaker', 'Reminder app'] as const;

const ROWS: { label: string; us: Cell; others: [Cell, Cell, Cell] }[] = [
  { label: 'Asks about every medicine, every day', us: true, others: ['When you remember', true, 'If they open it'] },
  { label: 'Works on any phone, nothing to install', us: true, others: [true, true, false] },
  { label: 'In their own language', us: true, others: [true, 'Depends', false] },
  { label: 'A written record you can look back on', us: true, others: [false, false, 'Partly'] },
  { label: 'Tells you when something seems off', us: true, others: [false, 'Depends', false] },
  { label: 'Cost', us: `From ₹${PLANS.essential.priceMonthly}/month, ${FREE_TRIAL_DAYS} days free`, others: ['Your time, daily', 'A monthly salary', 'Free'] },
];

function Value({ v, ours }: { v: Cell; ours?: boolean }) {
  if (v === true) {
    return <span className={`${x.mark} ${ours ? x.markUs : x.markYes}`} data-pop={ours || undefined}><Check size={14} strokeWidth={3} /><span className="sr-only">Yes</span></span>;
  }
  if (v === false) {
    return <span className={`${x.mark} ${x.markNo}`}><Minus size={14} strokeWidth={2.5} /><span className="sr-only">No</span></span>;
  }
  return <span className={ours ? x.textUs : x.text}>{v}</span>;
}

export function CompareSection() {
  return (
    <section id="why" className={`section ${s.alt}`}>
      <div className="wrap">
        <Reveal className={s.head}>
          <WordReveal>Same worry. <span className={s.grad}>Much less effort.</span></WordReveal>
          <p>How a daily Saathi call compares with the usual ways families keep an eye on their parents.</p>
        </Reveal>

        <Reveal variant="scale">
          <div className={x.frame} data-spot>
            <table className={x.table}>
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">What matters</span></th>
                  <th scope="col" className={x.us}>
                    <span className={x.brand}><span className={x.brandHeart}><Heart size={12} fill="currentColor" strokeWidth={0} /></span>Aaptha</span>
                  </th>
                  {COLUMNS.map((col) => <th key={col} scope="col">{col}</th>)}
                </tr>
              </thead>
              <tbody data-stagger>
                {ROWS.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td className={x.us} data-col="Aaptha"><Value v={r.us} ours /></td>
                    {r.others.map((v, i) => (
                      <td key={COLUMNS[i]} data-col={COLUMNS[i]}><Value v={v} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
