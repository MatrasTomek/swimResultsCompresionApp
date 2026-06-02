import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { mergeZawodnicy, processLxfFiles, ZawodnicyMap } from '@/lib/lenex';

const DATA_FILE = path.join(process.cwd(), 'data', 'zawodnicy.json');

async function loadExisting(): Promise<ZawodnicyMap> {
  try {
    const text = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(text) as ZawodnicyMap;
  } catch {
    return {};
  }
}

async function saveData(data: ZawodnicyMap): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, '\t'), 'utf-8');
}

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

    const { result: newData, errors } = processLxfFiles(files, clubName);
    const newAthleteCount = Object.keys(newData).length;

    if (newAthleteCount === 0 && errors.length === 0) {
      return NextResponse.json(
        { error: `Nie znaleziono zawodników dla klubu "${clubName}" w przesłanych plikach.` },
        { status: 404 }
      );
    }

    const existing = await loadExisting();
    const merged = mergeZawodnicy(existing, newData);
    await saveData(merged);

    const totalAthletes = Object.keys(merged).length;
    const json = JSON.stringify(merged, null, '\t');
    const filename = encodeURIComponent(`zawodnicy_${clubName}.json`);

    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Athlete-Count': String(totalAthletes),
        'X-New-Athlete-Count': String(newAthleteCount),
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
