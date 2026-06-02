import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { mergeZawodnicy, processLxfFiles, ZawodnicyMap } from '@/lib/lenex';
import { parseXlsx } from '@/lib/xlsx-parser';

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

    const lxfEntries = formData.getAll('files') as File[];
    const xlsxEntries = formData.getAll('xlsxFiles') as File[];

    if (!lxfEntries.length && !xlsxEntries.length) {
      return NextResponse.json({ error: 'Brak plików do przetworzenia' }, { status: 400 });
    }

    // Optional athlete key filter for .lxf files
    const selectedRaw = formData.get('selectedAthletes') as string | null;
    const filterKeys = selectedRaw ? new Set<string>(JSON.parse(selectedRaw) as string[]) : undefined;

    const newData: ZawodnicyMap = {};
    const errors: string[] = [];
    const timestamp = new Date().toISOString();

    // Process .lxf files
    if (lxfEntries.length) {
      const lxfFiles: { name: string; buffer: Buffer }[] = [];
      for (const file of lxfEntries) {
        const ab = await file.arrayBuffer();
        lxfFiles.push({ name: file.name, buffer: Buffer.from(ab) });
      }
      const { result, errors: lxfErrors } = processLxfFiles(lxfFiles, clubName, filterKeys);
      Object.assign(newData, result);
      errors.push(...lxfErrors);
    }

    // Process .xlsx files — each has a corresponding imie/nazwisko by index
    const xlsxImie = formData.getAll('xlsxImie') as string[];
    const xlsxNazwisko = formData.getAll('xlsxNazwisko') as string[];

    for (let i = 0; i < xlsxEntries.length; i++) {
      const file = xlsxEntries[i];
      const imie = (xlsxImie[i] ?? '').trim();
      const nazwisko = (xlsxNazwisko[i] ?? '').trim();

      if (!imie || !nazwisko) {
        errors.push(`${file.name}: brak imienia lub nazwiska zawodnika`);
        continue;
      }

      try {
        const ab = await file.arrayBuffer();
        parseXlsx(Buffer.from(ab), imie, nazwisko, clubName, newData, timestamp);
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

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
