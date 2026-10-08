import { NextResponse } from 'next/server';

/** The life-stories book was retired on 2026-10-08 (the weekly chat that fed it isn't offered). Nothing is stored or shown. */
const RETIRED = () => NextResponse.json({ error: 'The life-stories book is no longer offered.', code: 'RETIRED' }, { status: 410 });

export async function GET() {
  return RETIRED();
}

export async function PATCH() {
  return RETIRED();
}
