import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

import { raiseAdminAlert } from "./admin-alerts.js";

const orderContent = document.getElementById("orderContent");

const params = new URLSearchParams(window.location.search);
const orderId = params.get("orderId");

const STEPS = ["Ordered", "Packed", "Shipped", "Delivered"];

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[m]);
}

function formatDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
      " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "Not available";
  }
}

function stepIndexFor(status) {
  switch (status) {
    case "Pending":
    case "Confirmed":
      return 0;
    case "Packed":
      return 1;
    case "Shipped":
      return 2;
    case "Delivered":
      return 3;
    default:
      return 0;
  }
}

let currentOrder = null;
let currentUser = null;

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;

  if (!orderId) {
    orderContent.innerHTML = `<div class="no-results"><h2>No order specified</h2></div>`;
    return;
  }

  await loadOrder();

});

async function loadOrder() {

  orderContent.innerHTML = `<div class="no-results"><h2>Loading order…</h2></div>`;

  try {

    const snap = await getDoc(doc(db, "orders", orderId));

    if (!snap.exists()) {
      orderContent.innerHTML = `<div class="no-results"><h2>Order not found</h2></div>`;
      return;
    }

    const order = { id: snap.id, ...snap.data() };

    if (order.userId !== currentUser.uid) {
      orderContent.innerHTML = `<div class="no-results"><h2>You don't have access to this order</h2></div>`;
      return;
    }

    currentOrder = order;
    render(order);

  } catch (error) {
    console.error(error);
    orderContent.innerHTML = `
      <div class="no-results">
        <h2>❌ Couldn't load this order</h2>
        <p>${escapeHtml(error.message || "Please try again.")}</p>
        <button type="button" class="btn-cancel-order" id="retryOrderBtn" style="margin-top:12px;">Retry</button>
      </div>`;
    const retryBtn = document.getElementById("retryOrderBtn");
    if (retryBtn) retryBtn.addEventListener("click", loadOrder);
  }

}

function render(order) {

  const products = Array.isArray(order.products) ? order.products : [];
  const firstProduct = products[0] || {};
  const total = order.total ?? order.totalPrice ?? 0;
  const isCancelled = order.status === "Cancelled";
  const isDelivered = order.status === "Delivered";
  const canCancel = ["Pending", "Confirmed", "Ordered", "Packed"].includes(order.status);

  const activeIndex = stepIndexFor(order.status);
  const progressPct = isCancelled ? 0 : (activeIndex / (STEPS.length - 1)) * 100;

  orderContent.innerHTML = `

    <div class="card">
      <div class="product-main-info">
        <img class="product-thumb" src="${escapeHtml(firstProduct.image || "")}" alt="">
        <div class="product-text">
          <div class="order-id-title">Order #${escapeHtml(order.orderNumber || order.id.slice(0, 8).toUpperCase())}</div>
          <div class="item-list-note">${escapeHtml(firstProduct.productName || "Product")}${products.length > 1 ? ` +${products.length - 1} more item${products.length > 2 ? "s" : ""}` : ""}</div>
          <div class="variant-price">Qty: ${firstProduct.qty || 1} &bull; ₹${total}</div>
        </div>
      </div>
    </div>

    <div class="card share-row">
      <div class="share-preview">
        <img class="share-mini-thumb" src="${escapeHtml(firstProduct.image || "")}" alt="">
        <span>Share your purchase with friends</span>
      </div>
      <button type="button" class="share-btn" id="shareOrderBtn">📤 SHARE</button>
    </div>

    <div class="card">
      <div class="tracking-header">
        <div class="status-icon ${isCancelled ? "rust" : ""}">${isCancelled ? "✕" : isDelivered ? "✓" : (activeIndex + 1)}</div>
        <div>
          <div class="tracking-status-title">${isCancelled ? "Order Cancelled" : STEPS[activeIndex]}</div>
          <div class="tracking-sub">Placed on ${formatDate(order.createdAt)}</div>
        </div>
      </div>

      ${isCancelled ? `
        <div class="cancelled-note">❌ This order was cancelled${order.cancelledAt ? " on " + formatDate(order.cancelledAt) : ""}.</div>
      ` : `
        <div class="steps-wrapper">
          <div class="progress-line-bg"></div>
          <div class="progress-line-active" style="width:${progressPct}%;"></div>
          ${STEPS.map((label, i) => `
            <div class="step-item">
              <div class="step-circle ${i < activeIndex ? "completed" : i === activeIndex ? "current" : ""}">${i < activeIndex ? "✓" : i + 1}</div>
              <div class="step-label">${label}</div>
            </div>
          `).join("")}
        </div>

        ${canCancel ? `
          <div class="cancel-row">
            <span class="cancel-text">Cancellation available till it ships.</span>
            <button type="button" class="btn-cancel-order" id="cancelOrderBtn">Cancel Order</button>
          </div>
        ` : ""}
      `}
    </div>

    <div class="card">
      <div class="payment-mode-header">
        <span>Payment mode:</span>
        <span class="payment-value">${order.paymentMethod === "cod" ? "Cash on Delivery" : "Paid Online"} &bull; ₹${total}</span>
      </div>
    </div>

    <div class="card">
      <div class="address-header">
        <span class="address-title">📍 Delivery Address</span>
      </div>
      <div class="address-body">
        <div class="address-name">${escapeHtml(order.customerName || "Customer")}</div>
        <div>${escapeHtml(order.address || "Not available")}</div>
        <div>${escapeHtml(order.mobile || "")}</div>
      </div>
    </div>

    <div class="card">
      <div class="bill-row"><span>Total Product Price</span><span>₹${total}</span></div>
      <div class="total-payment-row">
        <div class="payment-type-left">
          <span>${order.paymentMethod === "cod" ? "💵" : "💳"}</span>
          <span>${order.paymentMethod === "cod" ? "Cash On Delivery" : "Paid Online"}</span>
        </div>
        <span class="final-price">₹${total}</span>
      </div>
    </div>

  `;

  document.getElementById("shareOrderBtn").addEventListener("click", async () => {
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
  });

  const cancelBtn = document.getElementById("cancelOrderBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", async () => {

      if (!confirm("Cancel this order?")) return;

      cancelBtn.disabled = true;
      cancelBtn.textContent = "Cancelling...";

      try {

        await updateDoc(doc(db, "orders", order.id), {
          status: "Cancelled",
          cancelledAt: new Date()
        });

        raiseAdminAlert("order_cancel", `Order cancelled by customer`, {
          userId: currentUser.uid,
          orderId: order.id
        });

        await loadOrder();

      } catch (error) {
        console.error(error);
        alert(error.message || "Could not cancel this order.");
        cancelBtn.disabled = false;
        cancelBtn.textContent = "Cancel Order";
      }

    });
  }

}
