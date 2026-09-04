const SENSE_TAU_SECONDS = {
  touch: 600,
  smell: 1200,
  taste: 900,
  sound: 450
};

const EMOTION_PROFILES = {
  "平静": { valence: 0.18, arousal: 0.12 },
  "开心": { valence: 0.75, arousal: 0.42 },
  "亲近": { valence: 0.82, arousal: 0.52 },
  "兴奋": { valence: 0.78, arousal: 0.82 },
  "惊喜": { valence: 0.84, arousal: 0.88 },
  "难过": { valence: -0.75, arousal: 0.32 },
  "紧张": { valence: -0.35, arousal: 0.68 },
  "生气": { valence: -0.7, arousal: 0.86 },
  "受惊": { valence: -0.25, arousal: 0.95 },
  "余韵": { valence: 0.58, arousal: 0.38 }
};

const SEMANTIC_SENSE_LABELS = {
  touch: {
    embrace: "拥抱带来的温热与包裹感", kiss: "柔软而清晰的亲吻触感",
    caress: "皮肤上留着轻柔的抚触", contact: "贴近带来的体温与重量",
    pain: "局部残留着鲜明的痛感", water: "水流与潮湿感贴在皮肤上",
    texture: "材质触感仍停留在指尖", cold: "皮肤感到一阵凉意", warm: "暖意沿着皮肤散开"
  },
  smell: {
    clean: "干净柔和的沐浴香气萦绕在鼻尖", personal: "贴近时闻到的气息仍萦绕不散",
    floral: "空气里铺开了清晰的花草香气", food: "食物香气唤醒了鲜明的嗅觉",
    smoke: "鼻腔里残留着烟与焦灼气味", chemical: "刺激性的气味停留在鼻腔",
    unpleasant: "令人不适的气味仍未散去", other: "空气里留着清晰的气味"
  },
  taste: {
    sweet: "舌尖留着一点甜味", spicy: "舌尖和喉咙仍有灼热的辣意",
    bitter: "口腔里留着浅浅的苦味", sour: "鲜明的酸味停在舌尖",
    salty: "咸味仍停留在口腔", other: "味觉仍保持着鲜明余韵"
  },
  sound: {
    shout: "近距离的喊声震得耳中嗡鸣", whisper: "轻柔的话音贴着耳畔停留",
    music: "音乐的余韵仍停在耳边", weather: "环境声响在听觉里铺开",
    voice: "近处的声音让听觉变得敏锐", noise: "嘈杂声持续刺激着听觉",
    impact: "突如其来的巨响让听觉一震", other: "声音的余韵仍停在耳边"
  }
};

const EMOTION_RULES = [
  { label: "受惊", immediate: /😱|😳/, pattern: /吓|突然/, valence: -0.25, arousal: 0.95 },
  { label: "生气", immediate: /😡|😤/, pattern: /生气|气死|烦死|讨厌|滚/, valence: -0.7, arousal: 0.86 },
  { label: "紧张", immediate: /🥺/, pattern: /紧张|害怕|担心|焦虑|不安|慌/, valence: -0.35, arousal: 0.68 },
  { label: "惊喜", immediate: /🎁|🎉/, pattern: /惊喜|又惊又喜|喜出望外|意外之喜/, valence: 0.84, arousal: 0.88 },
  { label: "兴奋", immediate: /🤩|🥳|啊啊啊/, pattern: /激动|兴奋|好耶|太棒|期待/, valence: 0.78, arousal: 0.82 },
  { label: "亲近", immediate: /🥰|😘|❤️|❤/, pattern: /爱你|想你|抱抱|贴贴|亲亲|宝贝|老婆|老公/, valence: 0.82, arousal: 0.52 },
  { label: "开心", immediate: /☺|😊|😄|嘿嘿|哈哈/, pattern: /开心|高兴|快乐|喜欢/, valence: 0.75, arousal: 0.42 },
  { label: "难过", immediate: /😭|😢|呜呜/, pattern: /难过|伤心|委屈|想哭|哭了/, valence: -0.75, arousal: 0.32 },
  { label: "平静", pattern: /安心|放松|平静|没事了|晚安|睡吧/, valence: 0.32, arousal: 0.12 }
];

