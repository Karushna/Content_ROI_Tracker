const { randomUUID } = require("crypto");

const VISITOR_COOKIE = "visitor_id";

const visitorCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 365 * 24 * 60 * 60 * 1000,
};

/**
 * Ensures req.visitorId and Set-Cookie visitor_id (generates UUID if missing).
 */
function ensureVisitorCookie(req, res, next) {
  let vid = req.cookies?.[VISITOR_COOKIE];
  if (typeof vid !== "string" || !vid.trim()) {
    vid = randomUUID();
  } else {
    vid = vid.trim();
  }
  req.visitorId = vid;
  res.cookie(VISITOR_COOKIE, vid, visitorCookieOptions);
  next();
}

/**
 * Sets req.utmCampaignQuery from ?utm_campaign= (first value if repeated).
 */
function captureUtmFromQuery(req, res, next) {
  const q = req.query.utm_campaign;
  const raw = Array.isArray(q) ? q[0] : q;
  req.utmCampaignQuery =
    typeof raw === "string" && raw.trim() ? raw.trim() : null;
  next();
}

module.exports = {
  ensureVisitorCookie,
  captureUtmFromQuery,
  VISITOR_COOKIE,
  visitorCookieOptions,
};
