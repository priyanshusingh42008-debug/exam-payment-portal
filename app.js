
const button = document.getElementById("submit");
const msg = document.getElementById("msg");

button.onclick = async () => {
  const name = document.getElementById("name").value.trim();
  const roll = document.getElementById("roll").value.trim();

  if (!name || !roll) {
    msg.className = "error";
    msg.textContent = "Please enter your name and registration ID.";
    return;
  }

  if (typeof Razorpay === "undefined") {
    msg.className = "error";
    msg.textContent = "Payment service could not load. Please refresh and try again.";
    return;
  }

  button.disabled = true;
  button.textContent = "Preparing secure checkout...";
  msg.className = "";
  msg.textContent = "";

  let orderData;

  try {
    const response = await fetch("/api/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, roll })
    });

    orderData = await response.json();

    if (!response.ok) {
      throw new Error(orderData.error || "Unable to create payment order.");
    }

    if (!orderData.keyId || !orderData.orderId || !orderData.publicToken) {
      throw new Error("Payment configuration is incomplete.");
    }

    const options = {
      key: orderData.keyId,
      amount: orderData.amount,
      currency: orderData.currency,
      name: "CS EXAMs",
      description: "Computer Science & IT Practice Mock Test",
      order_id: orderData.orderId,

      prefill: {
        name: name
      },

      notes: {
        candidate_id: roll
      },

      theme: {
        color: "#1767a8"
      },

      handler: async function (paymentResponse) {
        button.disabled = true;
        button.textContent = "Verifying payment...";
        msg.className = "";
        msg.textContent = "Payment received. Please wait while we verify it.";

        try {
          const verification = await fetch("/api/verify-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...paymentResponse,
              publicToken: orderData.publicToken
            })
          });

          const result = await verification.json();

          if (!verification.ok) {
            throw new Error(result.error || "Payment verification is pending.");
          }

          msg.className = "successbox";
          msg.textContent = "Payment verified successfully! Opening your status page...";

          window.location.href = result.statusUrl;
        } catch (error) {
          msg.className = "successbox";
          msg.textContent =
            "Your payment may have been received, but verification is not complete. Please check your payment status using the link below.";

          const link = document.createElement("a");
          link.href = "/status.html?token=" +
            encodeURIComponent(orderData.publicToken);
          link.textContent = "Check payment status";
          msg.appendChild(document.createElement("br"));
          msg.appendChild(link);
        } finally {
          button.disabled = false;
          button.textContent = "Pay ₹2,500 Securely";
        }
      },

      modal: {
        ondismiss: function () {
          button.disabled = false;
          button.textContent = "Pay ₹2,500 Securely";

          msg.className = "";
          msg.textContent =
            "Checkout closed. If you completed a payment, check its status before trying again.";
        }
      }
    };

    const checkout = new Razorpay(options);

    checkout.on("payment.failed", function (response) {
      msg.className = "error";
      msg.textContent =
        response.error?.description ||
        "Payment was not completed. Please try again or contact support.";

      button.disabled = false;
      button.textContent = "Pay ₹2,500 Securely";
    });

    checkout.open();

  } catch (error) {
    msg.className = "error";
    msg.textContent = error.message || "Something went wrong. Please try again.";

    button.disabled = false;
    button.textContent = "Pay ₹2,500 Securely";
  }
};