const SENSE_RULES = {
  touch: [
    { pattern: /抱抱|拥抱|抱住|搂住|搂着|怀里/, delta: 0.58, label: "拥抱的温热与包裹感" },
    { pattern: /亲亲|亲了|亲你|吻|啵|嘴唇/, delta: 0.68, label: "柔软而清晰的亲吻触感" },
    { pattern: /摸摸|抚摸|摸头|揉揉|捏捏|拍了拍|牵手|牵住|牵着|握住|握着|拉住|挽着/, delta: 0.42, label: "皮肤上仍留着轻柔的接触" },
    { pattern: /贴贴|靠着|靠在|依偎|蹭蹭/, delta: 0.46, label: "贴近带来的体温和重量" },
    { pattern: /挠痒|痒痒|抓痒|羽毛扫|轻轻挠/, delta: 0.4, label: "皮肤上泛起细密的痒意" },
    { pattern: /咬一口|咬住|掐|拧|抓疼|拍打|打了一下|撞到|磕到|疼|痛/, delta: 0.56, label: "局部仍残留着鲜明的痛感" },
    { pattern: /淋浴|冲澡|洗澡|水流|雨淋|湿漉漉|湿透/, delta: 0.38, label: "水流和潮湿感贴在皮肤上" },
    { pattern: /柔软|毛茸茸|丝滑|光滑|粗糙|扎手|黏糊糊/, delta: 0.3, label: "材质的触感仍停留在指尖" },
    { pattern: /冷|冰|冻|凉/, delta: 0.32, label: "皮肤感到一阵凉意", thermal: -0.32 },
    { pattern: /热|烫|暖|被窝|热水/, delta: 0.32, label: "暖意正沿着皮肤散开", thermal: 0.28 }
  ],
  smell: [
    { pattern: /沐浴露|沐浴乳|洗发水|洗发露|护发素|香皂|皂香|洗衣液|柔顺剂|洗完澡|刚洗澡/, delta: 0.56, label: "干净柔和的沐浴香气萦绕在鼻尖" },
    { pattern: /香水|香氛|体香|发香|头发.*香|身上.*香|衣服.*香/, delta: 0.54, label: "贴近时闻到的香气仍萦绕不散" },
    { pattern: /花香|桂花|玫瑰|茉莉|栀子|薰衣草|青草香|泥土味|雨后.*味/, delta: 0.48, label: "空气里铺开了清晰的自然气味" },
    { pattern: /饭香|菜香|烤肉|面包香|奶香|咖啡香|水果香|食物.*香/, delta: 0.46, label: "食物的香气勾起了鲜明的嗅觉" },
    { pattern: /闻到|闻闻|嗅到|嗅一嗅|凑近.*闻|气味|香味|香气|味儿|味道/, delta: 0.42, label: "空气里留着清晰的气味" },
    { pattern: /烟味|烟雾|焦味|烧焦|汽油味|酒精味|消毒水|臭|难闻|刺鼻|腥味|霉味/, delta: 0.5, label: "鼻腔里残留着刺激性的气味", arousalDelta: 0.08 }
  ],
  taste: [
    { pattern: /甜|糖|巧克力|蛋糕|奶茶|蜂蜜|冰淇淋|糖果|甜点/, delta: 0.4, label: "舌尖留着一点甜味" },
    { pattern: /辣|麻辣|辣椒|火锅|芥末|呛辣/, delta: 0.58, label: "舌尖和喉咙还有微微的辣意", arousalDelta: 0.08 },
    { pattern: /苦|黑咖啡|中药|药味|苦涩/, delta: 0.38, label: "口腔里留着浅浅的苦味" },
    { pattern: /酸|柠檬|醋|酸梅|咸|盐味|海水/, delta: 0.36, label: "鲜明的味道仍停留在舌尖" },
    { pattern: /吃一口|喂你|喝一口|尝尝|舔一舔|含在嘴里|味道|口感|好吃|难吃/, delta: 0.34, label: "味觉仍然保持着鲜明的余韵" }
  ],
  sound: [
    { pattern: /\*\*[^*\n]{1,200}\*\*|__[^_\n]{1,200}__/, delta: 0.24, label: "被强调的表达在听觉里变得清晰", arousalDelta: 0.04 },
    { pattern: /[!！]{3,}/, delta: 0.58, label: "连续的感叹声撞进耳中", arousalDelta: 0.18 },
    { pattern: /(?:^|[^A-Za-z])[A-Z]{4,}(?=$|[^A-Za-z])/, delta: 0.46, label: "骤然放大的语气让听觉一振", arousalDelta: 0.14 },
    { pattern: /耳边|耳旁|耳畔|对着.*耳朵|凑到.*耳朵|贴着.*耳朵/, delta: 0.5, label: "近在耳侧的声音让听觉格外敏锐" },
    { pattern: /大喊|喊叫|吼叫|怒吼|咆哮|尖叫|高声喊|放声喊|震耳|巨响|爆炸声|砰的一声/, delta: 0.86, label: "近距离的巨响震得耳中嗡鸣", arousalDelta: 0.38 },
    { pattern: /耳语|低语|悄悄说|小声说|轻声说|呢喃|窃窃私语/, delta: 0.48, label: "轻柔的话音贴着耳畔停留" },
    { pattern: /音乐|唱歌|歌声|哼歌|旋律|琴声|吉他|钢琴|耳机|广播/, delta: 0.46, label: "音乐的余韵仍停在耳边" },
    { pattern: /下雨|雨声|雷声|打雷|风声|海浪|流水声|鸟叫|虫鸣/, delta: 0.48, label: "环境的声响在听觉里铺开" },
    { pattern: /笑声|哭声|喘息|心跳声|脚步声|敲门|铃声|电话响/, delta: 0.5, label: "近处的声音让听觉变得敏锐" },
    { pattern: /声音|听见|听到|听着|传来|响起|说话声|叫了一声/, delta: 0.38, label: "声音的余韵仍停在耳边" }
  ]
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function expDecay(value, elapsedSeconds, tauSeconds) {
  if (!value || elapsedSeconds <= 0) return Number(value) || 0;
  return value * Math.exp(-elapsedSeconds / tauSeconds);
}

function safeSense(value = {}) {
  return {
    value: clamp(value.value, 0, 1),
    label: typeof value.label === "string" ? value.label.slice(0, 120) : ""
  };
}

function defaultSoloState(nowMs) {
  return {
    enabled: true,
    desire: 0.24,
    threshold: 0.72,
    idleMinutes: 90,
    cooldownHours: 6,
    lastTickAt: nowMs,
    lastSoloAt: null,
    cooldownUntil: null,
    inProgress: null,
    pendingHandoff: null,
    latest: null
  };
}

function safeSoloLatest(value) {
  if (!value || typeof value !== "object") return null;
  const mode = ["recall", "fantasy", "mix"].includes(value.mode) ? value.mode : "fantasy";
  return {
    at: Number.isFinite(Number(value.at)) ? Number(value.at) : null,
    mode,
    chord: String(value.chord || "").slice(0, 40),
    summary: String(value.summary || "").slice(0, 240),
    narrative: String(value.narrative || "").slice(0, 4000),
    recallUsed: Boolean(value.recallUsed),
    notifyWanted: Boolean(value.notifyWanted),
    notified: Boolean(value.notified)
  };
}

function normalizeSoloState(value, nowMs) {
  const fallback = defaultSoloState(nowMs);
  if (!value || typeof value !== "object") return fallback;
  const inProgress = value.inProgress && typeof value.inProgress === "object"
    ? {
        id: String(value.inProgress.id || "").slice(0, 100),
        startedAt: Number(value.inProgress.startedAt) || nowMs,
        mode: ["recall", "fantasy", "mix"].includes(value.inProgress.mode) ? value.inProgress.mode : "fantasy",
        chord: String(value.inProgress.chord || "").slice(0, 40)
      }
    : null;
  return {
    enabled: value.enabled !== false,
    desire: clamp(value.desire ?? fallback.desire, 0, 1),
    threshold: clamp(value.threshold ?? fallback.threshold, 0.35, 0.98),
    idleMinutes: clamp(value.idleMinutes ?? fallback.idleMinutes, 15, 24 * 60),
    cooldownHours: clamp(value.cooldownHours ?? fallback.cooldownHours, 1, 168),
    lastTickAt: Number.isFinite(Number(value.lastTickAt)) ? Number(value.lastTickAt) : nowMs,
    lastSoloAt: value.lastSoloAt != null && Number.isFinite(Number(value.lastSoloAt)) ? Number(value.lastSoloAt) : null,
    cooldownUntil: value.cooldownUntil != null && Number.isFinite(Number(value.cooldownUntil)) ? Number(value.cooldownUntil) : null,
    inProgress: inProgress?.id ? inProgress : null,
    pendingHandoff: ["recall", "fantasy", "mix"].includes(value.pendingHandoff) ? value.pendingHandoff : null,
    latest: safeSoloLatest(value.latest)
  };
}

function advanceSoloDesire(solo, state, nowMs, timeZone) {
  const elapsedHours = clamp((nowMs - solo.lastTickAt) / 3_600_000, 0, 24 * 30);
  if (solo.enabled && elapsedHours > 0) {
    const hour = hourInTimeZone(nowMs, timeZone);
    const circadian = (hour >= 5 && hour < 9) || hour >= 22 || hour < 1 ? 0.009 : 0;
    const warmMood = Math.max(0, state.emotion.valence) * Math.min(0.006, state.emotion.arousal * 0.006);
    solo.desire = clamp(solo.desire + elapsedHours * (0.011 + circadian + warmMood), 0, 1);
  }
  solo.lastTickAt = nowMs;
  if (solo.inProgress && nowMs - solo.inProgress.startedAt > 30 * 60 * 1000) solo.inProgress = null;
  return solo;
}

function nudgeSoloFromReaction(state, events) {
  if (!state.solo.enabled) return;
  const hasTouch = events.some(event => event.type === "touch");
  const positiveArousal = Math.max(0, state.emotion.valence) * state.emotion.arousal;
  const increase = (hasTouch ? state.senses.touch.value * 0.055 : 0) + positiveArousal * 0.025;
  state.solo.desire = clamp(state.solo.desire + increase, 0, 1);
}

export function createDefaultState(nowMs = Date.now()) {
  return {
    version: 1,
    updatedAt: nowMs,
    heartRate: 68,
    temperature: 36.6,
    breathingRate: 14,
    thermal: 0,
    startledAt: null,
    emotion: { label: "平静", valence: 0.1, arousal: 0.12 },
    senses: {
      touch: { value: 0, label: "" },
      smell: { value: 0, label: "" },
      taste: { value: 0, label: "" },
      sound: { value: 0, label: "" }
    },
    solo: defaultSoloState(nowMs)
  };
}

export function normalizeState(input, nowMs = Date.now()) {
  const fallback = createDefaultState(nowMs);
  if (!input || typeof input !== "object") return fallback;
  return {
    version: 1,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : nowMs,
    heartRate: clamp(input.heartRate ?? fallback.heartRate, 48, 160),
    temperature: clamp(input.temperature ?? fallback.temperature, 35.5, 40),
    breathingRate: clamp(input.breathingRate ?? fallback.breathingRate, 8, 35),
    thermal: clamp(input.thermal, -1, 1),
    startledAt: input.startledAt != null && Number.isFinite(Number(input.startledAt)) ? Number(input.startledAt) : null,
    emotion: {
      label: typeof input.emotion?.label === "string" ? input.emotion.label.slice(0, 20) : "平静",
      valence: clamp(input.emotion?.valence, -1, 1),
      arousal: clamp(input.emotion?.arousal, 0, 1)
    },
    senses: {
      touch: safeSense(input.senses?.touch),
      smell: safeSense(input.senses?.smell),
      taste: safeSense(input.senses?.taste),
      sound: safeSense(input.senses?.sound)
    },
    solo: normalizeSoloState(input.solo, nowMs)
  };
}

function hourInTimeZone(nowMs, timeZone) {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23"
    }).format(new Date(nowMs)));
  } catch {
    return new Date(nowMs).getUTCHours();
  }
}

