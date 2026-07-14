import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const itemUrl = process.env.DAMAI_ITEM_URL || 'https://m.damai.cn/shows/item.html?itemId=1063631004645';
const expiresAt = Date.parse(process.env.WATCHER_EXPIRES_AT || '2026-07-15T18:00:00+08:00');
const barkKey = String(process.env.BARK_KEY || '').trim();
const smsWebhookUrl = String(process.env.SMS_WEBHOOK_URL || '').trim();
const statusFile = String(process.env.STATUS_FILE || '').trim();
const liveStatusToken = String(process.env.LIVE_STATUS_TOKEN || '').trim();
const liveStatusRepository = String(process.env.LIVE_STATUS_REPOSITORY || '').trim();
const liveStatusIssueNumber = String(process.env.LIVE_STATUS_ISSUE_NUMBER || '').trim();
const liveStatusRawBranch = String(process.env.LIVE_STATUS_RAW_BRANCH || 'live-status').trim();
const runForMs = Math.max(20_000, Number(process.env.RUN_FOR_SECONDS || 230) * 1000);
const pollEveryMs = Math.max(15_000, Number(process.env.POLL_INTERVAL_SECONDS || 20) * 1000);
let liveStatusContentSha = '';
const purchaseKeywords = ['\u7acb\u5373\u8d2d\u4e70', '\u7acb\u5373\u9884\u8ba2', '\u9009\u5ea7\u8d2d\u4e70', '\u7acb\u5373\u62a2\u8d2d', '\u63d0\u4ea4\u8ba2\u5355', '\u53bb\u8d2d\u4e70'];
const soldOutKeywords = ['\u5df2\u552e\u7f44', '\u552e\u7f44', '\u7f3a\u8d27\u767b\u8bb0', '\u6682\u65f6\u65e0\u8d27', '\u65e0\u7968', '\u4e0d\u53ef\u552e', '\u9884\u552e\u5df2\u552e\u7f44'];
const targetHints = ['7\u670819\u65e5', '07.19', '2026.07.19', '\u5468\u65e5'];

