const labels = {
  AVAILABLE: '检测到可购信号',
  POSSIBLE_AVAILABLE: '检测到可能可购信号',
  SOLD_OUT: '暂未发现余票',
  UNKNOWN: '正在监测',
  ERROR: '本轮检查异常'
};

const liveStatusUrl = 'https://raw.githubusercontent.com/xuew56263-glitch/damai-ticket-watcher-jul2026/live-status/status.json';
let latestState = null;
let refreshInProgress = false;

function formatDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date);
}

function formatAge(value) {
  const checkedAt = new Date(value).getTime();
  if (!Number.isFinite(checkedAt)) return '--';
  const seconds = Math.max(0, Math.floor((Date.now() - checkedAt) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

function renderFreshness() {
  if (!latestState?.at) return;
  const ageMs = Math.max(0, Date.now() - new Date(latestState.at).getTime());
  document.getElementById('checked-at').textContent = `${formatDate(latestState.at)}（${formatAge(latestState.at)}）`;
  const freshness = document.getElementById('freshness');
  if (ageMs <= 120_000) {
    freshness.textContent = '云端更新正常';
    freshness.dataset.state = 'fresh';
  } else if (ageMs <= 180_000) {
    freshness.textContent = '等待下一轮';
    freshness.dataset.state = 'waiting';
  } else {
    freshness.textContent = `更新延迟：${formatAge(latestState.at)}`;
    freshness.dataset.state = 'stale';
  }
}

function renderState(state) {
  latestState = state;
  document.getElementById('status').textContent = labels[state.status] || state.status || '正在监测';
  document.getElementById('status').dataset.state = state.status || 'UNKNOWN';
  document.getElementById('reason').textContent = state.reason || '未发现可购信号。';
  const count = document.getElementById('available-count');
  if (state.availableCount === 0) {
    count.textContent = '0';
  } else if (Number.isFinite(state.availableCount) && state.availableCount > 0) {
    count.textContent = String(state.availableCount);
  } else if (state.status === 'AVAILABLE' || state.status === 'POSSIBLE_AVAILABLE') {
    count.textContent = '有票，数量未公开';
  } else {
    count.textContent = '--';
  }
  document.getElementById('total-checks').textContent = state.totalChecks ?? state.attempt ?? '--';
  document.getElementById('expires-at').textContent = formatDate(state.expiresAt) || '2026-07-15 18:00';
  if (state.itemUrl) document.getElementById('ticket-link').href = state.itemUrl;
  renderFreshness();
}

async function fetchJson(url) {
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${separator}t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function refresh() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    let state;
    try {
      state = await fetchJson(liveStatusUrl);
    } catch {
      state = await fetchJson('./status.json');
    }
    renderState(state);
  } catch (error) {
    const freshness = document.getElementById('freshness');
    freshness.textContent = '云端连接失败';
    freshness.dataset.state = 'stale';
    if (!latestState) {
      document.getElementById('status').textContent = '等待首轮检查';
      document.getElementById('reason').textContent = error.message;
    }
  } finally {
    refreshInProgress = false;
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
refresh();
setInterval(refresh, 20_000);
setInterval(renderFreshness, 1_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