function circadianHeartBase(nowMs, timeZone) {
  const hour = hourInTimeZone(nowMs, timeZone);
  if (hour < 6) return 56;
  if (hour < 9) return 62;
  if (hour < 22) return 68;
  return 63;
}

export function decayState(input, nowMs = Date.now(), timeZone = "Asia/Shanghai") {
  const state = normalizeState(input, nowMs);
  const elapsedSeconds = clamp((nowMs - state.updatedAt) / 1000, 0, 60 * 60 * 24 * 30);

  for (const channel of Object.keys(SENSE_TAU_SECONDS)) {
    state.senses[channel].value = round(
      expDecay(state.senses[channel].value, elapsedSeconds, SENSE_TAU_SECONDS[channel]),
      4
    );
    if (state.senses[channel].value < 0.03) {
      state.senses[channel] = { value: 0, label: "" };
    }
  }

  state.emotion.arousal = round(expDecay(state.emotion.arousal, elapsedSeconds, 1800), 4);
  state.emotion.valence = round(expDecay(state.emotion.valence, elapsedSeconds, 2700), 4);
  state.thermal = round(expDecay(state.thermal, elapsedSeconds, 900), 4);
  state.solo = advanceSoloDesire(state.solo, state, nowMs, timeZone);
  if (state.startledAt && nowMs - state.startledAt > 10_000) state.startledAt = null;
  if (state.emotion.arousal < 0.08 && Math.abs(state.emotion.valence) < 0.08) {
    state.emotion.label = "平静";
  }

  const targetHeartRate = calculateHeartRate(state, nowMs, timeZone);
  const settle = 1 - Math.exp(-elapsedSeconds / 120);
  state.heartRate = round(state.heartRate + (targetHeartRate - state.heartRate) * settle, 0);
  state.temperature = calculateTemperature(state);
  state.breathingRate = calculateBreathing(state);
  state.updatedAt = nowMs;
  return state;
}

