const express = require("express");
const cookieParser = require("cookie-parser");
const { db, FieldValue } = require("./db");
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

function tsToIso(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return null;
}

/** First-touch: earliest recorded campaign for this visitor */
async function firstTouchCampaign(visitorId) {
  const snap = await db
    .collection("visits")
    .where("visitor_id", "==", visitorId)
    .get();
  const rows = snap.docs.map((d) => ({
    utm_campaign: d.data().utm_campaign,
    created_at: d.data().created_at,
  }));
  rows.sort((a, b) => {
    const ma = a.created_at?.toMillis?.() ?? 0;
    const mb = b.created_at?.toMillis?.() ?? 0;
    return ma - mb;
  });
  return rows[0]?.utm_campaign ?? null;
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
    const ref = await db.collection("visits").add({
      visitor_id: visitorId,
      utm_campaign: utmCampaign,
      created_at: FieldValue.serverTimestamp(),
    });
    const doc = await ref.get();
    const data = doc.data();
    res.status(201).json({
      id: doc.id,
      created_at: tsToIso(data.created_at),
    });
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
  const emailNorm = email.trim().toLowerCase();
  const leadRef = db.collection("leads").doc(emailNorm);
  try {
    await leadRef.create({
      email: emailNorm,
      visitor_id: visitorId.trim(),
      utm_campaign: campaign,
      created_at: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    const dup =
      e.code === 6 ||
      e.code === "ALREADY_EXISTS" ||
      e.code === "already-exists";
    if (dup) {
      return res.status(409).json({ error: "email already exists" });
    }
    console.error(e);
    return res.status(500).json({ error: "failed to create lead" });
  }
  const doc = await leadRef.get();
  const data = doc.data();
  res.status(201).json({
    id: doc.id,
    email: data.email,
    visitor_id: data.visitor_id,
    utm_campaign: data.utm_campaign,
    created_at: tsToIso(data.created_at),
  });
});

/**
 * Record revenue for a lead.
 * Body: { lead_id: string, amount: number }  (lead_id is the lead document id, same as normalized email)
 */
app.post("/deals", async (req, res) => {
  const { lead_id: leadIdRaw, amount } = req.body ?? {};
  const leadId =
    leadIdRaw === undefined || leadIdRaw === null
      ? ""
      : String(leadIdRaw).trim();
  if (!leadId) {
    return res.status(400).json({ error: "lead_id is required" });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) {
    return res.status(400).json({ error: "amount must be a non-negative number" });
  }
  try {
    const leadSnap = await db.collection("leads").doc(leadId).get();
    if (!leadSnap.exists) {
      return res.status(404).json({ error: "lead not found" });
    }
    const ref = await db.collection("deals").add({
      lead_id: leadId,
      amount: amt,
      created_at: FieldValue.serverTimestamp(),
    });
    const doc = await ref.get();
    const data = doc.data();
    res.status(201).json({
      id: doc.id,
      lead_id: data.lead_id,
      amount: data.amount,
      created_at: tsToIso(data.created_at),
    });
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
    const [leadsSnap, dealsSnap] = await Promise.all([
      db.collection("leads").get(),
      db.collection("deals").get(),
    ]);
    const leadById = new Map();
    leadsSnap.docs.forEach((d) => {
      const x = d.data();
      leadById.set(d.id, {
        utm_campaign: x.utm_campaign,
      });
    });
    const byCampaign = new Map();
    for (const d of leadsSnap.docs) {
      const u = d.data().utm_campaign;
      if (!byCampaign.has(u)) {
        byCampaign.set(u, { lead_count: 0, deal_count: 0, revenue: 0 });
      }
      byCampaign.get(u).lead_count += 1;
    }
    for (const d of dealsSnap.docs) {
      const x = d.data();
      const lead = leadById.get(x.lead_id);
      if (!lead) continue;
      const u = lead.utm_campaign;
      if (!byCampaign.has(u)) {
        byCampaign.set(u, { lead_count: 0, deal_count: 0, revenue: 0 });
      }
      const row = byCampaign.get(u);
      row.deal_count += 1;
      row.revenue += Number(x.amount) || 0;
    }
    const campaigns = [...byCampaign.entries()]
      .map(([utm_campaign, v]) => ({
        utm_campaign,
        lead_count: v.lead_count,
        deal_count: v.deal_count,
        revenue: String(v.revenue),
      }))
      .sort((a, b) => Number(b.revenue) - Number(a.revenue));
    res.json({ campaigns });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "report failed" });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

db
  .collection("visits")
  .limit(1)
  .get()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Content ROI Tracker listening on ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Firebase/Firestore failed:", err.message);
    process.exit(1);
  });
