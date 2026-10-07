import './style.css';
import {
  SAMPLE,
  LIMITS,
  diagnose,
  exportSubtitles,
  formatTime,
  offsetCues,
  parseSubtitles,
  parseTime,
  readingSpeed,
  shortTime,
} from './core.ts';
import type { Cue, Document, SavedDocument } from './core.ts';
import { apiStore, browserStore, SaveConflict } from './persistence.ts';
import type { WorkspaceStore } from './persistence.ts';

const icons: Record<string, string> = {
  cues: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h10M7 14h6"/>',
  import: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  export: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  back: '<path d="m14 7-5 5 5 5"/>',
  next: '<path d="m10 7 5 5-5 5"/>',
  undo: '<path d="M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12"/>',
  redo: '<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<path d="m12 3 10 18H2zM12 9v4m0 4v.1"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 4v.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  shift: '<path d="M3 8h16m-4-4 4 4-4 4M21 16H5m4-4-4 4 4 4"/>',
  save: '<path d="M5 3h12l4 4v14H3V3h2zm2 0v6h10V3M7 21v-8h10v8"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
};
function icon(name: string): string {
  return `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.cues}</svg>`;
}
function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
const app = el('app');
app.inert = true;
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="./" aria-label="Cuework home"><span class="brand-mark">${icon('cues')}</span>Cuework<span class="brand-divider"></span><span class="brand-sub">Subtitle workbench</span></a>
    <div class="top-actions"><span class="mode-pill"><span></span>${__BROWSER_MODE__ ? 'Browser workspace' : 'Local workspace'}</span><button class="icon-button" id="help" aria-label="Help and keyboard shortcuts">${icon('help')}</button></div>
  </header>
  <div class="workspace-shell">
    <nav class="rail" aria-label="Workspace views">
      <button class="rail-button active" id="nav-cues" title="All cues" aria-label="All cues">${icon('cues')}</button>
      <button class="rail-button" id="nav-review" title="Review issues" aria-label="Review issues">${icon('warning')}<span id="rail-issue-dot"></span></button>
      <button class="rail-button" id="nav-history" title="Version history" aria-label="Version history">${icon('clock')}</button>
      <div class="rail-bottom">CW<br><span>01</span></div>
    </nav>
    <main>
      <section class="document-bar" aria-label="Document controls">
        <div class="document-heading"><div class="eyebrow">WORKSPACE <span>/</span> <span id="source-label">SAMPLE TRANSCRIPT</span></div><input id="document-name" aria-label="Document name" maxlength="120" value="A quieter kind of city" /><div class="document-meta"><span id="document-count">8 cues</span><i>·</i><span id="save-state">Unsaved sample</span></div></div>
        <div class="document-actions"><button class="button subtle" id="import" aria-label="Import subtitles">${icon('import')}<span>Import</span></button><button class="button subtle mobile-history" id="history-mobile" aria-label="Version history">${icon('clock')}</button><button class="button subtle" id="save" aria-label="Save version">${icon('save')}<span>Save version</span></button><button class="button primary" id="export" aria-label="Export subtitles">${icon('export')}<span>Export</span></button></div>
      </section>
      <div class="workbench">
        <section class="editing-column" aria-label="Subtitle editor">
          <div class="preview-toolbar"><span class="section-label">PREVIEW</span><span class="preview-mode" id="video-label">Transcript only</span><button class="text-button" id="attach-video">${icon('video')} Add local video</button><button class="icon-button hidden" id="remove-video" aria-label="Remove video">${icon('close')}</button></div>
          <div class="preview" id="preview">
            <div class="sample-frame" id="sample-frame"><span class="frame-top">FIELD NOTES <span>—</span> SAMPLE TRANSCRIPT</span><div class="frame-title">The in-between<span>.</span></div><div class="frame-lines" aria-hidden="true"><svg viewBox="0 0 700 120" preserveAspectRatio="none"><path d="M0 100h700M0 90h60V44h51v46h25V18h68v72h43V53h72v37h29V12h87v78h20V60h53v30h29V34h91v56h22V68h40v22h20M158 18V0m209 12V0M178 38v9m0 10v9m0 10v14m199-57v13m19-13v13m19-13v13m-38 10v13m19-13v13m19-13v13M554 49h44m-44 13h44m-44 13h44" fill="none" stroke="currentColor" stroke-width="1.25"/></svg></div><span class="frame-footer">A SMALL OBSERVATION OF EVERYDAY LIFE</span></div>
            <video id="video" class="hidden" playsinline preload="metadata" aria-label="Local video preview"></video>
            <div class="subtitle-overlay" id="subtitle-overlay" aria-live="off"></div><span class="preview-badge" id="preview-badge">SAMPLE / NO VIDEO</span>
          </div>
          <div class="transport"><div class="transport-actions"><button class="icon-button" id="previous-cue" aria-label="Previous cue">${icon('back')}</button><button class="play-button" id="play" aria-label="Play preview">${icon('play')}</button><button class="icon-button" id="next-cue" aria-label="Next cue">${icon('next')}</button></div><div class="timecode"><span id="current-time">00:00:03.200</span><span>/</span><span id="total-time">00:00:31.300</span></div><span class="shortcut-hint"><kbd>space</kbd> to play</span></div>
          <div class="timeline-wrap"><div class="timeline-heading"><span class="section-label">TIMELINE</span><span>Click a cue to inspect</span><span id="timeline-range">00:00 — 00:35</span></div><div class="timeline" id="timeline"><div class="ruler" id="ruler"></div><div class="timeline-track" id="timeline-track"></div><div class="playhead" id="playhead"><span></span></div></div><input class="scrubber" id="scrubber" type="range" min="0" step="10" value="3200" aria-label="Preview position in milliseconds" /></div>
          <section class="cue-panel" aria-label="Cue list"><div class="cue-panel-heading"><div class="cue-tabs"><button class="cue-tab active" id="tab-all">All cues <span id="all-count">8</span></button><button class="cue-tab" id="tab-issues">Needs review <span id="issue-count">3</span></button></div><div class="edit-actions"><button class="icon-button" id="undo" aria-label="Undo edit" title="Undo">${icon('undo')}</button><button class="icon-button" id="redo" aria-label="Redo edit" title="Redo">${icon('redo')}</button><span></span><button class="text-button" id="add-cue">${icon('plus')} Add cue</button></div></div><div class="search-row"><label class="search-field">${icon('search')}<input id="search" type="search" placeholder="Search transcript…" aria-label="Search transcript" autocomplete="off"/><kbd>/</kbd></label><span class="list-detail">TIME <span>↔</span> TEXT</span></div><div id="cue-list" class="cue-list"></div><div class="list-footer"><span id="filter-result">8 cues in this transcript</span><span>UTF-8 <i>·</i> Millisecond precision</span></div></section>
        </section>
        <aside class="inspector" aria-label="Cue inspector"><div class="inspector-title"><span class="section-label">INSPECTOR</span><span class="tag" id="selected-number">CUE 01</span></div><div id="inspector-content"></div><section class="offset-section"><div class="section-title">${icon('shift')} Shift timing</div><p>Move every cue forward or back.</p><div class="offset-control"><input id="offset" type="number" step="1" value="-250" aria-label="Timing offset in milliseconds"/><span>ms</span><button class="button compact" id="apply-offset">Apply</button></div><span class="field-hint">Negative = earlier · Positive = later</span></section><section class="review-summary"><div class="section-title">${icon('warning')} Review guide</div><div class="guide-row"><span>Reading speed</span><span>≤ 20 chars/s</span></div><div class="guide-row"><span>Line length</span><span>≤ 42 characters</span></div><div class="guide-row"><span>Lines per cue</span><span>≤ 2 lines</span></div><p>Guidelines, not hard limits. Overlaps may be intentional.</p></section><div class="storage-note">${icon('save')}<span id="storage-note">${__BROWSER_MODE__ ? 'Saved in this browser. Export a copy before clearing site data.' : 'Versions stored in local SQLite. Video stays on your device.'}</span></div></aside>
      </div>
      <footer class="workspace-footer"><span><span class="status-dot"></span><span id="footer-status">Ready to edit</span></span><span>One transcript · Local revisions</span></footer>
    </main>
  </div>
  <input class="hidden" id="subtitle-file" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip"/><input class="hidden" id="video-file" type="file" accept="video/*"/>
  <div id="toast" class="toast hidden" role="status"></div>
  <dialog id="dialog"><div id="dialog-content"></div></dialog>
`;

let doc: Document = structuredClone(SAMPLE);
let selectedId = doc.cues[0].id;
let revision = 0;
let dirty = true;
let source = 'SAMPLE TRANSCRIPT';
let issuesOnly = false;
let search = '';
let currentTime = 3200;
let playing = false;
let playbackFrame = 0;
let videoUrl: string | null = null;
let store: WorkspaceStore | null = null;
let busy = false;
let externalConflict = false;
let toastTimer: ReturnType<typeof setTimeout>;
const undoStack: Document[] = [];
const redoStack: Document[] = [];
const invalidFields = new Set<string>();
const video = el<HTMLVideoElement>('video');
const dialog = el<HTMLDialogElement>('dialog');

function selected(): Cue {
  return doc.cues.find((cue) => cue.id === selectedId) || doc.cues[0];
}
function duration(): number {
  return Math.max(
    1000,
    ...doc.cues.map((cue) => cue.end),
    Number.isFinite(video.duration) ? video.duration * 1000 : 0,
  );
}
function extent(): number {
  return Math.ceil(duration() / 5000) * 5000;
}
function toast(message: string, error = false): void {
  clearTimeout(toastTimer);
  const box = el('toast');
  box.textContent = message;
  box.className = `toast ${error ? 'error' : ''}`;
  toastTimer = setTimeout(() => box.classList.add('hidden'), error ? 9000 : 4500);
}
function mutate(action: () => void, inspector = true): void {
  undoStack.push(structuredClone(doc));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  action();
  dirty = true;
  if (source === 'SAMPLE TRANSCRIPT') source = 'EDITED SAMPLE TRANSCRIPT';
  refresh(inspector);
}
function refresh(inspector = true): void {
  if (!doc.cues.some((cue) => cue.id === selectedId)) selectedId = doc.cues[0].id;
  const issues = diagnose(doc.cues);
  const issueCueCount = new Set(issues.map((issue) => issue.cueId)).size;
  el('document-count').textContent = `${doc.cues.length} cues · ${shortTime(duration())}`;
  el('save-state').textContent = externalConflict
    ? 'Newer version available'
    : dirty
      ? revision
        ? `Unsaved changes · v${revision}`
        : 'Unsaved workspace'
      : `Saved · v${revision}`;
  el('save-state').classList.toggle('unsaved', dirty || externalConflict);
  el('source-label').textContent = source;
  el('all-count').textContent = String(doc.cues.length);
  el('issue-count').textContent = String(issueCueCount);
  el('rail-issue-dot').classList.toggle('hidden', !issueCueCount);
  el('footer-status').textContent = issues.some((i) => i.severity === 'error')
    ? 'Fix invalid cues before exporting'
    : issueCueCount
      ? `${issueCueCount} cues to review`
      : 'All cues look good';
  el<HTMLButtonElement>('save').disabled = busy || !store || invalidFields.size > 0;
  el<HTMLButtonElement>('export').disabled = invalidFields.size > 0;
  el<HTMLButtonElement>('undo').disabled = !undoStack.length;
  el<HTMLButtonElement>('redo').disabled = !redoStack.length;
  el<HTMLButtonElement>('add-cue').disabled = doc.cues.length >= LIMITS.cues;
  renderList();
  renderTimeline();
  if (inspector) renderInspector();
  updatePreview();
}
function renderList(): void {
  const issues = diagnose(doc.cues);
  const filtered = doc.cues.filter(
    (cue) =>
      (!search || cue.text.toLowerCase().includes(search.toLowerCase())) &&
      (!issuesOnly || issues.some((issue) => issue.cueId === cue.id)),
  );
  el('cue-list').innerHTML = filtered.length
    ? filtered
        .map((cue) => {
          const index = doc.cues.indexOf(cue);
          const cueIssues = issues.filter((issue) => issue.cueId === cue.id);
          const overlap = cueIssues.some((issue) => issue.kind === 'overlap');
          const invalid = cueIssues.some((issue) => issue.severity === 'error');
          return `<button class="cue-row ${cue.id === selectedId ? 'selected' : ''}" data-cue="${escape(cue.id)}" aria-pressed="${cue.id === selectedId}"><span class="cue-index">${String(index + 1).padStart(2, '0')}</span><span class="cue-times"><span>${formatTime(cue.start)}</span><span>${formatTime(cue.end)}</span></span><span class="cue-copy">${escape(cue.text).replace(/\n/g, '<br>')}</span><span class="cue-badges">${cueIssues.length ? `<span class="issue-tag ${invalid ? 'invalid' : ''}">${invalid ? 'Invalid' : overlap ? 'Overlap' : 'Readability'}</span>` : `<span class="cue-ok" aria-label="No issues">${icon('check')}</span>`}</span></button>`;
        })
        .join('')
    : '<div class="empty-state">No matching cues.<span>Try another search or switch to All cues.</span></div>';
  el('filter-result').textContent =
    `${filtered.length} of ${doc.cues.length} cues${issuesOnly ? ' need review' : ' in this transcript'}`;
}
function renderTimeline(): void {
  const total = extent();
  const step =
    total <= 60_000 ? 5000 : total <= 300_000 ? 30_000 : Math.ceil(total / 6 / 60_000) * 60_000;
  const marks: string[] = [];
  for (let time = 0; time < total; time += step)
    marks.push(`<span style="left:${(time / total) * 100}%">${shortTime(time)}</span>`);
  el('ruler').innerHTML = marks.join('');
  const overlaps = new Set(
    diagnose(doc.cues)
      .filter((issue) => issue.kind === 'overlap')
      .map((issue) => issue.cueId),
  );
  el('timeline-track').innerHTML = doc.cues
    .map(
      (cue, index) =>
        `<button data-cue="${escape(cue.id)}" class="timeline-cue ${cue.id === selectedId ? 'selected' : ''} ${overlaps.has(cue.id) ? 'overlap' : ''}" style="left:${(Math.max(0, cue.start) / total) * 100}%;width:${Math.max(0.35, ((cue.end - Math.max(0, cue.start)) / total) * 100)}%;${index % 2 ? 'top:30px' : ''}" title="Cue ${index + 1}: ${escape(cue.text)}" aria-label="Select cue ${index + 1}">${String(index + 1).padStart(2, '0')}</button>`,
    )
    .join('');
  el('timeline-range').textContent = `0:00 — ${shortTime(total)}`;
  el<HTMLInputElement>('scrubber').max = String(duration());
}
function renderInspector(): void {
  const cue = selected();
  selectedId = cue.id;
  invalidFields.clear();
  const index = doc.cues.indexOf(cue);
  el('selected-number').textContent = `CUE ${String(index + 1).padStart(2, '0')}`;
  el('inspector-content').innerHTML =
    `<div class="timing-grid"><label>START<input id="cue-start" value="${formatTime(cue.start)}" spellcheck="false" autocomplete="off"/></label><label>END<input id="cue-end" value="${formatTime(cue.end)}" spellcheck="false" autocomplete="off"/></label></div><div id="time-error" class="field-error" role="alert"></div><div class="duration-row"><span>Duration</span><span id="cue-duration">${((cue.end - cue.start) / 1000).toFixed(3)} s</span></div><label class="text-label" for="cue-text">SUBTITLE TEXT</label><textarea id="cue-text" maxlength="${LIMITS.text}" spellcheck="true">${escape(cue.text)}</textarea><div class="text-metrics"><span id="character-count"></span><span id="reading-speed"></span></div><div id="cue-diagnostics"></div>${cue.settings || cue.identifier ? '<p class="field-hint vtt-note">WebVTT identifier / positioning preserved on VTT export.</p>' : ''}<button id="delete-cue" class="text-button delete-button" ${doc.cues.length === 1 ? 'disabled' : ''}>${icon('trash')} Delete cue</button>`;
  renderInspectorMetrics();
  for (const key of ['start', 'end'] as const)
    el<HTMLInputElement>(`cue-${key}`).addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      const value = parseTime(input.value);
      if (value === null) {
        invalidFields.add(key);
        input.classList.add('input-error');
        el('time-error').textContent = 'Use HH:MM:SS.mmm with minutes and seconds below 60.';
        refresh(false);
        return;
      }
      invalidFields.delete(key);
      input.classList.remove('input-error');
      el('time-error').textContent = invalidFields.size ? 'Correct the highlighted timestamp.' : '';
      mutate(() => {
        selected()[key] = value;
      }, false);
      renderInspectorMetrics();
    });
  el<HTMLTextAreaElement>('cue-text').addEventListener('input', (event) => {
    mutate(() => {
      selected().text = (event.target as HTMLTextAreaElement).value;
    }, false);
    renderInspectorMetrics();
  });
  el('delete-cue').addEventListener('click', () => {
    if (doc.cues.length === 1) return;
    mutate(() => {
      doc.cues.splice(index, 1);
      selectedId = doc.cues[Math.min(index, doc.cues.length - 1)].id;
    });
    toast('Cue removed. Undo is available.');
  });
}
function renderInspectorMetrics(): void {
  const cue = selected();
  el('character-count').textContent = `${[...cue.text].length} characters`;
  const speed = readingSpeed(cue);
  el('reading-speed').textContent = `${speed.toFixed(1)} chars/s`;
  el('reading-speed').classList.toggle('warning-text', speed > 20);
  el('cue-duration').textContent = `${((cue.end - cue.start) / 1000).toFixed(3)} s`;
  const issues = diagnose(doc.cues).filter((issue) => issue.cueId === cue.id);
  el('cue-diagnostics').innerHTML = issues.length
    ? issues
        .map(
          (issue) =>
            `<div class="diagnostic ${issue.severity}">${icon('warning')}<span>${escape(issue.message)}</span></div>`,
        )
        .join('')
    : `<div class="diagnostic good">${icon('check')}<span>Comfortable to read. No timing issues.</span></div>`;
}
function chooseCue(id: string): void {
  if (invalidFields.size) {
    toast('Correct the highlighted timestamp before changing cues.', true);
    return;
  }
  const cue = doc.cues.find((item) => item.id === id);
  if (!cue) return;
  selectedId = id;
  seek(Math.max(0, cue.start));
  refresh();
}
function seek(time: number): void {
  currentTime = Math.max(0, Math.min(duration(), time));
  if (videoUrl && Number.isFinite(video.duration))
    video.currentTime = Math.min(currentTime / 1000, video.duration);
  updatePreview();
}
function updatePreview(): void {
  const active = doc.cues.filter((cue) => cue.start <= currentTime && cue.end > currentTime);
  el('subtitle-overlay').textContent = active.map((cue) => cue.text).join('\n');
  el('subtitle-overlay').classList.toggle('hidden', !active.length);
  el('current-time').textContent = formatTime(Math.round(currentTime));
  el('total-time').textContent = formatTime(Math.round(duration()));
  el('playhead').style.left = `${(currentTime / extent()) * 100}%`;
  el<HTMLInputElement>('scrubber').value = String(currentTime);
}
function stop(): void {
  playing = false;
  cancelAnimationFrame(playbackFrame);
  video.pause();
  el('play').innerHTML = icon('play');
  el('play').setAttribute('aria-label', 'Play preview');
}
async function togglePlay(): Promise<void> {
  if (playing) {
    stop();
    return;
  }
  if (currentTime >= duration()) seek(0);
  if (videoUrl) {
    try {
      await video.play();
    } catch {
      toast('This video cannot play in your browser. Try an MP4 or WebM file.', true);
      return;
    }
  }
  playing = true;
  el('play').innerHTML = icon('pause');
  el('play').setAttribute('aria-label', 'Pause preview');
  let previous = performance.now();
  function tick(now: number): void {
    if (!playing) return;
    currentTime =
      videoUrl && !video.ended ? video.currentTime * 1000 : currentTime + now - previous;
    previous = now;
    if (currentTime >= duration()) {
      currentTime = duration();
      stop();
    }
    updatePreview();
    if (playing) playbackFrame = requestAnimationFrame(tick);
  }
  playbackFrame = requestAnimationFrame(tick);
}
function setFilter(value: boolean): void {
  issuesOnly = value;
  el('tab-all').classList.toggle('active', !value);
  el('tab-issues').classList.toggle('active', value);
  el('nav-cues').classList.toggle('active', !value);
  el('nav-review').classList.toggle('active', value);
  renderList();
}
function openDialog(html: string): void {
  el('dialog-content').innerHTML = html;
  dialog.showModal();
  el('dialog-close')?.addEventListener('click', () => dialog.close());
}
function dialogHeading(kicker: string, title: string): string {
  return `<div class="dialog-top"><span class="eyebrow">${kicker}</span><button class="icon-button" id="dialog-close" aria-label="Close dialog">${icon('close')}</button></div><h2>${title}</h2>`;
}
function replaceDocument(next: Document, label: string, saveRevision?: number): void {
  stop();
  doc = structuredClone({ name: next.name, cues: next.cues });
  selectedId = doc.cues[0].id;
  currentTime = Math.max(0, doc.cues[0].start);
  source = label;
  invalidFields.clear();
  undoStack.length = 0;
  redoStack.length = 0;
  search = '';
  el<HTMLInputElement>('search').value = '';
  if (saveRevision !== undefined) {
    revision = saveRevision;
    dirty = false;
    externalConflict = false;
  } else dirty = true;
  el<HTMLInputElement>('document-name').value = doc.name;
  setFilter(false);
  refresh();
}
async function saveVersion(next: Document = doc): Promise<void> {
  if (!store || busy || invalidFields.size) return;
  busy = true;
  refresh(false);
  const snapshot = structuredClone(next);
  try {
    const result = await store.save(snapshot, revision);
    revision = result.revision;
    externalConflict = false;
    dirty =
      JSON.stringify({ name: doc.name.trim(), cues: doc.cues }) !==
      JSON.stringify({ name: snapshot.name.trim(), cues: snapshot.cues });
    toast(`Version ${revision} saved ${__BROWSER_MODE__ ? 'in this browser' : 'to local SQLite'}.`);
  } catch (error) {
    if (error instanceof SaveConflict) {
      externalConflict = true;
      showConflict();
    } else toast((error as Error).message, true);
  } finally {
    busy = false;
    refresh(false);
  }
}
function showConflict(): void {
  if (dialog.open) dialog.close();
  openDialog(
    `${dialogHeading('SAVE CONFLICT', 'Another version is ahead.')}<p>Your edits are still here. Export them to keep a copy, or load the latest saved version before editing again.</p><div class="dialog-actions"><button class="button" id="conflict-keep">Keep editing</button><button class="button primary" id="conflict-reload">Load latest version</button></div>`,
  );
  el('conflict-keep').onclick = () => dialog.close();
  el('conflict-reload').onclick = async () => {
    if (
      dirty &&
      !window.confirm(
        'Discard your unsaved edits and load the latest saved version? Export a copy first if you need to keep them.',
      )
    )
      return;
    app.inert = true;
    try {
      const next = await store!.get();
      if (next) {
        replaceDocument(next, 'SAVED WORKSPACE', next.revision);
        dialog.close();
        toast(`Loaded version ${next.revision}.`);
      }
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      app.inert = false;
    }
  };
}
async function showHistory(): Promise<void> {
  if (!store) {
    toast('Storage is not available yet.', true);
    return;
  }
  try {
    const revisions = await store.history();
    openDialog(
      `${dialogHeading('WORKSPACE', 'Version history')}<p>${__BROWSER_MODE__ ? 'Stored in this browser only.' : 'Stored in your local SQLite database.'} Restoring adds a new version; previous versions stay available. The latest 50 versions are shown.</p><div class="history-list">${revisions.length ? revisions.map((item) => `<div class="history-row"><span class="version-number">v${item.revision}</span><div><strong>${escape(item.name)}</strong><span>${new Date(item.savedAt).toLocaleString()} · ${item.cueCount} cues</span></div><button class="button compact" data-restore="${item.revision}" ${busy ? 'disabled' : ''}>Restore</button></div>`).join('') : '<div class="empty-state">No saved versions yet.<span>Save a version to create your first checkpoint.</span></div>'}</div>`,
    );
    el('dialog-content')
      .querySelectorAll<HTMLButtonElement>('[data-restore]')
      .forEach((button) => {
        button.onclick = async () => {
          if (busy) return;
          if (
            dirty &&
            !window.confirm(
              'Restore this version? Current unsaved edits will be replaced. Export them first if you need a copy.',
            )
          )
            return;
          busy = true;
          button.disabled = true;
          app.inert = true;
          try {
            const old = await store!.get(Number(button.dataset.restore));
            if (!old) throw new Error('This revision could not be found.');
            const restored = await store!.save({ name: old.name, cues: old.cues }, revision);
            replaceDocument(restored, 'RESTORED WORKSPACE', restored.revision);
            dialog.close();
            toast(`Version ${old.revision} restored as version ${restored.revision}.`);
          } catch (error) {
            if (error instanceof SaveConflict) {
              externalConflict = true;
              showConflict();
            } else toast((error as Error).message, true);
          } finally {
            busy = false;
            button.disabled = false;
            app.inert = false;
            refresh(false);
          }
        };
      });
  } catch (error) {
    toast((error as Error).message, true);
  }
}

el('cue-list').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cue]');
  if (button) chooseCue(button.dataset.cue!);
});
el('timeline-track').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cue]');
  if (button) chooseCue(button.dataset.cue!);
});
el('timeline').addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('[data-cue]')) return;
  const rect = el('timeline').getBoundingClientRect();
  seek(((event.clientX - rect.left) / rect.width) * extent());
});
el<HTMLInputElement>('scrubber').oninput = (event) =>
  seek(Number((event.target as HTMLInputElement).value));
el('play').onclick = togglePlay;
el('previous-cue').onclick = () =>
  chooseCue(doc.cues[Math.max(0, doc.cues.findIndex((cue) => cue.id === selectedId) - 1)].id);
el('next-cue').onclick = () =>
  chooseCue(
    doc.cues[Math.min(doc.cues.length - 1, doc.cues.findIndex((cue) => cue.id === selectedId) + 1)]
      .id,
  );
el('tab-all').onclick = el('nav-cues').onclick = () => setFilter(false);
el('tab-issues').onclick = el('nav-review').onclick = () => setFilter(true);
el<HTMLInputElement>('search').oninput = (event) => {
  search = (event.target as HTMLInputElement).value;
  renderList();
};
el<HTMLInputElement>('document-name').oninput = (event) => {
  const value = (event.target as HTMLInputElement).value;
  mutate(() => {
    doc.name = value;
  }, false);
};
el('undo').onclick = () => {
  const previous = undoStack.pop();
  if (!previous) return;
  redoStack.push(structuredClone(doc));
  doc = previous;
  dirty = true;
  invalidFields.clear();
  el<HTMLInputElement>('document-name').value = doc.name;
  refresh();
};
el('redo').onclick = () => {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(structuredClone(doc));
  doc = next;
  dirty = true;
  invalidFields.clear();
  el<HTMLInputElement>('document-name').value = doc.name;
  refresh();
};
el('add-cue').onclick = () => {
  if (invalidFields.size) {
    toast('Correct the highlighted timestamp first.', true);
    return;
  }
  if (doc.cues.length >= LIMITS.cues) return;
  const start = Math.max(...doc.cues.map((cue) => cue.end)) + 300;
  if (start + 2500 > LIMITS.time) {
    toast('There is no room for another cue within the 99-hour limit.', true);
    return;
  }
  mutate(() => {
    const cue: Cue = { id: crypto.randomUUID(), start, end: start + 2500, text: 'New subtitle' };
    doc.cues.push(cue);
    selectedId = cue.id;
  });
  seek(start);
  el<HTMLTextAreaElement>('cue-text').focus();
  el<HTMLTextAreaElement>('cue-text').select();
};
el('apply-offset').onclick = () => {
  if (invalidFields.size) {
    toast('Correct the highlighted timestamp first.', true);
    return;
  }
  const input = el<HTMLInputElement>('offset');
  if (!/^[+-]?\d+$/.test(input.value)) {
    toast('Enter a whole number of milliseconds.', true);
    return;
  }
  try {
    const offset = Number(input.value);
    const cues = offsetCues(doc.cues, offset);
    mutate(() => {
      doc.cues = cues;
    });
    toast(`All ${cues.length} cues shifted ${offset >= 0 ? '+' : ''}${offset} ms.`);
  } catch (error) {
    toast((error as Error).message, true);
  }
};
el('save').onclick = () => saveVersion();
el('nav-history').onclick = showHistory;
el('history-mobile').onclick = showHistory;
el('import').onclick = () => el<HTMLInputElement>('subtitle-file').click();
el<HTMLInputElement>('subtitle-file').onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > LIMITS.bytes) throw new Error('Subtitle files must be smaller than 1 MiB.');
    const cues = parseSubtitles(await file.text());
    if (dirty && !window.confirm('Import this transcript? Current unsaved edits will be replaced.'))
      return;
    replaceDocument(
      { name: file.name.replace(/\.(srt|vtt)$/i, '').slice(0, 120) || 'Untitled transcript', cues },
      'IMPORTED TRANSCRIPT',
    );
    toast(`Imported ${cues.length} cues. Save a version to keep them.`);
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    input.value = '';
  }
};
el('export').onclick = () => {
  const errors = diagnose(doc.cues).filter((issue) => issue.severity === 'error');
  if (errors.length) {
    toast('Fix invalid cues before exporting. Your work is unchanged.', true);
    setFilter(true);
    chooseCue(errors[0].cueId);
    return;
  }
  openDialog(
    `${dialogHeading('READY TO GO', 'Export your transcript')}<p>${doc.cues.length} cues · UTF-8 · Sorted by start time. Readability warnings do not block export.</p><div class="export-options"><button class="export-option" data-format="srt"><span class="file-type">SRT</span><span><strong>SubRip</strong><small>Broad support in video editors.</small></span>${icon('export')}</button><button class="export-option" data-format="vtt"><span class="file-type">VTT</span><span><strong>WebVTT</strong><small>For web video and caption tracks.</small></span>${icon('export')}</button></div><p class="field-hint">SRT uses sequential cue numbers. WebVTT identifiers and positioning are preserved only in VTT. Subtitle markup is retained as text and is not rendered in this preview.</p>`,
  );
  el('dialog-content')
    .querySelectorAll<HTMLButtonElement>('[data-format]')
    .forEach((button) => {
      button.onclick = () => {
        try {
          const format = button.dataset.format as 'srt' | 'vtt';
          const content = exportSubtitles(doc.cues, format);
          const url = URL.createObjectURL(
            new Blob([content], {
              type:
                format === 'vtt' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8',
            }),
          );
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `${doc.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.${format}`;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          dialog.close();
          toast(`${format.toUpperCase()} exported.`);
        } catch (error) {
          toast((error as Error).message, true);
        }
      };
    });
};
function removeVideo(): void {
  stop();
  video.removeAttribute('src');
  video.load();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;
  video.classList.add('hidden');
  el('sample-frame').classList.remove('hidden');
  el('remove-video').classList.add('hidden');
  el('video-label').textContent = 'Transcript only';
  el('preview-badge').textContent = 'TRANSCRIPT / NO VIDEO';
  refresh(false);
}
el('attach-video').onclick = () => el<HTMLInputElement>('video-file').click();
el('remove-video').onclick = removeVideo;
el<HTMLInputElement>('video-file').onchange = (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  removeVideo();
  videoUrl = URL.createObjectURL(file);
  video.src = videoUrl;
  video.classList.remove('hidden');
  el('sample-frame').classList.add('hidden');
  el('remove-video').classList.remove('hidden');
  el('video-label').textContent = file.name;
  el('preview-badge').textContent = 'LOCAL VIDEO';
  input.value = '';
  toast('Video attached locally. It is never uploaded or included in saved versions.');
};
video.onloadedmetadata = () => {
  seek(currentTime);
  refresh(false);
};
video.onerror = () => {
  if (videoUrl) {
    removeVideo();
    toast('This video format could not be loaded. Try a browser-compatible MP4 or WebM.', true);
  }
};
el('help').onclick = () =>
  openDialog(
    `${dialogHeading('QUICK REFERENCE', 'Using Cuework')}<p>Import an SRT or WebVTT transcript, inspect the timing, then export a clean copy. The opening transcript is a fictional sample with deliberate overlap and readability warnings.</p><div class="help-grid"><kbd>Space</kbd><span>Play / pause, outside text fields</span><kbd>⌘ / Ctrl S</kbd><span>Save a new version</span><kbd>/</kbd><span>Search the transcript</span><kbd>Esc</kbd><span>Close a dialog</span></div><p>${__BROWSER_MODE__ ? 'Browser workspace: revisions live in IndexedDB on this device and origin. There is no server or account. Clearing site data removes saved versions.' : 'Local workspace: a loopback-only Node server keeps revisions in SQLite. There is no account system or shared workspace.'}</p><p class="field-hint">Limits: 1 MiB per subtitle file, 1,000 cues, 4,000 characters per cue. WebVTT notes, styles, regions, header metadata, and inline timestamp tags are rejected so unsupported data is never silently discarded. Text markup is displayed literally. Import and restore replace the current transcript.</p>`,
  );
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  }
});
document.addEventListener('keydown', (event) => {
  const typing = (event.target as HTMLElement).matches('input, textarea, [contenteditable]');
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!dialog.open) void saveVersion();
  }
  if (typing || dialog.open || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.code === 'Space') {
    event.preventDefault();
    void togglePlay();
  }
  if (event.key === '/') {
    event.preventDefault();
    el<HTMLInputElement>('search').focus();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (dirty && source !== 'SAMPLE TRANSCRIPT') {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.addEventListener('pagehide', () => {
  if (videoUrl) URL.revokeObjectURL(videoUrl);
});
refresh();
async function initialize(): Promise<void> {
  try {
    store = __BROWSER_MODE__ ? await browserStore() : apiStore();
    const saved: SavedDocument | null = await store.get();
    // The initial editor is read-only until storage has resolved to avoid overwriting early edits.
    if (saved) replaceDocument(saved, 'SAVED WORKSPACE', saved.revision);
    refresh(false);
  } catch (error) {
    store = null;
    el('storage-note').textContent =
      'Storage unavailable. Editing and export still work; keep an exported copy.';
    toast((error as Error).message, true);
    refresh(false);
  } finally {
    app.inert = false;
  }
}
void initialize();