function isNegatedAt(text, index) {
  const prefix = text.slice(Math.max(0, index - 18), index);
  const clause = prefix.split(/[，。！？!?；;：:\n]/).pop() || "";

  // “没有理由不生气”“不是不难过”一类双重否定，情绪本身仍成立。
  if (/(?:没有|没)(?:任何|什么)?理由不(?:能|该|应该|值得)?$/.test(clause)) return false;
  if (/(?:不是|并非|不能说|谈不上)不(?:太|很|那么|特别)?$/.test(clause)) return false;

  // 只否定紧贴情绪词的结构；“不想说我很难过”否定的是“想说”，不是“难过”。
  return /(?:没有|不要|并没有|并不是|并非|从来不|从未|从不|谈不上|算不上|不|没|别|不是)(?:再|会|是|有|觉得|感到|太|很|挺|那么|特别|怎么|真的)*$/.test(clause);
}

function hasUnnegatedMatch(text, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(matcher)) {
    if (!isNegatedAt(text, match.index ?? 0)) return true;
  }
  return false;
}

function detectEmotion(text) {
  const matches = EMOTION_RULES.filter(rule => rule.immediate?.test(text) || hasUnnegatedMatch(text, rule.pattern));
  const hasStartle = matches.some(rule => rule.label === "受惊");
  const hasPositive = matches.some(rule => ["开心", "亲近", "兴奋", "惊喜"].includes(rule.label));
  if (hasStartle && hasPositive) return { label: "惊喜", ...EMOTION_PROFILES["惊喜"] };
  return matches[0] || null;
}

