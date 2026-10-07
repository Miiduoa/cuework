export const LIMITS = {
  bytes: 1_048_576,
  cues: 1_000,
  text: 4_000,
  totalText: 500_000,
  time: 359_999_999,
};
export type Cue = {
  id: string;
  start: number;
  end: number;
  text: string;
  identifier?: string;
  settings?: string;
};
export type Document = { name: string; cues: Cue[] };
export type SavedDocument = Document & { revision: number; savedAt: string };
export type Revision = { revision: number; name: string; savedAt: string; cueCount: number };
export type Diagnostic = {
  cueId: string;
  kind: 'invalid' | 'overlap' | 'speed' | 'line';
  severity: 'error' | 'warning';
  message: string;
};

export function parseTime(value: string): number | null {
  const match = value.trim().match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!match) return null;
  const [, h = '0', m, s, ms] = match;
  if (+m > 59 || +s > 59) return null;
  return ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;
}

export function formatTime(ms: number, separator = '.'): string {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > LIMITS.time) return 'Invalid time';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
}

export function shortTime(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function validateDocument(value: unknown): asserts value is Document {
  if (!value || typeof value !== 'object') throw new Error('A subtitle document is required.');
  const doc = value as Document;
  if (typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > 120)
    throw new Error('Use a document name between 1 and 120 characters.');
  if (!Array.isArray(doc.cues) || doc.cues.length < 1 || doc.cues.length > LIMITS.cues)
    throw new Error(`Use between 1 and ${LIMITS.cues} cues.`);
  const ids = new Set<string>();
  let characters = 0;
  for (const cue of doc.cues) {
    if (
      !cue ||
      typeof cue !== 'object' ||
      typeof cue.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(cue.id) ||
      ids.has(cue.id)
    )
      throw new Error('Every cue must have a unique, valid ID.');
    ids.add(cue.id);
    if (
      !Number.isSafeInteger(cue.start) ||
      !Number.isSafeInteger(cue.end) ||
      Math.abs(cue.start) > LIMITS.time ||
      Math.abs(cue.end) > LIMITS.time
    )
      throw new Error('Cue times must be whole milliseconds within 99 hours.');
    if (typeof cue.text !== 'string' || cue.text.length > LIMITS.text || /\u0000/.test(cue.text))
      throw new Error(`Cue text is limited to ${LIMITS.text} characters and cannot contain NUL.`);
    if (/<(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}>/.test(cue.text))
      throw new Error(
        'Inline WebVTT timestamp tags are not supported. Remove them before importing; nothing was changed.',
      );
    if (
      cue.identifier !== undefined &&
      (typeof cue.identifier !== 'string' ||
        cue.identifier.length > 200 ||
        /[\r\n]|-->/.test(cue.identifier))
    )
      throw new Error('Invalid WebVTT cue identifier.');
    if (
      cue.settings !== undefined &&
      (typeof cue.settings !== 'string' ||
        cue.settings.length > 300 ||
        /[\r\n]|-->/.test(cue.settings))
    )
      throw new Error('Invalid WebVTT cue settings.');
    characters += cue.text.length;
  }
  if (characters > LIMITS.totalText)
    throw new Error('This document has too much text. The limit is 500,000 characters.');
}

/** Parse complete files atomically: an unrecognized block rejects the import. */
export function parseSubtitles(source: string): Cue[] {
  if (new TextEncoder().encode(source).length > LIMITS.bytes)
    throw new Error('Subtitle files must be smaller than 1 MiB.');
  const normalized = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '');
  if (!normalized.trim()) throw new Error('The subtitle file is empty.');
  const isVtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized);
  let body = normalized;
  if (isVtt) {
    const boundary = normalized.indexOf('\n\n');
    if (boundary < 0)
      throw new Error('WebVTT needs a blank line after its header and at least one cue.');
    const header = normalized.slice(0, boundary).split('\n');
    if (header.length > 1 || header[0].trim() !== 'WEBVTT')
      throw new Error(
        'WebVTT header metadata is not supported. Remove it before importing; nothing was changed.',
      );
    body = normalized.slice(boundary + 2);
  }
  const blocks = body.split(/\n[ \t]*\n+/).filter((block) => block.trim());
  if (blocks.length > LIMITS.cues)
    throw new Error(`At most ${LIMITS.cues} cues can be imported at once.`);
  const cues = blocks.map((block, index): Cue => {
    const lines = block.split('\n');
    let identifier: string | undefined;
    if (!lines[0].includes('-->')) {
      const first = lines.shift()!;
      if (!isVtt && !/^\d+$/.test(first.trim()))
        throw new Error(`Block ${index + 1}: expected a cue number or timing line.`);
      if (isVtt) identifier = first;
    }
    const timing = lines.shift()?.match(/^(\S+)\s+-->\s+(\S+)(?:[ \t]+(.*))?$/);
    if (!timing)
      throw new Error(
        `Block ${index + 1}: invalid timing line. Notes, regions and styles are not supported.`,
      );
    const start = parseTime(timing[1]);
    const end = parseTime(timing[2]);
    if (start === null || end === null)
      throw new Error(`Cue ${index + 1}: use timestamps such as 00:01:23.450.`);
    if (!isVtt && timing[3])
      throw new Error(`Cue ${index + 1}: extra SRT timing data is not supported.`);
    return {
      id: `cue-${index + 1}`,
      start,
      end,
      text: lines.join('\n'),
      ...(identifier ? { identifier } : {}),
      ...(timing[3] ? { settings: timing[3] } : {}),
    };
  });
  validateDocument({ name: 'Import', cues });
  return cues;
}

