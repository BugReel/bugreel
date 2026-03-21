/**
 * BugReel — View Analytics Component
 *
 * Renders a view stats panel on the recording detail page.
 * Fetches data from GET /api/analytics/:recordingId.
 */

import { icons, formatDuration, escapeHTML } from './shared.js';

const t = window.__dashboardI18n?.t || ((k, f) => f || k);

/**
 * Fetch view analytics for a recording.
 */
async function getViewAnalytics(recordingId) {
  const res = await fetch(`/api/analytics/${encodeURIComponent(recordingId)}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * Render the view analytics panel and insert it into the given container.
 *
 * @param {HTMLElement} container — the DOM element to insert the panel into
 * @param {string} recordingId — the recording ID to fetch analytics for
 */
export async function renderViewAnalytics(container, recordingId) {
  if (!container || !recordingId) return;

  try {
    const data = await getViewAnalytics(recordingId);
    container.innerHTML = buildAnalyticsHTML(data);
  } catch (err) {
    // Silently fail — analytics is non-critical
    container.innerHTML = '';
    console.warn('View analytics unavailable:', err.message);
  }
}

/**
 * Build the HTML for the analytics panel.
 */
function buildAnalyticsHTML(data) {
  const { total_views, unique_viewers, avg_watch_duration, views_by_day } = data;

  // If no views at all, show a minimal message
  if (total_views === 0) {
    return `
      <div class="analytics-panel">
        <div class="analytics-header">
          <span class="column-panel-label">${icons.chart} ${t('view_analytics', 'View Analytics')}</span>
        </div>
        <div class="analytics-empty text-dim text-sm">
          ${t('no_views_yet', 'No views yet. Share the report link to start tracking.')}
        </div>
      </div>
    `;
  }

  return `
    <div class="analytics-panel">
      <div class="analytics-header">
        <span class="column-panel-label">${icons.chart} ${t('view_analytics', 'View Analytics')}</span>
      </div>

      <!-- Stat cards row -->
      <div class="analytics-stats">
        <div class="analytics-stat">
          <div class="analytics-stat-value">${total_views}</div>
          <div class="analytics-stat-label">${t('total_views', 'Total Views')}</div>
        </div>
        <div class="analytics-stat">
          <div class="analytics-stat-value">${unique_viewers}</div>
          <div class="analytics-stat-label">${t('unique_viewers', 'Unique Viewers')}</div>
        </div>
        <div class="analytics-stat">
          <div class="analytics-stat-value">${formatDuration(avg_watch_duration)}</div>
          <div class="analytics-stat-label">${t('avg_watch_time', 'Avg Watch Time')}</div>
        </div>
      </div>

      <!-- Views over time (last 30 days bar chart) -->
      ${views_by_day && views_by_day.length > 0 ? buildViewsChart(views_by_day) : ''}
    </div>
  `;
}

/**
 * Build a simple CSS bar chart for views over the last 30 days.
 */
function buildViewsChart(viewsByDay) {
  // Fill in missing days to get a full 30-day range
  const days = fillDays(viewsByDay, 30);
  const maxCount = Math.max(...days.map(d => d.count), 1);

  const bars = days.map(d => {
    const heightPct = Math.max((d.count / maxCount) * 100, d.count > 0 ? 4 : 0);
    const shortDate = formatShortDate(d.date);
    const title = `${shortDate}: ${d.count} view${d.count !== 1 ? 's' : ''}`;
    return `<div class="analytics-bar-col" title="${escapeHTML(title)}">
      <div class="analytics-bar" style="height: ${heightPct}%;"></div>
    </div>`;
  }).join('');

  // Date labels (first, middle, last)
  const firstLabel = formatShortDate(days[0].date);
  const lastLabel = formatShortDate(days[days.length - 1].date);

  return `
    <div class="analytics-chart-section">
      <div class="analytics-chart-title text-dim text-xs">${t('views_last_30', 'Views — Last 30 Days')}</div>
      <div class="analytics-chart">
        ${bars}
      </div>
      <div class="analytics-chart-labels">
        <span>${firstLabel}</span>
        <span>${lastLabel}</span>
      </div>
    </div>
  `;
}

/**
 * Fill in missing days so the chart has entries for all 30 days.
 */
function fillDays(viewsByDay, numDays) {
  const dayMap = {};
  viewsByDay.forEach(d => { dayMap[d.date] = d.count; });

  const days = [];
  const now = new Date();
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, count: dayMap[key] || 0 });
  }
  return days;
}

/**
 * Format a date string (YYYY-MM-DD) to short form (e.g., "Mar 21").
 */
function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
