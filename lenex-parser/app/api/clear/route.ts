import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

const DATA_FILE = path.join(process.cwd(), 'data', 'zawodnicy.json');

export async function DELETE(): Promise<NextResponse> {
  try {
    await fs.unlink(DATA_FILE);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ ok: true }); // already empty
    }
    return NextResponse.json(
      { error: `Błąd: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