export function readingSpeed(cue: Cue): number {
  const length = [
    ...cue.text
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ].length;
  return cue.end > cue.start ? length / ((cue.end - cue.start) / 1000) : 0;
}

export function diagnose(cues: Cue[]): Diagnostic[] {
  const result: Diagnostic[] = [];
  const valid: Cue[] = [];
  for (const cue of cues) {
    if (cue.start < 0 || cue.end <= cue.start || cue.end > LIMITS.time)
      result.push({
        cueId: cue.id,
        kind: 'invalid',
        severity: 'error',
        message: 'End must follow start, with no negative timestamps.',
      });
    else valid.push(cue);
    if (
      !cue.text.trim() ||
      /\n[ \t]*\n/.test(cue.text) ||
      cue.text.includes('-->') ||
      /<(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}>/.test(cue.text)
    )
      result.push({
        cueId: cue.id,
        kind: 'invalid',
        severity: 'error',
        message:
          'Text must be non-empty, without blank lines, timing arrows, or inline timestamp tags.',
      });
    const cps = readingSpeed(cue);
    if (cps > 20)
      result.push({
        cueId: cue.id,
        kind: 'speed',
        severity: 'warning',
        message: `${cps.toFixed(1)} characters/sec. Aim for 20 or fewer.`,
      });
    if (
      cue.text.split('\n').some((line) => [...line].length > 42) ||
      cue.text.split('\n').length > 2
    )
      result.push({
        cueId: cue.id,
        kind: 'line',
        severity: 'warning',
        message: 'Try two lines or fewer, with up to 42 characters per line.',
      });
  }
  // A running maximum catches nested intervals, unlike adjacent-only comparisons.
  let furthest: Cue | undefined;
  const overlaps = new Set<string>();
  for (const cue of valid.toSorted((a, b) => a.start - b.start || a.end - b.end)) {
    if (furthest && cue.start < furthest.end) {
      overlaps.add(cue.id);
      overlaps.add(furthest.id);
    }
    if (!furthest || cue.end > furthest.end) furthest = cue;
  }
  for (const cueId of overlaps)
    result.push({
      cueId,
      kind: 'overlap',
      severity: 'warning',
      message: 'Overlaps another cue. Check whether both should appear together.',
    });
  return result;
}

export function offsetCues(cues: Cue[], offset: number): Cue[] {
  if (!Number.isSafeInteger(offset))
    throw new Error('Enter a whole number of milliseconds, such as -250 or 500.');
  const shifted = cues.map((cue) => ({ ...cue, start: cue.start + offset, end: cue.end + offset }));
  if (
    shifted.some(
      (cue) => cue.start < 0 || cue.end < 0 || cue.start > LIMITS.time || cue.end > LIMITS.time,
    )
  )
    throw new Error(
      'That offset would move a cue outside 00:00:00.000–99:59:59.999. Nothing was changed.',
    );
  return shifted;
}

export function exportSubtitles(cues: Cue[], format: 'srt' | 'vtt'): string {
  validateDocument({ name: 'Export', cues });
  const errors = diagnose(cues).filter((issue) => issue.severity === 'error');
  if (errors.length)
    throw new Error(
      `Fix ${new Set(errors.map((issue) => issue.cueId)).size} invalid cue(s) before exporting.`,
    );
  const separator = format === 'srt' ? ',' : '.';
  const blocks = cues
    .toSorted((a, b) => a.start - b.start)
    .map((cue, index) => {
      const header =
        format === 'srt' ? `${index + 1}\n` : cue.identifier ? `${cue.identifier}\n` : '';
      const settings = format === 'vtt' && cue.settings ? ` ${cue.settings}` : '';
      return `${header}${formatTime(cue.start, separator)} --> ${formatTime(cue.end, separator)}${settings}\n${cue.text}`;
    });
  return `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${blocks.join('\n\n')}\n`;
}

export const SAMPLE: Document = {
  name: 'A quieter kind of city',
  cues: [
    {
      id: 'sample-1',
      start: 1500,
      end: 5100,
      text: 'Before the city wakes,\nthere is a little room to listen.',
    },
    {
      id: 'sample-2',
      start: 5700,
      end: 8700,
      text: 'A bicycle finds its way\nthrough the morning.',
    },
    {
      id: 'sample-3',
      start: 9200,
      end: 12700,
      text: 'The shutters open.\nSomeone puts the coffee on.',
    },
    {
      id: 'sample-4',
      start: 12400,
      end: 15400,
      text: 'Ordinary things,\nseen a little differently.',
    },
    {
      id: 'sample-5',
      start: 16200,
      end: 17400,
      text: 'We often forget how much a familiar place can change when we slow down.',
    },
    { id: 'sample-6', start: 18400, end: 21900, text: 'Take the longer way home.' },
    { id: 'sample-7', start: 22600, end: 26100, text: 'There is more here\nthan you remember.' },
    {
      id: 'sample-8',
      start: 27500,
      end: 31300,
      text: 'A quieter kind of city.\nA different way to see it.',
    },
  ],
};
