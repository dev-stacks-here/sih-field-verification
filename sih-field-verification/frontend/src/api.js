import { staticEngine } from "./staticEngine.js";

let rawBase = (import.meta.env.VITE_API_BASE_URL || "/api").trim();
if (rawBase.endsWith("/")) rawBase = rawBase.slice(0, -1);
const BASE_URL = /^https?:\/\//i.test(rawBase) && !rawBase.endsWith("/api")
  ? `${rawBase}/api`
  : rawBase;

const TOKEN_KEY = "fvs_token";
const FORCE_STATIC_KEY = "fvs_force_static";

// Tracks whether the backend is unreachable so calls seamlessly use staticEngine
let isStaticModeActive = false;

// Check on boot if user or environment forced static mode, or initialize static engine
staticEngine.init();

function isStaticMode() {
  return isStaticModeActive;
}

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    /* storage unavailable */
  }
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  // If we already know the backend is unreachable, skip network timeout and run in-browser
  if (isStaticModeActive) {
    throw new Error("STATIC_MODE");
  }

  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500); // quick fail to standalone mode

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* no JSON body */
    }

    if (!res.ok) {
      // If 404 on /api endpoint (static hosting without backend), switch to static mode
      if (res.status === 404 && path.startsWith("/")) {
        isStaticModeActive = true;
        throw new Error("STATIC_MODE");
      }
      const message = (data && data.error) || `Request failed (${res.status}).`;
      throw new Error(message);
    }
    return data;
  } catch (err) {
    clearTimeout(timeout);
    // Network failure or abort => enable static mode
    if (
      err.name === "AbortError" ||
      err.message === "Failed to fetch" ||
      err.message === "NetworkError when attempting to fetch resource." ||
      err.message === "STATIC_MODE"
    ) {
      isStaticModeActive = true;
      throw new Error("STATIC_MODE");
    }
    throw err;
  }
}

function imagePath(recordId) {
  if (isStaticModeActive) {
    return staticEngine.imagePath(recordId);
  }
  return `${BASE_URL}/scans/${encodeURIComponent(recordId)}/image`;
}

export const api = {
  getToken,
  setToken,
  imagePath,
  isStaticMode,

  async login(userId, password) {
    try {
      const data = await request("/auth/login", {
        method: "POST",
        body: { userId, password },
        auth: false,
      });
      return data;
    } catch (err) {
      if (err.message === "STATIC_MODE" || isStaticModeActive) {
        return staticEngine.login(userId, password);
      }
      throw err;
    }
  },

  async me() {
    try {
      const data = await request("/auth/me");
      return data;
    } catch (err) {
      if (err.message === "STATIC_MODE" || isStaticModeActive) {
        return staticEngine.me(getToken());
      }
      throw err;
    }
  },

  async listScans(params = {}) {
    try {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.result) qs.set("result", params.result);
      if (params.needsReview) qs.set("needsReview", "1");
      if (params.limit) qs.set("limit", String(params.limit));
      if (params.offset) qs.set("offset", String(params.offset));
      const str = qs.toString();
      const data = await request(`/scans${str ? `?${str}` : ""}`);
      return data;
    } catch (err) {
      if (err.message === "STATIC_MODE" || isStaticModeActive) {
        return staticEngine.listScans(params);
      }
      throw err;
    }
  },

  async getScan(recordId) {
    try {
      const data = await request(`/scans/${encodeURIComponent(recordId)}`);
      return data;
    } catch (err) {
      if (err.message === "STATIC_MODE" || isStaticModeActive) {
        return staticEngine.getScan(recordId);
      }
      throw err;
    }
  },

  async createScan(payload) {
    try {
      const data = await request("/scans", { method: "POST", body: payload });
      return data;
    } catch (err) {
      if (err.message === "STATIC_MODE" || isStaticModeActive) {
        return staticEngine.createScan(payload);
      }
      throw err;
    }
  },

  async verifyScan(recordId) {
    try {
      const data = await request(`/scans/${encodeURIComponent(recordId)}/verify`);
      return data;
    } catch (err) {
      if (err.message === "STATIC_MODE" || isStaticModeActive) {
        return staticEngine.verifyScan(recordId);
      }
      throw err;
    }
  },

  async confirmScan(recordId, confirmedResult) {
    try {
      const data = await request(`/scans/${encodeURIComponent(recordId)}/confirm`, {
        method: "PATCH",
        body: { confirmedResult },
      });
      return data;
    } catch (err) {
      if (err.message === "STATIC_MODE" || isStaticModeActive) {
        return staticEngine.confirmScan(recordId, confirmedResult);
      }
      throw err;
    }
  },

  async getAccuracyStats() {
    try {
      const data = await request("/scans/stats/accuracy");
      return data;
    } catch (err) {
      if (err.message === "STATIC_MODE" || isStaticModeActive) {
        return staticEngine.getAccuracyStats();
      }
      throw err;
    }
  },

  async deleteScan(recordId, password) {
    try {
      const data = await request(`/scans/${encodeURIComponent(recordId)}`, {
        method: "DELETE",
        body: { password },
      });
      return data;
    } catch (err) {
      if (err.message === "STATIC_MODE" || isStaticModeActive) {
        return staticEngine.deleteScan(recordId, password);
      }
      throw err;
    }
  },

  async purgeScans(password, all = true) {
    try {
      const data = await request("/scans", {
        method: "DELETE",
        body: { password, all },
      });
      return data;
    } catch (err) {
      if (err.message === "STATIC_MODE" || isStaticModeActive) {
        return staticEngine.purgeScans(password, all);
      }
      throw err;
    }
  },
};
