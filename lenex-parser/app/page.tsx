'use client';

import { useCallback, useRef, useState } from 'react';

type Status = 'idle' | 'loading' | 'done' | 'error';

type FileType = 'lxf' | 'xlsx';

interface FileEntry {
  file: File;
  type: FileType;
  imie: string;
  nazwisko: string;
}

export default function Home() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [clubName, setClubName] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const lxfInputRef = useRef<HTMLInputElement>(null);
  const xlsxInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter(
      (f) =>
        f.name.toLowerCase().endsWith('.lxf') ||
        f.name.toLowerCase().endsWith('.xlsx')
    );
    setEntries((prev) => {
      const existing = new Set(prev.map((e) => e.file.name));
      const newEntries: FileEntry[] = arr
        .filter((f) => !existing.has(f.name))
        .map((f) => ({
          file: f,
          type: f.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'lxf',
          imie: '',
          nazwisko: '',
        }));
      return [...prev, ...newEntries];
    });
  }, []);

  const removeEntry = (name: string) =>
    setEntries((prev) => prev.filter((e) => e.file.name !== name));

  const updateEntry = (name: string, field: 'imie' | 'nazwisko', value: string) =>
    setEntries((prev) =>
      prev.map((e) => (e.file.name === name ? { ...e, [field]: value } : e))
    );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entries.length || !clubName.trim()) return;

    // Validate: each xlsx entry must have imie + nazwisko
    const missingName = entries.filter(
      (en) => en.type === 'xlsx' && (!en.imie.trim() || !en.nazwisko.trim())
    );
    if (missingName.length) {
      setStatus('error');
      setMessage(
        `Podaj imię i nazwisko dla: ${missingName.map((e) => e.file.name).join(', ')}`
      );
      return;
    }

    setStatus('loading');
    setMessage('');

    const form = new FormData();
    form.append('clubName', clubName.trim());

    const xlsxEntries = entries.filter((en) => en.type === 'xlsx');

    entries
      .filter((en) => en.type === 'lxf')
      .forEach((en) => form.append('files', en.file));

    xlsxEntries.forEach((en) => {
      form.append('xlsxFiles', en.file);
      form.append('xlsxImie', en.imie.trim());
      form.append('xlsxNazwisko', en.nazwisko.trim());
    });

    try {
      const res = await fetch('/api/process', { method: 'POST', body: form });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? res.statusText);
      }

      const totalCount = res.headers.get('X-Athlete-Count') ?? '?';
      const newCount = res.headers.get('X-New-Athlete-Count') ?? '?';
      const errorsRaw = res.headers.get('X-Errors') ?? '';
      const blob = await res.blob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zawodnicy_${clubName.trim()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      let msg = `Zapisano i pobrano JSON. Nowi/zaktualizowani zawodnicy z pliku: ${newCount}. Łącznie w bazie: ${totalCount} zawodnika/ów z klubu „${clubName.trim()}".`;
      if (errorsRaw) {
        const errs: string[] = JSON.parse(errorsRaw);
        msg += ` Błędy (${errs.length}): ${errs.join('; ')}`;
      }
      setStatus('done');
      setMessage(msg);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClear = async () => {
    if (!confirm('Czy na pewno chcesz wyczyścić całą bazę danych zawodników?')) return;
    try {
      const res = await fetch('/api/clear', { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? res.statusText);
      }
      setStatus('done');
      setMessage('Baza danych została wyczyszczona.');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const xlsxMissingName = entries.some(
    (en) => en.type === 'xlsx' && (!en.imie.trim() || !en.nazwisko.trim())
  );
  const canSubmit =
    entries.length > 0 &&
    clubName.trim().length > 0 &&
    !xlsxMissingName &&
    status !== 'loading';

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-6">
      <main className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-2xl shadow-md p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            LENEX → JSON
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Wgraj pliki <code>.lxf</code> lub <code>.xlsx</code> i podaj nazwę klubu,
            aby pobrać plik <code>zawodnicy.json</code>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => lxfInputRef.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && lxfInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors
              ${isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                : 'border-zinc-300 dark:border-zinc-700 hover:border-blue-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
          >
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
              Przeciągnij pliki <span className="font-semibold">.lxf</span> lub{' '}
              <span className="font-semibold">.xlsx</span> tutaj
            </p>
            <p className="mt-1 text-xs text-zinc-400">lub wybierz ręcznie:</p>
            <div className="mt-3 flex justify-center gap-3">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); lxfInputRef.current?.click(); }}
                className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 py-1.5 text-xs
                           font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                📄 Dodaj .lxf
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); xlsxInputRef.current?.click(); }}
                className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 py-1.5 text-xs
                           font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                📈 Dodaj .xlsx
              </button>
            </div>
            <input
              ref={lxfInputRef}
              type="file"
              accept=".lxf"
              multiple
              className="sr-only"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
            <input
              ref={xlsxInputRef}
              type="file"
              accept=".xlsx"
              multiple
              className="sr-only"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>

          {/* File list */}
          {entries.length > 0 && (
            <ul className="space-y-2 text-sm">
              {entries.map((en) => (
                <li
                  key={en.file.name}
                  className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate text-zinc-700 dark:text-zinc-200">
                      {en.type === 'xlsx' ? '📈' : '📄'} {en.file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeEntry(en.file.name)}
                      className="ml-3 shrink-0 text-zinc-400 hover:text-red-500 transition-colors"
                      aria-label={`Usuń ${en.file.name}`}
                    >
                      ✕
                    </button>
                  </div>

                  {en.type === 'xlsx' && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Imię"
                        value={en.imie}
                        onChange={(ev) => updateEntry(en.file.name, 'imie', ev.target.value)}
                        className="flex-1 min-w-0 rounded-md border border-zinc-300 dark:border-zinc-600
                                   bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100
                                   px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        placeholder="Nazwisko"
                        value={en.nazwisko}
                        onChange={(ev) => updateEntry(en.file.name, 'nazwisko', ev.target.value)}
                        className="flex-1 min-w-0 rounded-md border border-zinc-300 dark:border-zinc-600
                                   bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100
                                   px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Club name */}
          <div>
            <label
              htmlFor="clubName"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
            >
              Nazwa klubu (dokładna)
            </label>
            <input
              id="clubName"
              type="text"
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              placeholder="np. Olimpijczyk Brzesko"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800
                         text-zinc-900 dark:text-zinc-100 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white
                       hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {status === 'loading' ? 'Przetwarzanie…' : 'Generuj i pobierz JSON'}
          </button>
        </form>

        {/* Clear database */}
        <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
          <button
            type="button"
            onClick={handleClear}
            className="w-full rounded-lg border border-red-300 dark:border-red-800 px-4 py-2 text-sm
                       font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950
                       transition-colors"
          >
            Wyczyść bazę danych
          </button>
          <p className="mt-1 text-xs text-zinc-400 text-center">
            Usuwa zapisany plik JSON — następne wgranie zacznie od zera.
          </p>
        </div>

        {/* Status message */}
        {message && (
          <p
            className={`rounded-lg px-4 py-3 text-sm ${
              status === 'error'
                ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                : 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
            }`}
          >
            {message}
          </p>
        )}
      </main>
    </div>
  );
}