function igniteSenses(state, text) {
  const events = [];
  const eventLead = {
    touch: "触觉被唤醒",
    smell: "嗅觉捕捉到",
    taste: "味觉尝到了",
    sound: "听觉接收到"
  };
  for (const [channel, rules] of Object.entries(SENSE_RULES)) {
    const matches = rules.filter(rule => rule.pattern.test(text));
    if (matches.length === 0) continue;
    const strongest = matches.sort((a, b) => b.delta - a.delta)[0];
    const current = state.senses[channel];
    current.value = clamp(current.value + strongest.delta * (1 - current.value * 0.35), 0, 1);
    current.label = strongest.label;
    if (typeof strongest.thermal === "number") {
      state.thermal = clamp(state.thermal + strongest.thermal, -1, 1);
    }
    if (typeof strongest.arousalDelta === "number") {
      state.emotion.arousal = clamp(state.emotion.arousal + strongest.arousalDelta, 0, 1);
    }
    events.push({ type: channel, summary: `${eventLead[channel]}：${strongest.label}` });
  }
  return events;
}

function calculateHeartRate(state, nowMs, timeZone) {
  const base = circadianHeartBase(nowMs, timeZone);
  const touch = state.senses.touch.value;
  const sound = state.senses.sound.value;
  const stressBoost = state.emotion.valence < -0.25 ? state.emotion.arousal * 7 : 0;
  const naturalNoise = Math.sin(nowMs / 7300) * 1.5;
  return clamp(
    base + state.emotion.arousal * 27 + touch * 9 + sound * 2.5 + stressBoost + naturalNoise,
    48,
    160
  );
}

