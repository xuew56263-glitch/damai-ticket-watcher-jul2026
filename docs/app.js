const labels = {
  AVAILABLE: '检测到可购信号',
  POSSIBLE_AVAILABLE: '检测到可能可购信号',
  SOLD_OUT: '暂未发现余票',
  UNKNOWN: '正在监测',
  ERROR: '本轮检查异常'
};

function formatDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date);
}

async function refresh() {
  try {
    const liveUrl = `https://api.github.com/repos/xuew56263-glitch/damai-ticket-watcher-jul2026/issues/1?t=${Date.now()}`;
    const response = await fetch(liveUrl, { cache: 'no-store', headers: { accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error('状态尚未发布');
    const issue = await response.json();
    const state = JSON.parse(issue.body);
    document.getElementById('status').textContent = labels[state.status] || state.status || '正在监测';
    document.getElementById('status').dataset.state = state.status || 'UNKNOWN';
    document.getElementById('reason').textContent = state.reason || '未发现可购信号。';
    document.getElementById('checked-at').textContent = formatDate(state.at);
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
    document.getElementById('attempt').textContent = state.attempt || '--';
    document.getElementById('expires-at').textContent = formatDate(state.expiresAt) || '2026-07-15 18:00';
    if (state.itemUrl) document.getElementById('ticket-link').href = state.itemUrl;
  } catch (error) {
    document.getElementById('status').textContent = '等待首轮检查';
    document.getElementById('reason').textContent = error.message;
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
refresh();
setInterval(refresh, 70_000);
