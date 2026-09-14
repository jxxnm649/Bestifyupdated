import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js";

const functions = getFunctions();
const createRazorpayOrder = httpsCallable(functions, "createRazorpayOrder");
const payExistingOrderOnline = httpsCallable(functions, "payExistingOrderOnline");

const ordersContainer = document.getElementById("ordersContainer");

let allOrders = [];

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[m]);
}

function formatDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "Not available";
  }
}

function statusSlug(status) {
  if (status === "Delivered") return "delivered";
  if (status === "Shipped") return "shipped";
  return "processing"; // Pending / Confirmed / Packed / Cancelled
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  await loadOrders(user);
});

async function loadOrders(user) {

  ordersContainer.innerHTML = `<div style="text-align:center;padding:40px 16px;color:#888;">Loading your orders…</div>`;

  try {

    const q = query(collection(db, "orders"), where("userId", "==", user.uid));
    const snap = await getDocs(q);

    allOrders = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
        const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
        return tb - ta;
      });

    if (allOrders.length === 0) {
      ordersContainer.innerHTML = `
        <div style="text-align:center;padding:40px 16px;color:#888;">
          <h2 style="font-size:16px;color:#111;margin-bottom:6px;">No Orders Found 📦</h2>
          <p style="font-size:13px;">Looking like you haven't placed an order yet.</p>
        </div>`;
      return;
    }

    ordersContainer.innerHTML = allOrders.map(renderOrderCard).join("");

  } catch (error) {

    console.error("Orders Fetch Error:", error);
    ordersContainer.innerHTML = `
      <div style="text-align:center;padding:40px 16px;color:#888;">
        <h2 style="font-size:16px;color:#111;margin-bottom:6px;">❌ Couldn't load your orders</h2>
        <p style="font-size:13px;">${escapeHtml(error.message || "Please try again.")}</p>
        <button type="button" onclick="location.reload()" style="margin-top:12px;background:#9c27b0;color:#fff;border:none;padding:10px 18px;border-radius:8px;font-weight:700;">Retry</button>
      </div>`;

  }

}

function renderOrderCard(order) {

  const firstProduct = (order.products || [])[0] || {};
  const itemCount = (order.products || []).length;
  const isCOD = order.paymentMethod === "cod";
  const variantBits = [firstProduct.selectedSize, firstProduct.selectedColour].filter(Boolean).join(", ");
  const hasCashback = order.cashbackAmount > 0;
  const canPayNow = isCOD && ["Pending", "Confirmed", "Packed"].includes(order.status);

  return `
    <div class="card order-card-item" data-type="${isCOD ? "cod" : "paid"}" data-status="${statusSlug(order.status)}" data-real-status="${escapeHtml(order.status || "")}" onclick="toggleDetails(this)">

      <div class="order-meta-header">
        <span class="order-date-text">📅 Ordered on: ${formatDate(order.createdAt)}</span>
        <span class="payment-badge ${isCOD ? "badge-cod" : "badge-paid"}">${isCOD ? "COD" : "PAID"}</span>
      </div>

      <div class="product-main-info">
        <img src="${escapeHtml(firstProduct.image || "")}" alt="Product" class="product-thumb">
        <div class="product-text">
          <div class="order-id-title">${escapeHtml(firstProduct.productName || "Product")}${itemCount > 1 ? ` +${itemCount - 1} more` : ""}</div>
          <div class="item-list-note">${variantBits ? escapeHtml(variantBits) : `Status: ${escapeHtml(order.status || "Processing")}`}</div>
          <div class="variant-price">Qty: ${firstProduct.qty || 1} | <strong>₹${order.total ?? 0}</strong></div>
        </div>
      </div>

      <div class="order-actions" onclick="event.stopPropagation()">
        ${canPayNow ? `<button class="btn-action btn-pay-now" onclick="payNow('${order.id}')">⚡ PAY NOW</button>` : ""}
        ${hasCashback ? `<button class="btn-action btn-cashback" onclick="openScratchCard('${order.id}')">🎁 View Cashback</button>` : ""}
        ${firstProduct.id ? `<button class="btn-action" onclick="viewProductDetails('${firstProduct.id}')">👁️ View Details</button>` : ""}
        <button class="btn-action" onclick="shareOrder('${order.id}')">🔗 Share</button>
        <button class="btn-action" onclick="trackOrder('${order.id}')">🚚 Track Order</button>
      </div>

      <div class="full-details-panel">
        <p><strong>Order ID:</strong> #${escapeHtml(order.orderNumber || order.id.slice(0, 8).toUpperCase())}</p>
        <p><strong>Seller:</strong> Bestify Mobile</p>
        <p><strong>Placed on:</strong> ${formatDate(order.createdAt)}</p>
        <p><strong>Delivery Address:</strong> ${escapeHtml(order.address || "Not available")}</p>
      </div>

    </div>
  `;

}


