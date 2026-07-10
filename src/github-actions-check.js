import { chromium } from 'playwright';

const itemUrl = process.env.DAMAI_ITEM_URL || 'https://m.damai.cn/shows/item.html?itemId=1063631004645';
const expiresAt = Date.parse(process.env.WATCHER_EXPIRES_AT || '2026-07-12T09:00:00+08:00');
const barkKey = String(process.env.BARK_KEY || '').trim();
const smsWebhookUrl = String(process.env.SMS_WEBHOOK_URL || '').trim();
const purchaseKeywords = ['立即购买', '立即预订', '选座购买', '立即抢购', '提交订单', '去购买'];
const soldOutKeywords = ['已售罄', '售罄', '缺货登记', '暂时无货', '无票', '不可售', '预售已售罄'];
const targetHints = ['7月19日', '07.19', '2026.07.19', '周日'];

function isSleepTime() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(new Date()));
  return hour >= 0 && hour < 9;
}

function compact(value, limit = 900) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
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
      // Responses such as images cannot be read as text.
    }
  });

  try {
    await page.goto(itemUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);
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
          const disabled = Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled') || /disabled|disable|不可|售罄/.test(`${className} ${label}`);
          return { label, disabled };
        })
        .filter((button) => button.label);
      return {
        title: document.title,
        text,
        buttons,
        activePurchaseButtons: buttons.filter((button) => !button.disabled && purchaseKeywords.some((word) => button.label.includes(word))),
        targetHints: targetHints.filter((hint) => text.includes(hint)),
        soldOutWords: soldOutKeywords.filter((word) => text.includes(word))
      };
    }, { purchaseKeywords, soldOutKeywords, targetHints });

    const responseText = apiTexts.join('\n');
    const pagePurchaseWords = purchaseKeywords.filter((word) => state.text.includes(word));
    const apiPurchaseWords = purchaseKeywords.filter((word) => responseText.includes(word));
    const allTargetHints = targetHints.filter((hint) => `${state.text}\n${responseText}`.includes(hint));
    const hasTarget = allTargetHints.length > 0;
    const hasActiveButton = state.activePurchaseButtons.length > 0;
    const possible = (hasActiveButton && hasTarget) || (apiPurchaseWords.length > 0 && hasTarget);
    const status = possible ? (hasActiveButton ? 'AVAILABLE' : 'POSSIBLE_AVAILABLE') : (state.soldOutWords.length ? 'SOLD_OUT' : 'UNKNOWN');
    const reason = hasActiveButton
      ? `Active purchase button: ${state.activePurchaseButtons.map((button) => button.label).join(' / ')}`
      : apiPurchaseWords.length
        ? `Purchase keyword in Damai response: ${apiPurchaseWords.join(' / ')}`
        : state.soldOutWords.length
          ? `Sold-out indicator: ${state.soldOutWords.join(' / ')}`
          : 'No purchase signal found.';

    console.log(JSON.stringify({ status, reason, targetHints: allTargetHints, title: state.title, pagePurchaseWords, at: new Date().toISOString() }));
    if (!possible) return;

    const title = '大麦可能有票了';
    const body = `${reason}\n${itemUrl}`;
    const payload = { title, message: body, itemUrl, status, reason, at: new Date().toISOString() };
    const channels = await Promise.allSettled([sendBark(title, body), sendSmsWebhook(payload)]);
    const delivered = channels.some((result) => result.status === 'fulfilled' && result.value === true);
    if (!delivered) {
      throw new Error('Ticket signal found, but no Bark Key or SMS webhook is configured.');
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
