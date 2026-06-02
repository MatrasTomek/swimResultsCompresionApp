import { NextRequest, NextResponse } from 'next/server';
import { getClubAthletes } from '@/lib/lenex';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData();
    const clubName = (formData.get('clubName') as string | null)?.trim() ?? '';

    if (!clubName) {
      return NextResponse.json({ error: 'Brak nazwy klubu' }, { status: 400 });
    }

    const lxfEntries = formData.getAll('files') as File[];
    if (!lxfEntries.length) {
      return NextResponse.json({ error: 'Brak plików .lxf' }, { status: 400 });
    }

    const files: { name: string; buffer: Buffer }[] = [];
    for (const file of lxfEntries) {
      const ab = await file.arrayBuffer();
      files.push({ name: file.name, buffer: Buffer.from(ab) });
    }

    const { athletes, errors } = getClubAthletes(files, clubName);

    return NextResponse.json({ athletes, errors });
  } catch (err) {
    console.error('[/api/athletes]', err);
    return NextResponse.json(
      { error: `Błąd serwera: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
