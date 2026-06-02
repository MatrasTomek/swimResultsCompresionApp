<?php
/**
 * LENEX (.lxf) result fetching.
 * LXF = ZIP-compressed XML in LENEX 3.0 format (Splash Meet Manager standard).
 * Used as a faster, more reliable alternative to per-event PDF downloads.
 */

/**
 * Downloads results.lxf, unpacks the ZIP, parses the inner .lef XML.
 * Returns ['ok'=>true, 'athletes'=>[...], 'results'=>[...]]
 *      or ['ok'=>false, 'error'=>'...']
 */
function lenex_download(string $lxf_url): array {
    $ctx = stream_context_create([
        'http' => [
            'header'  => "User-Agent: Mozilla/5.0 SwimResults/1.0\r\n",
            'timeout' => 20,
        ],
        'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
    ]);
    $data = @file_get_contents($lxf_url, false, $ctx);
    $http_code    = '';
    $content_type = '';
    if (isset($http_response_header)) {
        foreach ($http_response_header as $h) {
            if (preg_match('#HTTP/\S+ (\d+)#', $h, $m)) {
                $http_code = ' (HTTP ' . $m[1] . ')';
            }
            if (stripos($h, 'Content-Type:') === 0) {
                $content_type = strtolower($h);
            }
        }
    }
    if ($data === false || $data === '') {
        return ['ok' => false, 'error' => 'Nie można pobrać: ' . $lxf_url . $http_code];
    }
    if (str_contains($content_type, 'text/html')) {
        return ['ok' => false, 'error' => 'Wyniki LENEX jeszcze niedostępne na livetiming.pl (strona zwróciła HTML zamiast pliku .lxf)'];
    }
    if (!class_exists('ZipArchive')) {
        return ['ok' => false, 'error' => 'Rozszerzenie ZipArchive niedostępne na tym serwerze'];
    }
    $tmp = tempnam(sys_get_temp_dir(), 'swim_lxf_') . '.zip';
    file_put_contents($tmp, $data);
    $zip = new ZipArchive();
    if ($zip->open($tmp) !== true) {
        @unlink($tmp);
        return ['ok' => false, 'error' => 'Nie można otworzyć archiwum ZIP'];
    }
    $xml = null;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = strtolower($zip->getNameIndex($i));
        if (str_ends_with($name, '.lef') || str_ends_with($name, '.xml')) {
            $xml = $zip->getFromIndex($i);
            break;
        }
    }
    $zip->close();
    @unlink($tmp);
    if ($xml === null || $xml === false) {
        return ['ok' => false, 'error' => 'Brak pliku .lef w archiwum ZIP'];
    }
    return lenex_parse_xml($xml);
}

/**
 * Parses the LENEX XML string.
 * LENEX 3.0: results are stored under ATHLETE > RESULTS > RESULT (not under EVENT).
 * Builds two maps:
 *   athletes: athleteid → {lastname, firstname, birthdate}
 *   results:  event_number → {athleteid → {czas, punkty}}
 */
