# 大麦放票手机提醒工具

这是一个“只提醒、不下单”的大麦余票监测工具。后台服务负责实时监测大麦页面，iPhone 通过手机 Web App 登录、配置和接收提醒。

## 关键结论

iPhone 上的网页或 PWA 不能像原生闹钟一样在后台一直运行监测；普通 iOS App 的后台刷新也不能保证实时、连续轮询。手机可以用流量登录和接收提醒，但不能作为可靠的后台监测执行端。

如果手机不和电脑同一个 Wi-Fi，请把服务部署到公网服务器、NAS 公网地址或内网穿透地址。部署说明见 `DEPLOY_PUBLIC.md`。

## 失效时间

本工具默认只运行到：

```text
2026-07-15T18:00:00+08:00
```

过了这个时间，服务会自动停止监测，并拒绝再次启动。

## 启动移动端服务

```powershell
cd C:\Users\86191\Documents\Codex\2026-07-09\xia\outputs\damai-ticket-watcher
.\start-mobile-server.ps1
```

首次启动会自动创建 `config.json`，并在终端打印 6 位登录码。手机访问：

```text
http://电脑或服务器IP:8787
```

如果部署到云服务器，建议配置 HTTPS 域名。iPhone Web Push 需要 HTTPS 和“添加到主屏幕”后才可靠。短信和 Bark 不依赖 Web Push。

## iPhone 使用

1. 用 Safari 打开服务地址。
2. 输入手机号和终端里打印的登录码。
3. 填入大麦商品详情链接，例如 `https://detail.damai.cn/item.htm?id=...`。
4. 设置休息时间为 `00:00` 到 `09:00`。
5. 点“短信测试”和“夜间铃声测试”确认提醒通道。
6. 用 Safari 分享按钮添加到主屏幕。

## 提醒通道

- 平常时段默认：`sms,webpush`
- 休息时段默认：`bark,call,sms,webpush`
- `sms`：支持短信 Webhook，也支持 Twilio 环境变量。
- `bark`：适合 iPhone 夜间铃声提醒。填写 Bark App 里的 Key。
- `call`：夜间电话提醒。可填电话 Webhook，也支持 Twilio Call 环境变量。
- `webpush`：手机 Web App 推送。iPhone 需要 HTTPS + 添加到主屏幕。

## 短信配置

方式一：短信 Webhook

在手机页面填 `短信 Webhook`。命中时服务会 POST JSON：

```json
{
  "channel": "sms",
  "phone": "你的手机号",
  "title": "大麦有票提醒",
  "message": "发现可购买按钮..."
}
```

方式二：Twilio 环境变量

```powershell
$env:TWILIO_ACCOUNT_SID="..."
$env:TWILIO_AUTH_TOKEN="..."
$env:TWILIO_FROM="+1..."
$env:TWILIO_TO="+86..."
.\start-mobile-server.ps1
```

## Bark 夜间铃声

在 iPhone 安装 Bark，复制 Bark Key 到页面里的 `Bark Key`。夜间提醒会发送：

- `sound=alarm`
- `call=1`
- `level=critical`
- `volume=10`

Critical 是否真正生效取决于 Bark App 和 iOS 通知权限设置。

## 监测说明

程序只识别页面上的“立即购买 / 选座购买 / 立即预订”等信号并提醒。它不会点击购买按钮、不会提交订单、不会绕过登录、验证码或平台风控。如果大麦页面要求安全验证，需要你手动处理。

## 常用命令

```powershell
npm run install-browser
.\start-mobile-server.ps1
```

旧的电脑弹窗版仍可用：

```powershell
.\start-watcher.ps1
```