function isSleepTime() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(new Date()));
  return hour < 9;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeStatus(payload) {
  if (!statusFile) return;
  await mkdir(path.dirname(statusFile), { recursive: true });
  await writeFile(statusFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function githubHeaders() {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${liveStatusToken}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28'
  };
}

async function githubRequest(pathname, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${liveStatusRepository}${pathname}`, {
    ...options,
    headers: { ...githubHeaders(), ...options.headers }
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    const error = new Error(`GitHub ${options.method || 'GET'} ${pathname} returned HTTP ${response.status}: ${detail}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function readLiveStatus() {
  if (!liveStatusToken || !liveStatusRepository || !liveStatusIssueNumber) return null;
  try {
    const issue = await githubRequest(`/issues/${liveStatusIssueNumber}`);
    return JSON.parse(issue.body || '{}');
  } catch (error) {
    console.warn(`Could not restore cumulative check count: ${error.message}`);
    return null;
  }
}

async function publishLiveStatus(payload) {
  if (!liveStatusToken || !liveStatusRepository || !liveStatusIssueNumber) return;
  try {
    await githubRequest(`/issues/${liveStatusIssueNumber}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: JSON.stringify(payload) })
    });
  } catch (error) {
    console.warn(`Live issue update failed: ${error.message}`);
  }
}

async function createRawStatusBranch(payload) {
  const blob = await githubRequest('/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: `${JSON.stringify(payload, null, 2)}\n`, encoding: 'utf-8' })
  });
  const tree = await githubRequest('/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      tree: [{ path: 'status.json', mode: '100644', type: 'blob', sha: blob.sha }]
    })
  });
  const commit = await githubRequest('/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: `Live status ${payload.at}`,
      tree: tree.sha,
      parents: []
    })
  });
  const refPath = `/git/refs/heads/${liveStatusRawBranch.split('/').map(encodeURIComponent).join('/')}`;
  const updateResponse = await fetch(`https://api.github.com/repos/${liveStatusRepository}${refPath}`, {
    method: 'PATCH',
    headers: githubHeaders(),
    body: JSON.stringify({ sha: commit.sha, force: true })
  });
  if (!updateResponse.ok) {
    if (![404, 422].includes(updateResponse.status)) {
      throw new Error(`GitHub PATCH ${refPath} returned HTTP ${updateResponse.status}: ${(await updateResponse.text()).slice(0, 300)}`);
    }
    await githubRequest('/git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${liveStatusRawBranch}`, sha: commit.sha })
    });
  }
  liveStatusContentSha = blob.sha;
}

async function loadRawStatusSha(payload) {
  const response = await fetch(`https://api.github.com/repos/${liveStatusRepository}/contents/status.json?ref=${encodeURIComponent(liveStatusRawBranch)}`, {
    headers: githubHeaders()
  });
  if (response.ok) {
    const file = await response.json();
    liveStatusContentSha = file.sha;
    return false;
  }
  if (response.status !== 404) {
    throw new Error(`Raw status lookup returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  await createRawStatusBranch(payload);
  return true;
}

async function updateRawStatus(payload, canRetry = true) {
  if (!liveStatusContentSha && await loadRawStatusSha(payload)) return;
  try {
    const result = await githubRequest('/contents/status.json', {
      method: 'PUT',
      body: JSON.stringify({
        message: `Live status ${payload.at}`,
        content: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8').toString('base64'),
        branch: liveStatusRawBranch,
        sha: liveStatusContentSha
      })
    });
    liveStatusContentSha = result.content.sha;
  } catch (error) {
    if (canRetry && [409, 422].includes(error.status)) {
      liveStatusContentSha = '';
      await updateRawStatus(payload, false);
      return;
    }
    throw error;
  }
}

async function publishRawStatus(payload) {
  if (!liveStatusToken || !liveStatusRepository || !liveStatusRawBranch) return;
  try {
    await updateRawStatus(payload);
  } catch (error) {
    console.warn(`Raw live status update failed: ${error.message}`);
  }
}

async function sendBark(title, body) {
  if (!barkKey) return false;
  const params = new URLSearchParams({
    sound: 'alarm',
    level: isSleepTime() ? 'critical' : 'timeSensitive',
    volume: isSleepTime() ? '10' : '8'
  });
  if (isSleepTime()) params.set('call', '1');
  const endpoint = `https://api.day.app/${encodeURIComponent(barkKey)}/${encodeURIComponent(title)}/${encodeURIComponent(body)}?${params}`;
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Bark returned HTTP ${response.status}`);
  return true;
}

async function sendSmsWebhook(payload) {
  if (!smsWebhookUrl) return false;
  const response = await fetch(smsWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`SMS webhook returned HTTP ${response.status}`);
  return true;
}

async function inspect(page, apiTexts) {
  apiTexts.length = 0;
  await page.goto(itemUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await wait(4_000);
  const state = await page.evaluate(({ purchaseKeywords, soldOutKeywords, targetHints }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const text = normalize(document.body?.innerText || '');
    const buttons = Array.from(document.querySelectorAll('button, a, [role="button"], .buybtn, .buy-button, .next-btn, .dm-btn'))
      .filter(visible)
      .map((element) => {
        const label = normalize(element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('title'));
        const className = normalize(element.getAttribute('class'));
        const disabled = Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled') || /disabled|disable|\u4e0d\u53ef|\u552e\u7f44/.test(`${className} ${label}`);
        return { label, disabled };
      })
      .filter((button) => button.label);
    return {
      title: document.title,
      text,
      activePurchaseButtons: buttons.filter((button) => !button.disabled && purchaseKeywords.some((word) => button.label.includes(word))),
      soldOutWords: soldOutKeywords.filter((word) => text.includes(word))
    };
  }, { purchaseKeywords, soldOutKeywords, targetHints });

  const responseText = apiTexts.join('\n');
  const apiPurchaseWords = purchaseKeywords.filter((word) => responseText.includes(word));
  const pagePurchaseWords = purchaseKeywords.filter((word) => state.text.includes(word));
  const allTargetHints = targetHints.filter((hint) => `${state.text}\n${responseText}`.includes(hint));
  const hasActiveButton = state.activePurchaseButtons.length > 0;
  const possible = (hasActiveButton && allTargetHints.length > 0) || (apiPurchaseWords.length > 0 && allTargetHints.length > 0);
  const status = possible ? (hasActiveButton ? 'AVAILABLE' : 'POSSIBLE_AVAILABLE') : (state.soldOutWords.length ? 'SOLD_OUT' : 'UNKNOWN');
  const reason = hasActiveButton
    ? `Active purchase button: ${state.activePurchaseButtons.map((button) => button.label).join(' / ')}`
    : apiPurchaseWords.length
      ? `Purchase keyword in Damai response: ${apiPurchaseWords.join(' / ')}`
      : state.soldOutWords.length
        ? `Sold-out indicator: ${state.soldOutWords.join(' / ')}`
        : 'No purchase signal found.';
  return { status, reason, possible, targetHints: allTargetHints, title: state.title, pagePurchaseWords };
}

async function main() {
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    console.log('Monitoring window has ended.');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  const apiTexts = [];
  page.on('response', async (response) => {
    if (!/damai|mtop/i.test(response.url())) return;
    try {
      const text = await response.text();
      if (text.length <= 2_000_000) apiTexts.push(text);
    } catch {
      // Ignore binary responses.
    }
  });

  try {
    const stopAt = Math.min(Date.now() + runForMs, expiresAt);
    const previousState = await readLiveStatus();
    let totalChecks = Number(previousState?.totalChecks);
    if (!Number.isFinite(totalChecks) || totalChecks < 0) totalChecks = Number(previousState?.attempt) || 0;
    let attempt = 0;
    while (Date.now() < stopAt) {
      attempt += 1;
      totalChecks += 1;
      const checkStartedAt = Date.now();
      const result = await inspect(page, apiTexts);
      const snapshot = {
        ...result,
        availableCount: result.possible ? null : 0,
        inventoryNote: result.possible ? 'Damai does not publish the exact remaining quantity.' : 'No purchasable ticket signal found.',
        runAttempt: attempt,
        totalChecks,
        at: new Date().toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        itemUrl
      };
      await Promise.all([writeStatus(snapshot), publishLiveStatus(snapshot), publishRawStatus(snapshot)]);
      console.log(JSON.stringify(snapshot));
      if (result.possible) {
        const title = '\u5927\u9ea6\u53ef\u80fd\u6709\u7968\u4e86';
        const body = `${result.reason}\n${itemUrl}`;
        const payload = { title, message: body, itemUrl, status: result.status, reason: result.reason, at: new Date().toISOString() };
        const channels = await Promise.allSettled([sendBark(title, body), sendSmsWebhook(payload)]);
        const delivered = channels.some((channel) => channel.status === 'fulfilled' && channel.value === true);
        if (!delivered) throw new Error('Ticket signal found, but no push channel is configured.');
        return;
      }
      const nextCheckAt = Math.min(checkStartedAt + pollEveryMs, stopAt);
      if (nextCheckAt > Date.now()) await wait(nextCheckAt - Date.now());
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  writeStatus({ status: 'ERROR', reason: error.message, at: new Date().toISOString(), itemUrl }).catch(() => {});
  console.error(error.stack || error.message);
  process.exit(1);
});
