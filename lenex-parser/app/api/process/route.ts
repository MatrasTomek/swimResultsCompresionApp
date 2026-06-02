import { NextRequest, NextResponse } from 'next/server';
import { processLxfFiles } from '@/lib/lenex';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData();
    const clubName = (formData.get('clubName') as string | null)?.trim() ?? '';

    if (!clubName) {
      return NextResponse.json({ error: 'Brak nazwy klubu' }, { status: 400 });
    }

    const fileEntries = formData.getAll('files') as File[];
    if (!fileEntries.length) {
      return NextResponse.json({ error: 'Brak plików .lxf' }, { status: 400 });
    }

    const files: { name: string; buffer: Buffer }[] = [];
    for (const file of fileEntries) {
      const arrayBuffer = await file.arrayBuffer();
      files.push({ name: file.name, buffer: Buffer.from(arrayBuffer) });
    }

    const { result, errors } = processLxfFiles(files, clubName);
    const athleteCount = Object.keys(result).length;

    if (athleteCount === 0 && errors.length === 0) {
      return NextResponse.json(
        { error: `Nie znaleziono zawodników dla klubu "${clubName}" w przesłanych plikach.` },
        { status: 404 }
      );
    }

    const json = JSON.stringify(result, null, '\t');
    const filename = encodeURIComponent(`zawodnicy_${clubName}.json`);

    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Athlete-Count': String(athleteCount),
        'X-Errors': errors.length ? JSON.stringify(errors) : '',
      },
    });
  } catch (err) {
    console.error('[/api/process]', err);
    return NextResponse.json(
      { error: `Błąd serwera: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