/* ---------- Real share (replaces the fake demo version) ---------- */
window.shareOrder = async function (orderId) {

  const order = allOrders.find(o => o.id === orderId);
  const firstProduct = order?.products?.[0];
  if (!firstProduct) return;

  const shareUrl = firstProduct.id
    ? new URL(`product.html?id=${firstProduct.id}`, window.location.href).href
    : window.location.href;

  try {
    if (navigator.share) {
      await navigator.share({ title: "Bestify", text: `I just ordered ${firstProduct.productName} from Bestify!`, url: shareUrl });
    } else {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link copied!");
    }
  } catch (error) {
    // cancelled — nothing to do
  }

};


/* ---------- Real track (opens the real order-details/tracking page) ---------- */
window.trackOrder = function (orderId) {
  window.location.href = `order-details.html?orderId=${orderId}`;
};


/* ---------- View full product details (first item if the order has several) ---------- */
window.viewProductDetails = function (productId) {
  if (!productId) return;
  window.location.href = `product.html?id=${productId}`;
};


/* ---------- Real cashback (actual amount + status, no fake coupon/scratch) ---------- */
window.openScratchCard = function (orderId) {

  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const isCredited = order.cashbackStatus === "credited";

  document.getElementById("cashbackSubtext").textContent = isCredited
    ? "This has already been added to your wallet."
    : "Credited to your wallet once this order is delivered.";

  document.getElementById("cashbackStatusLabel").textContent = isCredited ? "CREDITED TO WALLET" : "PENDING DELIVERY";
  document.getElementById("couponCodeDisplay").textContent = `₹${order.cashbackAmount}`;

  document.getElementById("scratchModal").classList.add("active");

};

window.closeScratchCard = function () {
  document.getElementById("scratchModal").classList.remove("active");
};

/* ---------- Real Pay Now (COD -> online, server-verified) ---------- */
window.payNow = async function (orderId) {

  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const btn = document.querySelector(`[onclick="payNow('${orderId}')"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Starting Payment..."; }

  try {

    const { data } = await createRazorpayOrder({ amount: order.total });

    const options = {
      key: data.keyId,
      order_id: data.orderId,
      amount: data.amount,
      currency: data.currency,
      name: "Bestify Store",
      description: `Order #${order.orderNumber || orderId.slice(0, 8)}`,
      handler: async function (response) {
        try {
          await payExistingOrderOnline({
            orderId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          });
          alert("Payment successful! This order is now marked as paid online.");
          window.location.reload();
        } catch (error) {
          console.error(error);
          window.location.href = "payment-failed.html";
        }
      },
      modal: {
        ondismiss: function () {
          if (btn) { btn.disabled = false; btn.textContent = "⚡ PAY NOW"; }
        }
      },
      theme: { color: "#9c27b0" }
    };

    const rzp = new Razorpay(options);
    rzp.on("payment.failed", () => { window.location.href = "payment-failed.html"; });
    rzp.open();

  } catch (error) {
    console.error(error);
    alert(error.message || "Could not start payment. Please try again.");
    if (btn) { btn.disabled = false; btn.textContent = "⚡ PAY NOW"; }
  }

};

/* ---------- Real Status filter (bottom sheet) ---------- */
window.applyStatusFilter = function () {

  const checked = document.querySelector('input[name="statusFilter"]:checked');
  const value = checked ? checked.value : "All";

  document.querySelectorAll(".order-card-item").forEach(card => {
    const matches = value === "All" || card.dataset.realStatus === value;
    card.style.display = matches ? "block" : "none";
  });

  document.getElementById("filterModal").classList.remove("active");

};

window.clearStatusFilter = function () {

  const allRadio = document.querySelector('input[name="statusFilter"][value="All"]');
  if (allRadio) allRadio.checked = true;

  document.querySelectorAll(".order-card-item").forEach(card => {
    card.style.display = "block";
  });

  document.getElementById("filterModal").classList.remove("active");

};