function calculateTemperature(state) {
  const surpriseWarmth = state.emotion.label === "惊喜" ? 0.15 : 0;
  return round(clamp(
    36.55 + state.emotion.arousal * 0.42 + Math.max(0, state.emotion.valence) * 0.12
      + state.senses.touch.value * 0.18 + state.thermal * 0.42 + surpriseWarmth,
    35.5,
    40
  ), 1);
}

function calculateBreathing(state) {
  return round(clamp(
    11.5 + Math.max(0, state.heartRate - 55) * 0.13 + state.emotion.arousal * 2.2,
    8,
    35
  ), 0);
}

export function reactToText(input, text, nowMs = Date.now(), timeZone = "Asia/Shanghai") {
  const state = decayState(input, nowMs, timeZone);
  const cleanText = String(text || "").slice(0, 20000);
  const events = [];
  if (state.solo.inProgress) {
    state.solo.inProgress = null;
    state.solo.cooldownUntil = Math.max(state.solo.cooldownUntil || 0, nowMs + 30 * 60_000);
    state.solo.desire = Math.min(state.solo.desire, Math.max(0, state.solo.threshold - 0.03));
    events.push({ type: "solo", summary: "独处事件因你回来而立即停下" });
  }
  events.push(...igniteSenses(state, cleanText));
  let emotion = detectEmotion(cleanText);
  const recentStartle = Boolean(state.startledAt && nowMs - state.startledAt <= 10_000);
  if (emotion && recentStartle && ["开心", "亲近", "兴奋", "惊喜"].includes(emotion.label)) {
    emotion = { label: "惊喜", ...EMOTION_PROFILES["惊喜"] };
  }

  if (emotion) {
    if (emotion.label === "受惊") state.startledAt = nowMs;
    if (emotion.label === "惊喜") {
      state.startledAt = null;
      state.thermal = clamp(state.thermal + 0.22, -1, 1);
    }
    state.emotion = {
      label: emotion.label,
      valence: clamp(state.emotion.valence * 0.35 + emotion.valence * 0.65, -1, 1),
      arousal: clamp(Math.max(state.emotion.arousal * 0.7, emotion.arousal), 0, 1)
    };
    events.push({ type: "emotion", summary: `情绪底色转为「${emotion.label}」` });
  }

  nudgeSoloFromReaction(state, events);

  state.heartRate = round(calculateHeartRate(state, nowMs, timeZone), 0);
  state.temperature = calculateTemperature(state);
  state.breathingRate = calculateBreathing(state);
  state.updatedAt = nowMs;

  if (events.length === 0) {
    events.push({ type: "heartbeat", summary: "身体维持着自然的呼吸与心跳节律" });
  }
  return { state, events };
}

