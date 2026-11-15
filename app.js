const submitButton = document.getElementById("submit");
submitButton.addEventListener("click", async () => {
  const msg = document.getElementById("msg");
  const name = document.getElementById("name").value.trim();
  const roll = document.getElementById("roll").value.trim();

  if (!name || !roll) {
    msg.className = "error";
    msg.textContent = "Please enter your full name and registration ID.";
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Preparing secure checkout…";
  msg.className = "";
  msg.textContent = "";

  try {
    const orderResponse = await fetch("/api/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, roll })
    });
    const order = await orderResponse.json();
    if (!orderResponse.ok) throw new Error(order.error || "Could not start payment.");

    const options = {
      key: order.key,
      amount: order.amount,
      currency: order.currency,
      name: order.name,
      description: order.description,
      order_id: order.orderId,
      prefill: { name },
      theme: { color: "#1767a8" },
      handler: async function (response) {
        msg.className = "";
        msg.textContent = "Payment received by checkout. Verifying securely…";
        try {
          const verifyResponse = await fetch("/api/verify-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response)
          });
          const result = await verifyResponse.json();
          if (verifyResponse.ok && result.ok) {
            msg.className = "successbox";
            msg.textContent = "Payment verified successfully. Your registration ID is " + result.registrationId + ". Save it to check your status.";
            document.getElementById("name").value = "";
            document.getElementById("roll").value = "";
          } else {
            msg.className = "successbox";
            msg.textContent = result.message || result.error || "Payment is not yet confirmed. Save registration ID " + order.registrationId + " and check status shortly. Do not pay again if money was deducted.";
          }
        } catch (error) {
          msg.className = "successbox";
          msg.textContent = "We could not confirm the status just now. Save registration ID " + order.registrationId + " and check status shortly. Do not pay again if money was deducted.";
        }
      },
      modal: {
        ondismiss: function () {
          msg.className = "";
          msg.textContent = "Checkout closed. If you completed a payment, check its status before trying again. Registration ID: " + order.registrationId;
        }
      }
    };

    const checkout = new Razorpay(options);
    checkout.on("payment.failed", function (response) {
      msg.className = "error";
      msg.textContent = response.error?.description || "Payment was not completed. You can try again.";
    });
    checkout.open();
  } catch (error) {
    msg.className = "error";
    msg.textContent = error.message || "Something went wrong. Please try again.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Pay ₹2,500 with Razorpay";
  }
});
