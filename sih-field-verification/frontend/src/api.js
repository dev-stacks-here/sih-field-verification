const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const TOKEN_KEY = "fvs_token";

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
    /* ignore - storage unavailable */
  }
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* no JSON body */
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return data;
}

function imagePath(recordId) {
  return `${BASE_URL}/scans/${encodeURIComponent(recordId)}/image`;
}

export const api = {
  getToken,
  setToken,
  imagePath,

  login(userId, password) {
    return request("/auth/login", { method: "POST", body: { userId, password }, auth: false });
  },

  me() {
    return request("/auth/me");
  },

  listScans({ q, result, needsReview, limit, offset } = {}) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (result) params.set("result", result);
    if (needsReview) params.set("needsReview", "1");
    if (limit) params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    const qs = params.toString();
    return request(`/scans${qs ? `?${qs}` : ""}`);
  },

  getScan(recordId) {
    return request(`/scans/${encodeURIComponent(recordId)}`);
  },

  createScan(payload) {
    return request("/scans", { method: "POST", body: payload });
  },

  verifyScan(recordId) {
    return request(`/scans/${encodeURIComponent(recordId)}/verify`);
  },

  // Records ground truth once it's known (lab confirmation / supervisor
  // review), so real accuracy can be tracked over time. Never touches the
  // signed fields on the record.
  confirmScan(recordId, confirmedResult) {
    return request(`/scans/${encodeURIComponent(recordId)}/confirm`, {
      method: "PATCH",
      body: { confirmedResult },
    });
  },

  getAccuracyStats() {
    return request("/scans/stats/accuracy");
  },

  deleteScan(recordId, password) {
    return request(`/scans/${encodeURIComponent(recordId)}`, {
      method: "DELETE",
      body: { password },
    });
  },

  purgeScans(password, all = true) {
    return request("/scans", {
      method: "DELETE",
      body: { password, all },
    });
  },
};
