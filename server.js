const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, "payments.json");
const AMOUNT_PAISE = 250000;
const AMOUNT_RUPEES = 2500;
const CURRENCY = "INR";

if (!fs.existsSync(DATA)) fs.writeFileSync(DATA, "[]", { mode: 0o600 });

function read() {
  try {
    const value = JSON.parse(fs.readFileSync(DATA, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.error("Could not read payment data:", error.message);
    throw new Error("Payment records are temporarily unavailable.");
  }
}
function write(items) {
  const temp = DATA + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(items, null, 2), { mode: 0o600 });
  fs.renameSync(temp, DATA);
}
function getRazorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function adminOnly(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return res.status(503).json({ error: "Admin access is not configured." });
  if (!safeEqual(req.get("x-admin-password"), password)) {
    return res.status(401).json({ error: "Administrator password is incorrect." });
  }
  next();
}
function markPaid(items, orderId, paymentId) {
  const item = items.find(x => x.orderId === orderId);
  if (!item) return false;
  item.status = "Verified";
  item.paymentId = paymentId || item.paymentId || null;
  item.paidAt = item.paidAt || new Date().toISOString();
  item.updatedAt = new Date().toISOString();
  return true;
}

// Razorpay webhooks need the unmodified request body for signature verification.
app.post("/api/razorpay/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).send("Webhook secret is not configured.");
  const received = req.get("x-razorpay-signature");
  const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
  if (!safeEqual(received, expected)) return res.status(400).send("Invalid webhook signature.");

  try {
    const event = JSON.parse(req.body.toString("utf8"));
    let orderId = null;
    let paymentId = null;
    if (event.event === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      orderId = payment?.order_id;
      paymentId = payment?.id;
    } else if (event.event === "order.paid") {
      const order = event.payload?.order?.entity;
      const payment = event.payload?.payment?.entity;
      orderId = order?.id;
      paymentId = payment?.id;
    }
    if (orderId) {
      const items = read();
      if (markPaid(items, orderId, paymentId)) write(items);
    }
    return res.json({ received: true });
  } catch (error) {
    console.error("Webhook processing failed:", error.message);
    return res.status(500).send("Webhook processing failed.");
  }
});

app.use(express.json({ limit: "20kb" }));
app.use(express.static(__dirname));

app.post("/api/create-order", async (req, res) => {
  const razorpay = getRazorpay();
  if (!razorpay) return res.status(503).json({ error: "Online payment is not configured yet. Please contact the organiser." });

  const name = String(req.body?.name || "").trim();
  const roll = String(req.body?.roll || "").trim();
  if (!name || !roll) return res.status(400).json({ error: "Please enter your name and registration ID." });
  if (name.length > 100 || roll.length > 100) return res.status(400).json({ error: "One of the fields is too long." });

  try {
    const id = crypto.randomUUID();
    const order = await razorpay.orders.create({
      amount: AMOUNT_PAISE,
      currency: CURRENCY,
      receipt: ("csexams_" + id).slice(0, 40),
      notes: { registration_id: id, candidate_name: name, candidate_roll: roll }
    });
    const items = read();
    items.push({
      id, name, roll, amount: AMOUNT_RUPEES, currency: CURRENCY,
      status: "Pending", paymentMethod: "Razorpay", orderId: order.id,
      createdAt: new Date().toISOString()
    });
    write(items);
    return res.json({
      key: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      name: "CS EXAMs",
      description: "Computer Science & IT Practice Mock Test",
      registrationId: id
    });
  } catch (error) {
    console.error("Order creation failed:", error.message);
    return res.status(500).json({ error: "Could not start payment. Please try again." });
  }
});

app.post("/api/verify-payment", async (req, res) => {
  const razorpay = getRazorpay();
  if (!razorpay) return res.status(503).json({ error: "Payment verification is not configured." });
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  if (!orderId || !paymentId || !signature) return res.status(400).json({ error: "Payment verification details are incomplete." });

  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(orderId + "|" + paymentId).digest("hex");
  if (!safeEqual(signature, expected)) return res.status(400).json({ error: "Payment signature could not be verified." });

  try {
    const items = read();
    const item = items.find(x => x.orderId === orderId);
    if (!item) return res.status(404).json({ error: "Registration order was not found." });
    const payment = await razorpay.payments.fetch(paymentId);
    if (payment.order_id !== orderId || payment.amount !== AMOUNT_PAISE || payment.currency !== CURRENCY) {
      return res.status(400).json({ error: "Payment details do not match this registration." });
    }
    if (payment.status !== "captured") {
      return res.status(202).json({ ok: false, status: "Pending", message: "Payment is awaiting confirmation. Please check your status shortly." });
    }
    markPaid(items, orderId, paymentId);
    write(items);
    return res.json({ ok: true, status: "Verified", registrationId: item.id });
  } catch (error) {
    console.error("Payment verification failed:", error.message);
    return res.status(500).json({ error: "Could not verify payment right now. If money was deducted, do not pay again; contact the organiser." });
  }
});

// Public status lookup returns only the minimum details needed by the candidate.
app.get("/api/payments/lookup", (req, res) => {
  const reference = String(req.query.reference || "").trim().toLowerCase();
  if (!reference) return res.status(400).json({ error: "Enter your registration ID or old UTR." });
  const item = read().find(x =>
    String(x.id || "").toLowerCase() === reference ||
    String(x.utr || "").toLowerCase() === reference ||
    String(x.orderId || "").toLowerCase() === reference
  );
  if (!item) return res.status(404).json({ error: "No registration was found for that reference." });
  return res.json({
    id: item.id, name: item.name, roll: item.roll, amount: item.amount,
    status: item.status, createdAt: item.createdAt,
    paymentMethod: item.paymentMethod || "Legacy UTR submission"
  });
});

// Receipts are available only after the record has been verified.
app.get("/api/payments/:id", (req, res) => {
  const item = read().find(x => x.id === req.params.id);
  if (!item || item.status !== "Verified") return res.status(404).json({ error: "Verified receipt not found." });
  res.json({
    id: item.id, name: item.name, roll: item.roll, amount: item.amount,
    status: item.status, paymentId: item.paymentId || null, paidAt: item.paidAt || item.updatedAt
  });
});

// Full records and manual status changes are restricted to the administrator.
app.get("/api/admin/payments", adminOnly, (req, res) => res.json(read()));
app.post("/api/admin/payments/:id/status", adminOnly, (req, res) => {
  const allowed = ["Pending", "Verified", "Rejected"];
  const status = req.body?.status;
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status." });
  const items = read();
  const item = items.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Payment not found." });
  // Razorpay payments must be confirmed by Razorpay, not manually marked paid.
  if (item.paymentMethod === "Razorpay" && status === "Verified") {
    return res.status(400).json({ error: "Razorpay payments are verified automatically after gateway confirmation." });
  }
  item.status = status;
  item.updatedAt = new Date().toISOString();
  write(items);
  res.json({ ok: true, item });
});

app.listen(PORT, () => console.log(`CS EXAMs portal running on port ${PORT}`));
