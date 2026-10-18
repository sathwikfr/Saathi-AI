/**
 * Who runs the service: legal name, registered address, GSTIN and phone, from env (NEXT_PUBLIC_BUSINESS_NAME,
 * NEXT_PUBLIC_BUSINESS_ADDRESS, NEXT_PUBLIC_GSTIN, NEXT_PUBLIC_SUPPORT_PHONE). Shows only what is set, so
 * nothing is ever invented; renders nothing until the business is registered and the keys are filled in.
 */
export function BusinessDetails({ style }: { style?: React.CSSProperties }) {
  const parts = [
    process.env.NEXT_PUBLIC_BUSINESS_NAME,
    process.env.NEXT_PUBLIC_BUSINESS_ADDRESS,
    process.env.NEXT_PUBLIC_GSTIN && `GSTIN ${process.env.NEXT_PUBLIC_GSTIN}`,
    process.env.NEXT_PUBLIC_SUPPORT_PHONE && `Phone ${process.env.NEXT_PUBLIC_SUPPORT_PHONE}`
  ].filter(Boolean);
  return parts.length ? <p style={style}>{parts.join(' · ')}</p> : null;
}