function lenex_parse_xml(string $xml): array {
    libxml_use_internal_errors(true);
    $dom = @simplexml_load_string($xml);
    if ($dom === false) {
        return ['ok' => false, 'error' => 'Błąd parsowania XML LENEX'];
    }
    $athletes = [];
    $results  = [];
    foreach ($dom->MEETS->MEET as $meet) {
        // Build eventid → event_number map from SESSIONS
        $eventid_to_nr = [];
        foreach ($meet->SESSIONS->SESSION as $session) {
            foreach ($session->EVENTS->EVENT as $event) {
                $eventid = (string)$event['eventid'];
                $nr      = (int)$event['number'];
                if ($eventid !== '' && $nr > 0) {
                    $eventid_to_nr[$eventid] = $nr;
                }
            }
        }

        // LENEX 3.0: athletes and their results under CLUBS > CLUB > ATHLETES > ATHLETE
        foreach ($meet->CLUBS->CLUB as $club) {
            foreach ($club->ATHLETES->ATHLETE as $ath) {
                $id = (string)$ath['athleteid'];
                if ($id === '') continue;
                $athletes[$id] = [
                    'lastname'  => (string)$ath['lastname'],
                    'firstname' => (string)$ath['firstname'],
                    'birthdate' => (string)($ath['birthdate'] ?? ''),
                ];
                foreach ($ath->RESULTS->RESULT as $res) {
                    $eventid  = (string)($res['eventid'] ?? '');
                    $nr       = $eventid_to_nr[$eventid] ?? 0;
                    if ($nr === 0) continue;
                    $status   = trim((string)($res['status'] ?? ''));
                    if ($status !== '') continue; // DNS / DNF / DSQ / WDR
                    $swimtime = (string)($res['swimtime'] ?? '');
                    if ($swimtime === '' || $swimtime === '-1') continue;
                    $pts      = (int)($res['points'] ?? 0);
                    if (!isset($results[$nr])) $results[$nr] = [];
                    $results[$nr][$id] = [
                        'czas'   => lenex_normalize_time($swimtime),
                        'punkty' => $pts > 0 ? $pts : null,
                    ];
                }
            }
        }

        // LENEX 2.x fallback: results under EVENT > RESULTS > RESULT with swimmerid
        if (empty($results)) {
            foreach ($meet->SESSIONS->SESSION as $session) {
                foreach ($session->EVENTS->EVENT as $event) {
                    $nr = (int)$event['number'];
                    foreach ($event->RESULTS->RESULT as $res) {
                        $swimmerid = (string)$res['swimmerid'];
                        $status    = trim((string)($res['status'] ?? ''));
                        if ($status !== '') continue;
                        $swimtime  = (string)($res['swimtime'] ?? '');
                        if ($swimtime === '' || $swimtime === '-1') continue;
                        $pts       = (int)($res['points'] ?? 0);
                        if (!isset($results[$nr])) $results[$nr] = [];
                        $results[$nr][$swimmerid] = [
                            'czas'   => lenex_normalize_time($swimtime),
                            'punkty' => $pts > 0 ? $pts : null,
                        ];
                    }
                }
            }
        }
    }
    if (empty($athletes)) {
        return ['ok' => false, 'error' => 'LENEX nie zawiera sekcji ATHLETES'];
    }
    return [
        'ok'       => true,
        'athletes' => $athletes,
        'results'  => $results,
    ];
}

/**
 * Finds a specific athlete's result in LENEX data.
 * Name matching is case-insensitive and diacritic-insensitive
 * (handles "WĄS AMELIA" vs "WAS AMELIA" etc.).
 */
function lenex_find_athlete(array $lenex, int $event_nr, string $athlete_name): array {
    if (empty($lenex['results'][$event_nr])) {
        return ['found' => false, 'error' => "Brak wyników k.$event_nr w LENEX"];
    }
    $target = lenex_normalize_name($athlete_name);
    foreach ($lenex['results'][$event_nr] as $swimmerid => $res) {
        $ath = $lenex['athletes'][$swimmerid] ?? null;
        if (!$ath) continue;
        $full = $ath['lastname'] . ' ' . $ath['firstname'];
        if (lenex_normalize_name($full) === $target) {
            $rok = null;
            if (!empty($ath['birthdate'])) {
                $y = (int)substr($ath['birthdate'], 0, 4);
                if ($y > 1900) $rok = $y;
            }
            return [
                'found'         => true,
                'czas'          => $res['czas'],
                'punkty'        => $res['punkty'],
                'rok_urodzenia' => $rok,
            ];
        }
    }
    return ['found' => false, 'error' => "Nie znaleziono w LENEX: $athlete_name (k.$event_nr)"];
}

/**
 * Normalizes "MM:SS.HH" swimtime from LENEX:
 * strips leading "0:" for events under 1 minute (e.g. "0:27.34" → "27.34").
 */
function lenex_normalize_time(string $t): string {
    if (preg_match('/^0:(\d{2}\.\d{2})$/', $t, $m)) return $m[1];
    return $t;
}

/**
 * Folds name to ASCII lowercase for fuzzy matching.
 * E.g. "WĄS AMELIA" and "Wąs Amelia" both → "was amelia".
 */
function lenex_normalize_name(string $name): string {
    $s = mb_strtolower(trim($name), 'UTF-8');
    if (function_exists('iconv')) {
        $t = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
        if ($t !== false) $s = $t;
    }
    return preg_replace('/[^a-z ]/', '', $s);
}
