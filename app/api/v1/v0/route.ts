import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const t = searchParams.get('t');
  console.log(t);
  return NextResponse.json({ success: true, t });
}
