import { NextResponse } from 'next/server';

/**
 * "Saathi.vcf": the contact card families save on their parent's phone, so every call
 * shows up as "Saathi (Aaptha)" from the same number instead of an unknown caller.
 * Public: it only contains our own calling and support numbers.
 */
export async function GET() {
  const calls = process.env.SARVAM_AGENT_PHONE_NUMBER?.trim();
  if (!calls) {
    return NextResponse.json({ error: "Saathi's calling number isn't set up yet." }, { status: 503 });
  }
  const support = process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim();
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:Saathi;;;;',
    'FN:Saathi (Aaptha)',
    'ORG:Aaptha',
    `TEL;TYPE=VOICE,WORK:${calls}`,
    ...(support ? [`TEL;TYPE=VOICE,OTHER:${support}`] : []),
    'NOTE:Saathi calls about medicines. Saathi never asks for money\\, OTPs\\, PINs or bank details.',
    'END:VCARD'
  ];
  return new NextResponse(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': 'attachment; filename="Saathi.vcf"',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