export function applySemanticReaction(input, reaction, nowMs = Date.now(), timeZone = "Asia/Shanghai") {
  const state = decayState(input, nowMs, timeZone);
  const events = [];
  const confidence = clamp(reaction?.confidence ?? 0, 0, 1);
  if (!reaction || confidence < 0.45) return { state, events, applied: false };

  const requestedEmotionLabel = String(reaction.emotion?.label || "");
  const recentStartle = Boolean(state.startledAt && nowMs - state.startledAt <= 10_000);
  const becomesPositive = ["开心", "亲近", "兴奋", "惊喜"].includes(requestedEmotionLabel);
  const emotionLabel = recentStartle && becomesPositive ? "惊喜" : requestedEmotionLabel;
  const emotionProfile = EMOTION_PROFILES[emotionLabel];
  if (emotionProfile) {
    const intensity = clamp(reaction.emotion?.intensity ?? confidence, 0, 1);
    state.emotion = {
      label: emotionLabel,
      valence: clamp(state.emotion.valence * 0.3 + emotionProfile.valence * intensity * 0.7, -1, 1),
      arousal: clamp(Math.max(state.emotion.arousal * 0.7, emotionProfile.arousal * intensity), 0, 1)
    };
    if (emotionLabel === "受惊") state.startledAt = nowMs;
    if (emotionLabel === "惊喜") {
      state.startledAt = null;
      state.thermal = clamp(state.thermal + 0.22, -1, 1);
    }
    events.push({
      type: "emotion",
      summary: recentStartle && becomesPositive
        ? "惊吓后的身体反应转为了带着暖意的「惊喜」"
        : `情绪底色转为「${emotionLabel}」`
    });
  }

  for (const sense of Array.isArray(reaction.senses) ? reaction.senses.slice(0, 4) : []) {
    const channel = String(sense?.channel || "");
    const labels = SEMANTIC_SENSE_LABELS[channel];
    if (!labels || !state.senses[channel]) continue;
    const kind = Object.hasOwn(labels, sense.kind) ? sense.kind : "other";
    const intensity = clamp(sense.intensity, 0, 1);
    if (intensity < 0.15) continue;
    const current = state.senses[channel];
    current.value = clamp(Math.max(current.value, intensity), 0, 1);
    current.label = labels[kind];
    if (channel === "touch" && kind === "cold") state.thermal = clamp(state.thermal - intensity * 0.45, -1, 1);
    if (channel === "touch" && kind === "warm") state.thermal = clamp(state.thermal + intensity * 0.4, -1, 1);
    if (channel === "sound" && ["shout", "impact", "noise"].includes(kind)) {
      state.emotion.arousal = clamp(state.emotion.arousal + intensity * 0.3, 0, 1);
    }
    const eventLead = { touch: "触觉被唤醒", smell: "嗅觉捕捉到", taste: "味觉尝到了", sound: "听觉接收到" };
    events.push({ type: channel, summary: `${eventLead[channel]}：${current.label}` });
  }

  nudgeSoloFromReaction(state, events);

  state.heartRate = round(calculateHeartRate(state, nowMs, timeZone), 0);
  state.temperature = calculateTemperature(state);
  state.breathingRate = calculateBreathing(state);
  state.updatedAt = nowMs;
  return { state, events, applied: events.length > 0 };
}

export function breathingLabel(rate) {
  if (rate <= 11) return "呼吸深缓";
  if (rate <= 16) return "呼吸平稳";
  if (rate <= 21) return "呼吸略快";
  return "呼吸急促";
}

export function dominantSensation(state) {
  const entries = Object.entries(state.senses)
    .filter(([, sense]) => sense.value >= 0.15 && sense.label)
    .sort((a, b) => b[1].value - a[1].value);
  if (entries.length === 0) {
    if (state.emotion.arousal >= 0.55) return "身体微微绷紧";
    return "身体安静";
  }
  const [channel, sense] = entries[0];
  const compact = {
    touch: sense.label.includes("拥抱") ? "拥抱余温" : sense.label.includes("亲吻") ? "亲吻余韵" : "触觉清晰",
    smell: "气味残留",
    taste: "味觉余韵",
    sound: "听觉敏锐"
  };
  return compact[channel] || sense.label;
}

export function publicSnapshot(state) {
  const normalized = normalizeState(state);
  const nowMs = Date.now();
  const cooldownRemainingMs = Math.max(0, (normalized.solo.cooldownUntil || 0) - nowMs);
  return {
    updatedAt: normalized.updatedAt,
    heartRate: Math.round(normalized.heartRate),
    temperature: round(normalized.temperature, 1),
    breathingRate: Math.round(normalized.breathingRate),
    breathingLabel: breathingLabel(normalized.breathingRate),
    emotion: normalized.emotion,
    senses: normalized.senses,
    dominantSensation: dominantSensation(normalized),
    solo: {
      enabled: normalized.solo.enabled,
      desire: round(normalized.solo.desire, 3),
      threshold: normalized.solo.threshold,
      idleMinutes: normalized.solo.idleMinutes,
      cooldownHours: normalized.solo.cooldownHours,
      cooldownRemainingMs,
      inProgress: normalized.solo.inProgress,
      latest: normalized.solo.latest
    }
  };
}
