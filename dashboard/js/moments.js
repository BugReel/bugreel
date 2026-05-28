/**
 * Key Moments registry — shared by the owner dashboard (recording.html) and
 * the public share page (report.html).
 *
 * "Moments" merge two time-indexed sources into one list: key frames
 * (manual or AI) and AI chapters. Rendering + behavior live here so both
 * pages stay in sync instead of drifting apart.
 */
import { icons, escapeHTML, formatTimecode } from './shared.js';
import { frameUrl } from './api.js';

const t = (k, f) => (window.__dashboardI18n?.t || ((k2, f2) => f2 || k2))(k, f);

/**
 * Merge frames + AI chapters into one time-sorted registry.
 * A chapter is dropped if a frame sits within DEDUP seconds OR shares its
 * title — legacy chapter-derived frames keep the AI title but a slightly
 * different timestamp, so a time-only check leaves visible duplicates.
 */
export function buildMoments(frames, chapters) {
  const DEDUP = 3.0;
  const norm = s => (s || '').trim().toLowerCase();
  const fromFrames = (frames || []).map(f => ({
    time: Number(f.time_seconds) || 0,
    title: f.description || '',
    detail: f.detail || '',
    thumb: f.filename || null,
    source: f.is_manual ? 'manual' : 'ai',
    frameId: f.id,
  }));
  const fromChapters = (chapters || [])
    .filter(c => !fromFrames.some(f =>
      Math.abs(f.time - (Number(c.time) || 0)) <= DEDUP ||
      (norm(f.title) && norm(f.title) === norm(c.title))))
    .map(c => ({
      time: Number(c.time) || 0,
      title: c.title || '',
      detail: '',
      thumb: c.thumb || null,
      source: 'ai',
      frameId: null,
    }));
  return [...fromFrames, ...fromChapters].sort((a, b) => a.time - b.time);
}

/**
 * One moment row.
 * @param m       a moment from buildMoments()
 * @param opts.recordingId  thumbnail URL key — REC id for the owner, share_token for public
 * @param opts.showBadge    show a manual/AI source badge (only useful in a mixed list)
 * @param opts.allowDelete  render the owner-only delete button
 */
export function renderMomentRow(m, { recordingId, showBadge = false, allowDelete = false } = {}) {
  const badge = !showBadge
    ? ''
    : m.source === 'manual'
      ? `<span class="moment-badge moment-badge-manual" title="${t('added_manually', 'Added manually')}">${icons.image}</span>`
      : `<span class="moment-badge moment-badge-ai" title="${t('ai_selected', 'AI-selected')}">${icons.sparkle} AI</span>`;
  const thumb = m.thumb
    ? `<img class="keyframe-thumb" src="${frameUrl(recordingId, m.thumb)}" alt="" loading="lazy" />`
    : `<div class="keyframe-thumb keyframe-thumb-placeholder">${icons.sparkle}</div>`;
  const del = (allowDelete && m.frameId != null)
    ? `<button class="keyframe-delete" data-frame-id="${m.frameId}" title="Delete">
         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
       </button>`
    : '';
  return `
    <div class="keyframe-item moment-item" data-frame-id="${m.frameId ?? ''}" data-time="${m.time}" data-source="${m.source}">
      ${thumb}
      <div class="keyframe-info">
        <div class="keyframe-title">${escapeHTML(m.title)}</div>
        ${m.detail ? `<div class="keyframe-detail">${escapeHTML(m.detail)}</div>` : ''}
        <span class="moment-meta">${badge}<span class="keyframe-time">${formatTimecode(m.time)}</span></span>
      </div>
      ${del}
    </div>`;
}

/**
 * Full "Key Moments" panel: header + scrollable list of rows.
 * Badges only appear when the list mixes manual + AI moments (otherwise noise).
 */
export function renderMomentsPanel(moments, { recordingId, allowDelete = false } = {}) {
  const showBadge = new Set((moments || []).map(m => m.source)).size > 1;
  const rows = (moments && moments.length)
    ? moments.map(m => renderMomentRow(m, { recordingId, showBadge, allowDelete })).join('')
    : `<div class="keyframes-empty text-dim">${t('no_key_frames', 'No key frames')}</div>`;
  return `
    <div class="keyframes-index" id="keyframesIndex">
      <div class="keyframes-index-header">
        <span>${t('key_moments', 'Key Moments')}</span>
        <span class="text-dim text-xs">${(moments || []).length}</span>
      </div>
      <div class="keyframes-index-list" id="keyframesList">
        ${rows}
      </div>
    </div>`;
}

/**
 * Wire the moments list to the player:
 *  - click a row → seek (and play) the video
 *  - follow playback → highlight the current moment and scroll the LIST
 *    (not the page) so the active row aligns to the top
 *  - if onDelete is given, wire the per-row delete buttons (owner only)
 *
 * Returns the highlight(time) fn so callers can sync it from other controls.
 */
export function setupMomentsList({ video, onDelete = null } = {}) {
  const list = document.getElementById('keyframesList');
  if (!list) return () => {};

  let activeTime = null;
  function highlight(currentTime) {
    const items = list.querySelectorAll('.moment-item');
    if (!items.length) return;
    let active = items[0];
    for (const item of items) {
      const tt = parseFloat(item.dataset.time);
      if (!isNaN(tt) && tt <= currentTime + 0.4) active = item;
      else break;
    }
    if (active.dataset.time === activeTime) return;
    activeTime = active.dataset.time;
    items.forEach(it => it.classList.toggle('active', it === active));
    // Scroll only the list (not the page) so the active row aligns to the top.
    // scrollIntoView would bubble up and scroll the whole document, pushing
    // the video off-screen.
    const delta = active.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTo({ top: list.scrollTop + delta, behavior: 'smooth' });
  }

  list.querySelectorAll('.moment-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.keyframe-delete')) return;
      const time = parseFloat(item.dataset.time);
      if (video && !isNaN(time)) {
        video.currentTime = time;
        video.play?.().catch(() => {});
      }
      highlight(time);
    });
  });

  if (onDelete) {
    list.querySelectorAll('.keyframe-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onDelete(btn.dataset.frameId);
      });
    });
  }

  if (video) {
    activeTime = null;
    video.addEventListener('timeupdate', () => highlight(video.currentTime));
  }
  return highlight;
}
