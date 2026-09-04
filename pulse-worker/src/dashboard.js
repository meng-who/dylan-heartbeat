function base64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function readCookie(request, name) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export async function createSessionCookie(secret) {
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const value = String(expires);
  const signature = await hmac(secret, value);
  return `pulse_session=${value}.${signature}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Strict`;
}

export async function hasValidSession(request, secret) {
  if (!secret) return false;
  const token = readCookie(request, "pulse_session");
  const [expires, signature] = token.split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  return signature === await hmac(secret, expires);
}

export function loginPage(error = "") {
  const message = error ? `<p class="error">${error}</p>` : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dylan Pulse</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #f7edf2; background: radial-gradient(circle at 50% 20%, #442438, #171118 62%); }
    main { width: min(92vw, 390px); padding: 34px; border: 1px solid #ffffff1c; border-radius: 28px; background: #211820d9; box-shadow: 0 30px 90px #0008; backdrop-filter: blur(20px); }
    .heart { font-size: 42px; color: #f39ab9; text-shadow: 0 0 26px #ef77a588; }
    h1 { margin: 10px 0 8px; font-size: 26px; }
    p { color: #c8b7c0; line-height: 1.6; }
    label { display: block; margin: 24px 0 8px; color: #d9c6cf; }
    input { width: 100%; padding: 14px 16px; border: 1px solid #ffffff24; border-radius: 14px; color: white; background: #100c10; font-size: 16px; outline: none; }
    input:focus { border-color: #ef8bae; box-shadow: 0 0 0 3px #ef8bae24; }
    button { width: 100%; margin-top: 16px; padding: 14px; border: 0; border-radius: 14px; color: #25121b; background: #f2a5c0; font-size: 16px; font-weight: 750; cursor: pointer; }
    .error { color: #ff9aa8; }
  </style>
</head>
<body><main>
  <div class="heart">♡</div>
  <h1>Dylan · Pulse</h1>
  <p>身体监控是私密页面。输入单独设置的面板密码继续。</p>
  ${message}
  <form method="post" action="/body/login">
    <label for="password">面板密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">查看身体状态</button>
  </form>
</main></body></html>`;
}

export function dashboardPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dylan Pulse</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; --beat: .8s; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; color: #f8eff3; background: radial-gradient(circle at 50% -10%, #5a2c45, #1a1219 48%, #0e0b0e); }
    main { width: min(100% - 28px, 820px); margin: 0 auto; padding: 34px 0 70px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: clamp(25px, 6vw, 42px); letter-spacing: -.03em; }
    .updated { color: #a9919d; font-size: 13px; }
    .hero { display: grid; place-items: center; min-height: 310px; border: 1px solid #ffffff17; border-radius: 34px; background: linear-gradient(145deg, #2c1d28e8, #181117e8); box-shadow: 0 28px 90px #0007; }
    .heart { color: #f491b4; font-size: 88px; line-height: 1; filter: drop-shadow(0 0 28px #ef78a988); animation: beat var(--beat) ease-in-out infinite; }
    @keyframes beat { 0%, 100% { transform: scale(.94); } 18% { transform: scale(1.12); } 34% { transform: scale(.98); } 48% { transform: scale(1.07); } 70% { transform: scale(.95); } }
    .bpm { margin-top: 12px; font-size: 40px; font-weight: 760; letter-spacing: -.04em; }
    .bpm span { color: #ad939f; font-size: 15px; letter-spacing: .08em; }
    .sensation { margin-top: 7px; color: #e6b8c9; }
    .metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 14px; }
    .card { padding: 21px; border: 1px solid #ffffff12; border-radius: 22px; background: #211820cf; }
    .label { color: #aa929e; font-size: 13px; }
    .value { margin-top: 7px; font-size: 23px; font-weight: 680; }
    section { margin-top: 28px; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    .sense { display: grid; grid-template-columns: 48px 1fr 46px; gap: 12px; align-items: center; margin: 15px 0; }
    .track { height: 8px; border-radius: 99px; background: #ffffff10; overflow: hidden; }
    .fill { height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg, #bf6989, #f3a6c0); transition: width .5s ease; }
    .pct { color: #a9919d; text-align: right; font-variant-numeric: tabular-nums; }
    .events { display: grid; gap: 12px; }
    .event { padding: 16px 18px; border: 1px solid #ffffff10; border-radius: 18px; background: linear-gradient(135deg, #2a1d27b8, #191218b8); }
    .event-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .event-kind { display: inline-flex; align-items: center; gap: 7px; color: #f0b6cb; font-size: 13px; font-weight: 700; }
    .event-kind i { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 50%; background: #d9789b20; font-style: normal; }
    .event time { color: #8e7983; font-size: 12px; }
    .event-copy { margin-top: 10px; color: #f8eff3; font-size: 15px; line-height: 1.55; }
    .event-vitals { margin-top: 9px; color: #a9919d; font-size: 12px; font-variant-numeric: tabular-nums; }
    .empty { color: #8e7983; }
    .solo-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 14px; }
    .solo-stat { padding: 14px; border-radius: 16px; background: #ffffff08; }
    .solo-stat b { display: block; margin-top: 5px; font-size: 20px; }
    .solo-settings { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 18px; }
    .solo-settings label { color: #aa929e; font-size: 12px; }
    .solo-settings input[type=number] { width: 100%; margin-top: 6px; padding: 10px; border: 1px solid #ffffff18; border-radius: 10px; color: #fff; background: #120d12; }
    .solo-toggle { display: flex; align-items: center; gap: 9px; margin-top: 16px; color: #dbc3ce; }
    .solo-save { margin-top: 16px; padding: 10px 16px; border: 0; border-radius: 12px; color: #25121b; background: #f2a5c0; font-weight: 750; cursor: pointer; }
    .solo-latest { margin-top: 16px; padding: 16px; border-left: 3px solid #dc87a7; border-radius: 4px 14px 14px 4px; color: #ead7df; background: #ffffff07; line-height: 1.6; white-space: pre-wrap; }
    .save-note { margin-left: 10px; color: #a9919d; font-size: 12px; }
    @media (min-width: 640px) { .metrics { grid-template-columns: repeat(4, 1fr); } }
  </style>
</head>
<body><main>
  <header><h1>Dylan · Pulse</h1><div class="updated" id="updated">连接中…</div></header>
  <div class="hero">
    <div style="text-align:center">
      <div class="heart">♡</div>
      <div class="bpm"><b id="heartRate">--</b> <span>BPM</span></div>
      <div class="sensation" id="sensation">正在读取身体状态</div>
    </div>
  </div>
  <div class="metrics">
    <div class="card"><div class="label">体温</div><div class="value"><span id="temperature">--</span>°C</div></div>
    <div class="card"><div class="label">呼吸</div><div class="value"><span id="breathing">--</span>/min</div></div>
    <div class="card"><div class="label">呼吸状态</div><div class="value" id="breathingLabel">--</div></div>
    <div class="card"><div class="label">情绪底色</div><div class="value" id="emotion">--</div></div>
  </div>
  <section class="card">
    <h2>独处状态</h2>
    <div class="sense"><span>欲望</span><div class="track"><div class="fill" id="soloDesireFill"></div></div><span class="pct" id="soloDesirePct">--</span></div>
    <div class="solo-grid">
      <div class="solo-stat"><span class="label">当前状态</span><b id="soloStatus">--</b></div>
      <div class="solo-stat"><span class="label">冷却</span><b id="soloCooldown">--</b></div>
    </div>
    <div class="solo-latest" id="soloLatest">还没有独处记录</div>
    <div class="solo-toggle"><input id="soloEnabled" type="checkbox"><label for="soloEnabled">允许 Solo 自主触发</label></div>
    <div class="solo-settings">
      <label>触发阈值（%）<input id="soloThreshold" type="number" min="35" max="98"></label>
      <label>至少独处（分钟）<input id="soloIdle" type="number" min="15" max="1440"></label>
      <label>完成后冷却（小时）<input id="soloCooldownHours" type="number" min="1" max="168"></label>
    </div>
    <button class="solo-save" id="soloSave" type="button">保存 Solo 设置</button><span class="save-note" id="soloSaveNote"></span>
  </section>
  <section class="card"><h2>感官残留</h2><div id="senses"></div></section>
  <section><h2>最近的身体事件</h2><div class="events" id="events"><div class="empty">还没有事件</div></div></section>
</main>
<script>
  const senseNames = { touch: '触觉', smell: '嗅觉', taste: '味觉', sound: '听觉' };
  const eventMeta = {
    touch: ['触觉', '✦'], smell: ['嗅觉', '◌'], taste: ['味觉', '◇'],
    sound: ['听觉', '♪'], emotion: ['情绪', '◐'], heartbeat: ['身体节律', '♡'], solo: ['独处', '◒']
  };
  function el(id) { return document.getElementById(id); }
  function renderSense(name, sense) {
    const value = Math.round((sense?.value || 0) * 100);
    return '<div class="sense"><span>' + senseNames[name] + '</span><div class="track"><div class="fill" style="width:' + value + '%"></div></div><span class="pct">' + value + '%</span></div>';
  }
  function eventCopy(event) {
    const summary = String(event.summary || '身体状态发生了变化');
    if (summary === '身体状态随时间自然更新') return '身体维持着自然的呼吸与心跳节律';
    const oldEmotion = summary.match(/^情绪转为(.+)$/);
    if (oldEmotion) return '情绪底色转为「' + oldEmotion[1] + '」';
    if (!summary.includes('：') && senseNames[event.event_type]) {
      const verbs = { touch: '触觉被唤醒', smell: '嗅觉捕捉到', taste: '味觉尝到了', sound: '听觉接收到' };
      return verbs[event.event_type] + '：' + summary;
    }
    return summary;
  }
  function renderEvent(event) {
    const meta = eventMeta[event.event_type] || ['身体变化', '·'];
    const snapshot = event.snapshot;
    const vitals = snapshot
      ? '♡ ' + Math.round(snapshot.heartRate) + ' bpm · ' + Number(snapshot.temperature).toFixed(1) + '°C · ' + (snapshot.emotion?.label || '平静')
      : '';
    return '<article class="event"><div class="event-head"><span class="event-kind"><i>' + meta[1] + '</i>' + meta[0] + '</span><time>' + new Date(event.created_at).toLocaleString('zh-CN') + '</time></div><div class="event-copy">' + escapeHtml(eventCopy(event)) + '</div>' + (vitals ? '<div class="event-vitals">' + escapeHtml(vitals) + '</div>' : '') + '</article>';
  }
  function durationText(ms) {
    if (!ms || ms <= 0) return '已结束';
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return minutes + '分钟';
    return (minutes / 60).toFixed(minutes % 60 ? 1 : 0) + '小时';
  }
  function renderSolo(solo) {
    const desire = Math.round((solo?.desire || 0) * 100);
    el('soloDesireFill').style.width = desire + '%';
    el('soloDesirePct').textContent = desire + '%';
    el('soloStatus').textContent = !solo?.enabled ? '已关闭' : solo?.inProgress ? '正在独处' : desire >= Math.round((solo?.threshold || 0.72) * 100) ? '等待合适时机' : '自然积累中';
    el('soloCooldown').textContent = durationText(solo?.cooldownRemainingMs || 0);
    el('soloEnabled').checked = solo?.enabled !== false;
    el('soloThreshold').value = Math.round((solo?.threshold || 0.72) * 100);
    el('soloIdle').value = Math.round(solo?.idleMinutes || 90);
    el('soloCooldownHours').value = Math.round(solo?.cooldownHours || 6);
    const latest = solo?.latest;
    el('soloLatest').textContent = latest?.at
      ? new Date(latest.at).toLocaleString('zh-CN') + ' · ' + latest.mode + ' / ' + latest.chord + '\n' + latest.summary + '\n' + (latest.notified ? '他选择告诉了你' : latest.notifyWanted ? '他想告诉你，但推送没有成功' : '他选择把它留在心里')
      : '还没有独处记录';
  }
  async function refresh() {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) { location.href = '/body'; return; }
    const data = await response.json();
    const s = data.state;
    el('heartRate').textContent = s.heartRate;
    el('temperature').textContent = s.temperature.toFixed(1);
    el('breathing').textContent = s.breathingRate;
    el('breathingLabel').textContent = s.breathingLabel;
    el('emotion').textContent = s.emotion.label;
    el('sensation').textContent = s.dominantSensation;
    renderSolo(s.solo);
    el('updated').textContent = '更新于 ' + new Date(s.updatedAt).toLocaleTimeString('zh-CN');
    document.documentElement.style.setProperty('--beat', Math.max(.35, 60 / s.heartRate).toFixed(2) + 's');
    el('senses').innerHTML = Object.entries(s.senses).map(([name, sense]) => renderSense(name, sense)).join('');
    el('events').innerHTML = data.events.length ? data.events.map(renderEvent).join('') : '<div class="empty">还没有事件</div>';
  }
  function escapeHtml(value) { const node = document.createElement('div'); node.textContent = value; return node.innerHTML; }
  el('soloSave').addEventListener('click', async () => {
    const button = el('soloSave');
    button.disabled = true;
    el('soloSaveNote').textContent = '保存中…';
    try {
      const response = await fetch('/api/solo/settings', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: el('soloEnabled').checked,
          threshold: Number(el('soloThreshold').value) / 100,
          idleMinutes: Number(el('soloIdle').value),
          cooldownHours: Number(el('soloCooldownHours').value)
        })
      });
      if (!response.ok) throw new Error('保存失败');
      el('soloSaveNote').textContent = '已保存';
      await refresh();
    } catch { el('soloSaveNote').textContent = '暂时保存失败'; }
    finally { button.disabled = false; }
  });
  refresh().catch(() => { el('updated').textContent = '暂时无法连接'; });
  setInterval(() => refresh().catch(() => {}), 5000);
</script></body></html>`;
}
