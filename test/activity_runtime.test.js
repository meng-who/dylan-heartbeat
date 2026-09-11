const assert = require("node:assert/strict");
const test = require("node:test");

const {
  activityGate,
  parseActivityDecision,
  runActivityCycle
} = require("../activity_runtime");

test("activity budget is independent from the ordinary wake threshold", () => {
  const now = new Date("2026-09-11T03:00:00.000Z");
  assert.equal(activityGate({
    now,
    lastUserAt: "2026-09-10T23:00:00.000Z",
    state: {},
    idleMinutes: 120,
    intervalMinutes: 180,
    maxPerDay: 3,
    timeZone: "Asia/Shanghai"
  }).due, true);
  assert.equal(activityGate({
    now,
    lastUserAt: "2026-09-10T23:00:00.000Z",
    state: { date: "2026-09-11", count: 3 },
    idleMinutes: 120,
    intervalMinutes: 180,
    maxPerDay: 3,
    timeZone: "Asia/Shanghai"
  }).reason, "daily_limit");
});

test("parses a fenced Spotify activity decision", () => {
  assert.deepEqual(parseActivityDecision("```json\n{\"action\":\"spotify_add\",\"track\":\"Song\",\"artist\":\"Artist\",\"reason\":\"fit\"}\n```"), {
    action: "spotify_add",
    query: "Song Artist",
    reason: "fit"
  });
});

test("searches and adds one track without exposing playback tools", async () => {
  const calls = [];
  const reply = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url === "https://model.test/v1/chat/completions") {
      return reply({ choices: [{ message: { content: "{\"action\":\"spotify_add\",\"query\":\"Song Artist\",\"reason\":\"recent topic\"}" } }] });
    }
    if (body.method === "initialize") return reply({ jsonrpc: "2.0", id: body.id, result: {} });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") return reply({ jsonrpc: "2.0", id: body.id, result: { tools: [
      { name: "spotify_search", inputSchema: { type: "object" } },
      { name: "spotify_playlist", inputSchema: { properties: { action: { enum: ["list", "add_items"] } } } },
      { name: "spotify_control", inputSchema: { type: "object" } }
    ] } });
    if (body.params?.name === "spotify_search") return reply({ jsonrpc: "2.0", id: body.id, result: {
      content: [{ type: "text", text: "Song by Artist — spotify:track:ABC123" }]
    } });
    return reply({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "added" }] } });
  };

  const result = await runActivityCycle({
    apiUrl: "https://model.test/v1/chat/completions",
    apiKey: "model-key",
    model: "model",
    systemPrompt: "persona",
    history: "user likes this artist",
    playlistName: "Dylan picks",
    spotifyUrl: "https://spotify.test/mcp",
    spotifyToken: "spotify-key",
    playlistId: "playlist-1",
    recentTrackUris: [],
    fetchImpl
  });

  assert.equal(result.status, "success");
  assert.equal(result.trackUri, "spotify:track:ABC123");
  const toolCalls = calls.filter(call => call.body.method === "tools/call").map(call => call.body.params);
  assert.deepEqual(toolCalls.map(call => call.name), ["spotify_search", "spotify_playlist"]);
  assert.deepEqual(toolCalls[1].arguments, {
    action: "add_items",
    playlist_id: "playlist-1",
    uris: ["spotify:track:ABC123"]
  });
});
