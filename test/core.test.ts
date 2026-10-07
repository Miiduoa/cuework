import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diagnose,
  exportSubtitles,
  formatTime,
  LIMITS,
  offsetCues,
  parseSubtitles,
  parseTime,
  SAMPLE,
  validateDocument,
} from '../src/core.ts';
import type { Cue } from '../src/core.ts';

const cue = (id: string, start: number, end: number, text = 'Hello'): Cue => ({
  id,
  start,
  end,
  text,
});

test('SRT round-trip preserves millisecond timing, line breaks, Unicode and inert markup', () => {
  const input =
    '\uFEFF1\r\n01:02:03,007 --> 01:02:05,019\r\n你好，世界\r\n<img src=x onerror=alert(1)>\r\n\r\n2\r\n01:03:00,000 --> 01:03:03,400\r\nGood morning.\r\n';
  const parsed = parseSubtitles(input);
  assert.equal(parsed[0].start, 3_723_007);
  assert.equal(parsed[0].text, '你好，世界\n<img src=x onerror=alert(1)>');
  assert.deepEqual(parseSubtitles(exportSubtitles(parsed, 'srt')), parsed);
});

test('WebVTT round-trip retains identifiers, multiline text, cue settings, and short timestamps', () => {
  const input =
    'WEBVTT\n\nintro\n00:01.000 --> 00:04.500 align:start position:10%\n<v Maria>A new day.\nGood morning.\n\n00:05.000 --> 00:07.000\nNext';
  const parsed = parseSubtitles(input);
  assert.equal(parsed[0].identifier, 'intro');
  assert.equal(parsed[0].settings, 'align:start position:10%');
  assert.deepEqual(parseSubtitles(exportSubtitles(parsed, 'vtt')), parsed);
});

test('text indentation and trailing spaces survive an import/export round-trip', () => {
  const input = '1\n00:00:01,000 --> 00:00:04,000\n  An indented line.  \n';
  const parsed = parseSubtitles(input);
  assert.equal(parsed[0].text, '  An indented line.  ');
  assert.deepEqual(parseSubtitles(exportSubtitles(parsed, 'srt')), parsed);
});

test('rejects unsupported WebVTT blocks and inline timestamp tags rather than silently losing data', () => {
  for (const source of [
    'WEBVTT header commentary\n\n00:01.000 --> 00:03.000\nHi',
    'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\n\n00:01.000 --> 00:03.000\nHi',
    'WEBVTT\n\nNOTE annotation\nA note\n\n00:01.000 --> 00:03.000\nHi',
    'WEBVTT\n\nSTYLE\n::cue { color: red }\n\n00:01.000 --> 00:03.000\nHi',
    'WEBVTT\n\n00:01.000 --> 00:03.000\nBefore <00:00:02.000>after',
  ])
    assert.throws(() => parseSubtitles(source));
  assert.throws(
    () => exportSubtitles([cue('a', 6000, 8000, 'Before <00:00:02.000>after')], 'vtt'),
    /timestamp/,
  );
});

test('one malformed block rejects the whole import; no partial success', () => {
  assert.throws(
    () =>
      parseSubtitles(
        '1\n00:00:01,000 --> 00:00:03,000\nGood\n\n2\n00:70:01,000 --> 00:70:03,000\nBad',
      ),
    /Cue 2/,
  );
  assert.throws(() => parseSubtitles('random text'), /Block 1/);
  assert.throws(() => parseSubtitles(''), /empty/);
  assert.throws(() => parseSubtitles('x'.repeat(LIMITS.bytes + 1)), /1 MiB/);
});

test('timestamp parsing is strict and preserves the maximum supported time', () => {
  assert.equal(parseTime('99:59:59.999'), LIMITS.time);
  assert.equal(formatTime(LIMITS.time), '99:59:59.999');
  for (const input of [
    '-00:00:00.250',
    '00:60:00.000',
    '00:00:60.000',
    '00:00:1.000',
    '1.5',
    'Infinity',
    '100:00:00.000',
  ])
    assert.equal(parseTime(input), null);
  assert.equal(formatTime(-1), 'Invalid time');
});

test('batch offsets are immutable, signed, exact, and rejected atomically at either bound', () => {
  const input = [cue('a', 1000, 2000), cue('b', 3000, 4000)];
  assert.deepEqual(
    offsetCues(input, -250).map(({ start, end }) => [start, end]),
    [
      [750, 1750],
      [2750, 3750],
    ],
  );
  assert.throws(() => offsetCues(input, -1001), /Nothing was changed/);
  assert.deepEqual(
    input.map(({ start, end }) => [start, end]),
    [
      [1000, 2000],
      [3000, 4000],
    ],
  );
  assert.throws(() => offsetCues(input, 0.5), /whole number/);
  assert.throws(() => offsetCues([cue('a', LIMITS.time - 1, LIMITS.time)], 1));
});

test('overlap detection catches nested and unsorted intervals, while touching boundaries are valid', () => {
  const input = [
    cue('inside-b', 5000, 6000),
    cue('outer', 0, 10000),
    cue('inside-a', 1000, 2000),
    cue('touching', 10000, 11000),
  ];
  const overlapIds = diagnose(input)
    .filter(({ kind }) => kind === 'overlap')
    .map(({ cueId }) => cueId)
    .sort();
  assert.deepEqual(overlapIds, ['inside-a', 'inside-b', 'outer']);
});

test('invalid timings can be inspected and saved but cannot be exported; warnings do not block export', () => {
  const invalid = [cue('a', 4000, 1000)];
  assert.doesNotThrow(() => validateDocument({ name: 'Repair me', cues: invalid }));
  assert.equal(diagnose(invalid)[0].severity, 'error');
  assert.throws(() => exportSubtitles(invalid, 'srt'), /Fix 1 invalid/);
  assert.throws(() => exportSubtitles([cue('a', -1, 2000)], 'srt'));
  for (const text of ['', 'hello\n\nthere', '00:00 --> 01:00'])
    assert.throws(() => exportSubtitles([cue('a', 0, 3000, text)], 'vtt'));
  assert.doesNotThrow(() => exportSubtitles(SAMPLE.cues, 'srt'));
});

test('export orders cues by time without mutating the editor order', () => {
  const input = [cue('later', 4000, 6000, 'Second'), cue('first', 1000, 3000, 'First')];
  const output = parseSubtitles(exportSubtitles(input, 'srt'));
  assert.deepEqual(
    output.map(({ text }) => text),
    ['First', 'Second'],
  );
  assert.equal(input[0].id, 'later');
});

test('document validation bounds IDs, text, cue count, and rejects duplicate IDs or malformed times', () => {
  for (const document of [
    { name: '', cues: [cue('a', 0, 1000)] },
    { name: 'Test', cues: [cue('a', 0, 1000), cue('a', 2000, 3000)] },
    { name: 'Test', cues: [cue('a', NaN, 1000)] },
    { name: 'Test', cues: [cue('<img>', 0, 1000)] },
    { name: 'Test', cues: [cue('a', 0, 1000, 'x'.repeat(LIMITS.text + 1))] },
    { name: 'Test', cues: [] },
  ])
    assert.throws(() => validateDocument(document));
});
