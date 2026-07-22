require("dotenv").config();

const Module = require("module");
const originalLoad = Module._load;

function fallbackModels() {
  const model = String(process.env.MODEL_NAME || "gateway-model").trim() || "gateway-model";
  return {
    object: "list",
    data: [{ id: model, object: "model", created: 0, owned_by: "gateway" }]
  };
}

function deriveModelsUrl() {
  const explicit = String(process.env.TARGET_MODELS_URL || "").trim();
  if (explicit) return explicit;

  const target = String(process.env.TARGET_API_URL || "").trim();
  if (!target) return "";

  try {
    const url = new URL(target);
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/i, "/models");
    url.search = "";
    return url.toString();
  } catch {
    return "";
  }
}

async function fetchUpstreamModels() {
  const modelsUrl = deriveModelsUrl();
  if (!modelsUrl || !process.env.TARGET_API_KEY) return fallbackModels();

  try {
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.TARGET_API_KEY}`
      }
    });

    if (!response.ok) return fallbackModels();

    const data = await response.json();
    if (!data || !Array.isArray(data.data)) return fallbackModels();
    return data;
  } catch {
    return fallbackModels();
  }
}

Module._load = function patchedLoad(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments);
  if (request !== "fastify") return loaded;

  return function patchedFastify(...args) {
    const app = loaded(...args);
    const originalGet = app.get.bind(app);

    app.get = function patchedGet(path, opts, handler) {
      if (path !== "/v1/models") return originalGet(path, opts, handler);

      const modelsHandler = async (req, reply) => {
        reply.send(await fetchUpstreamModels());
      };

      if (typeof opts === "function") return originalGet(path, modelsHandler);
      return originalGet(path, opts, modelsHandler);
    };

    return app;
  };
};

require("./server");
