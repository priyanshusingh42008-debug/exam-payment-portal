const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, "payments.json");

if (!fs.existsSync(DATA)) {
  fs.writeFileSync(DATA, "[]");
}

const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    })
  : null;

const AMOUNT = 250000; // ₹2,500 in paise

function read() {
  return JSON.parse(fs.readFileSync(DATA, "utf8"));
}

function write(items) {
  const temp = DATA + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(items, null, 2));
  fs.renameSync(temp, DATA);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Administrator authentication
function adminAuth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="CS EXAMs Admin"');
    return res.status(401).send("Administrator login required.");
  }

  let credentials;
  try {
    credentials = Buffer.from(header.slice(6), "base64").toString();
  } catch {
    return res.status(401).send("Invalid login.");
  }

  const separator = credentials.indexOf(":");
  const username = credentials.slice(0, separator);
  const password = credentials.slice(separator + 1);

  if (
    separator < 0 ||
    !process.env.ADMIN_USERNAME ||
    !process.env.ADMIN_PASSWORD ||
    !safeEqual(username, process.env.ADMIN_USERNAME) ||
    !safeEqual(password, process.env.ADMIN_PASSWORD)
  ) {
    res.set("WWW-Authenticate", 'Basic realm="CS EXAMs Admin"');
    return res.status(401).send("Invalid administrator login.");
  }

  next();
}

// Keep the original request body for Razorpay webhook verification.
app.use(express.json({
  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  }
}));

// Protect the admin page itself.
app.get("/admin.html", adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Do not allow private server/data files to be downloaded.
app.get(["/server.js", "/payments.json", "/payments.json.tmp"], (req, res) => {
  res.sendStatus(404);
});

app.use(express.static(__dirname));

// Create a Razorpay order.
app.post("/api/create-order", async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(503).json({
        error: "Online payment is not configured yet."
      });
    }

    const name = String(req.body?.name || "").trim();
    const roll = String(req.body?.roll || "").trim();

    if (!name || !roll || name.length > 100 || roll.length > 100) {
      return res.status(400).json({
        error: "Enter a valid name and registration ID."
      });
    }

    const receipt = "cs_" + crypto.randomUUID().replace(/-/g, "").slice(0, 32);

    const order = await razorpay.orders.create({
      amount: AMOUNT,
      currency: "INR",
      receipt,
      notes: {
        service: "CS EXAMs Practice Test",
        candidate_name: name,
        candidate_id: roll
      }
    });

    const item = {
      id: crypto.randomUUID(),
      publicToken: crypto.randomBytes(32).toString("hex"),
      name,
      roll,
      amount: 2500,
      currency: "INR",
      status: "Pending",
      orderId: order.id,
      paymentId: null,
      createdAt: new Date().toISOString()
    };

    const items = read();
    items.push(item);
    write(items);

    res.json({
      ok: true,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      publicToken: item.publicToken
    });
  } catch (error) {
    console.error("Order creation failed:", error);
    res.status(500).json({
      error: "Unable to start payment. Please try again."
    });
  }
});

// Verify the payment after Razorpay Checkout completes.
app.post("/api/verify-payment", async (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_SECRET || !razorpay) {
      return res.status(503).json({ error: "Payment verification is unavailable." });
    }

    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      publicToken
    } = req.body || {};

    if (!orderId || !paymentId || !signature || !publicToken) {
      return res.status(400).json({ error: "Missing payment verification details." });
    }

    const items = read();
    const item = items.find(x =>
      x.orderId === orderId && x.publicToken === publicToken
    );

    if (!item) {
      return res.status(404).json({ error: "Registration not found." });
    }

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + "|" + paymentId)
      .digest("hex");

    if (!safeEqual(expected, signature)) {
      return res.status(400).json({ error: "Payment signature is invalid." });
    }

    const payment = await razorpay.payments.fetch(paymentId);

    if (
      payment.order_id !== orderId ||
      payment.status !== "captured" ||
      payment.amount !== AMOUNT ||
      payment.currency !== "INR"
    ) {
      return res.status(400).json({
        error: "Payment has not been confirmed as captured."
      });
    }

    item.status = "Verified";
    item.paymentId = paymentId;
    item.paymentMethod = payment.method || "Razorpay";
    item.updatedAt = new Date().toISOString();
    write(items);

    res.json({
      ok: true,
      status: item.status,
      statusUrl: "/status.html?token=" + item.publicToken,
      receiptUrl: "/receipt.html?token=" + item.publicToken
    });
  } catch (error) {
    console.error("Payment verification failed:", error);
    res.status(500).json({
      error: "We could not verify the payment yet. Please check your status page."
    });
  }
});

// Razorpay webhook: configure this URL in the Razorpay Dashboard.
app.post("/api/razorpay-webhook", (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (!secret || !signature || !req.rawBody) {
      return res.sendStatus(400);
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(req.rawBody)
      .digest("hex");

    if (!safeEqual(expected, signature)) {
      return res.sendStatus(400);
    }

    const event = req.body;

    if (event.event === "payment.captured") {
      const payment = event.payload?.payment?.entity;

      if (payment) {
        const items = read();
        const item = items.find(x => x.orderId === payment.order_id);

        if (
          item &&
          payment.status === "captured" &&
          payment.amount === AMOUNT &&
          payment.currency === "INR"
        ) {
          item.status = "Verified";
          item.paymentId = payment.id;
          item.paymentMethod = payment.method || "Razorpay";
          item.updatedAt = new Date().toISOString();
          write(items);
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    res.sendStatus(500);
  }
});

// Public status lookup using a private random token.
app.get("/api/status/:token", (req, res) => {
  const item = read().find(x => x.publicToken === req.params.token);

  if (!item) {
    return res.status(404).json({ error: "Registration not found." });
  }

  res.json({
    name: item.name,
    roll: item.roll,
    amount: item.amount,
    status: item.status,
    createdAt: item.createdAt,
    receiptAvailable: item.status === "Verified"
  });
});

// Public receipt lookup using the same private random token.
app.get("/api/receipt/:token", (req, res) => {
  const item = read().find(x => x.publicToken === req.params.token);

  if (!item || item.status !== "Verified") {
    return res.status(404).json({ error: "Verified receipt not available." });
  }

  res.json({
    name: item.name,
    roll: item.roll,
    amount: item.amount,
    status: item.status,
    paymentId: item.paymentId,
    paymentMethod: item.paymentMethod,
    id: item.id,
    createdAt: item.updatedAt || item.createdAt
  });
});

// Administrator-only payment list.
app.get("/api/payments", adminAuth, (req, res) => {
  res.json(read());
});

// Administrator-only status management.
// Razorpay payments cannot be manually marked Verified.
app.post("/api/payments/:id/status", adminAuth, (req, res) => {
  const allowed = ["Pending", "Verified", "Rejected"];
  const status = req.body?.status;

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  const items = read();
  const item = items.find(x => x.id === req.params.id);

  if (!item) {
    return res.status(404).json({ error: "Payment not found." });
  }

  if (status === "Verified" && item.orderId) {
    return res.status(400).json({
      error: "Razorpay payments can only be verified automatically after capture."
    });
  }

  item.status = status;
  item.updatedAt = new Date().toISOString();
  write(items);

  res.json({ ok: true, item });
});

app.listen(PORT, () => {
  console.log(`CS EXAMs portal running on port ${PORT}`);
});
