const express = require("express");
const cookieParser = require("cookie-parser");
const { pool } = require("./db");
const {
  ensureVisitorCookie,
  captureUtmFromQuery,
  visitorCookieOptions,
  VISITOR_COOKIE,
} = require("./middleware/visitor");

const app = express();
app.use(express.json());
app.use(cookieParser());

const PORT = Number(process.env.PORT) || 3000;

/** First-touch: earliest recorded campaign for this visitor */
async function firstTouchCampaign(visitorId) {
  const r = await pool.query(
    `SELECT utm_campaign FROM visits
     WHERE visitor_id = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [visitorId]
  );
  return r.rows[0]?.utm_campaign ?? null;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const visitStack = [ensureVisitorCookie, captureUtmFromQuery];

/**
 * Record a landing-page hit. visitor_id comes from cookie (or body override).
 * utm_campaign from JSON body and/or ?utm_campaign= (body wins if both set).
 */
async function recordVisit(req, res) {
  const body = req.body ?? {};
  const bodyVid = body.visitor_id;
  const bodyUtm = body.utm_campaign;

  const visitorId =
    typeof bodyVid === "string" && bodyVid.trim()
      ? bodyVid.trim()
      : req.visitorId;

  res.cookie(VISITOR_COOKIE, visitorId, visitorCookieOptions);

  const utmCampaign =
    typeof bodyUtm === "string" && bodyUtm.trim()
      ? bodyUtm.trim()
      : req.utmCampaignQuery;

  if (!utmCampaign) {
    return res.status(400).json({
      error: "utm_campaign is required (body or ?utm_campaign=)",
    });
  }
  try {
    const r = await pool.query(
      `INSERT INTO visits (visitor_id, utm_campaign)
       VALUES ($1, $2)
       RETURNING id, created_at`,
      [visitorId, utmCampaign]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to record visit" });
  }
}

app.get("/visits", visitStack, recordVisit);
app.post("/visits", visitStack, recordVisit);

/**
 * Capture a lead; attributes to first-touch campaign from visits, or optional override.
 * Body: { email: string, visitor_id?: string, utm_campaign?: string }
 * visitor_id optional if visitor_id cookie is set (e.g. after /visits).
 */
app.post("/leads", ensureVisitorCookie, async (req, res) => {
  const {
    email,
    visitor_id: bodyVisitorId,
    utm_campaign: overrideCampaign,
  } = req.body ?? {};
  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ error: "email is required" });
  }
  const visitorId =
    typeof bodyVisitorId === "string" && bodyVisitorId.trim()
      ? bodyVisitorId.trim()
      : req.visitorId;
  if (typeof visitorId !== "string" || !visitorId.trim()) {
    return res.status(400).json({ error: "visitor_id is required" });
  }
  res.cookie(VISITOR_COOKIE, visitorId, visitorCookieOptions);
  let campaign = null;
  if (typeof overrideCampaign === "string" && overrideCampaign.trim()) {
    campaign = overrideCampaign.trim();
  } else {
    campaign = await firstTouchCampaign(visitorId.trim());
  }
  if (!campaign) {
    return res.status(400).json({
      error:
        "no campaign to attribute: add utm_campaign or record a visit first",
    });
  }
  try {
    const r = await pool.query(
      `INSERT INTO leads (email, visitor_id, utm_campaign)
       VALUES ($1, $2, $3)
       RETURNING id, email, visitor_id, utm_campaign, created_at`,
      [email.trim().toLowerCase(), visitorId.trim(), campaign]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "email already exists" });
    }
    console.error(e);
    res.status(500).json({ error: "failed to create lead" });
  }
});

/**
 * Record revenue for a lead.
 * Body: { lead_id: number, amount: number }
 */
app.post("/deals", async (req, res) => {
  const { lead_id: leadId, amount } = req.body ?? {};
  const id = Number(leadId);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "lead_id must be a positive integer" });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) {
    return res.status(400).json({ error: "amount must be a non-negative number" });
  }
  try {
    const check = await pool.query(`SELECT id FROM leads WHERE id = $1`, [id]);
    if (check.rowCount === 0) {
      return res.status(404).json({ error: "lead not found" });
    }
    const r = await pool.query(
      `INSERT INTO deals (lead_id, amount)
       VALUES ($1, $2)
       RETURNING id, lead_id, amount, created_at`,
      [id, amt]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to create deal" });
  }
});

/**
 * Revenue attributed per utm_campaign (sum of all deals for leads in that campaign).
 */
app.get("/reports/by-campaign", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.utm_campaign,
              COUNT(DISTINCT l.id)::int AS lead_count,
              COUNT(d.id)::int AS deal_count,
              COALESCE(SUM(d.amount), 0)::text AS revenue
       FROM leads l
       LEFT JOIN deals d ON d.lead_id = l.id
       GROUP BY l.utm_campaign
       ORDER BY COALESCE(SUM(d.amount), 0) DESC`
    );
    res.json({ campaigns: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "report failed" });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

pool
  .query("SELECT 1")
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Content ROI Tracker listening on ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  });
