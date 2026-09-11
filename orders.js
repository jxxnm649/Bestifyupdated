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

const ordersDiv = document.getElementById("orders");
const orderSearchInput = document.getElementById("orderSearchInput");

let allOrders = [];
let activeTabFilter = "all";   // all | cod | online | delivered
let activeStatusFilter = "All"; // from the filter drawer

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

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  await loadOrders(user);
});

async function loadOrders(user) {

  ordersDiv.innerHTML = `<div class="no-results"><h2>Loading your orders…</h2></div>`;

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
      ordersDiv.innerHTML = `
        <div class="no-results">
          <h2>No Orders Found 📦</h2>
          <p>Looking like you haven't placed an order yet.</p>
        </div>`;
      return;
    }

    renderFilteredOrders();

  } catch (error) {
    console.error("Orders Fetch Error:", error);
    ordersDiv.innerHTML = `
      <div class="no-results">
        <h2>❌ Couldn't load your orders</h2>
        <p>${escapeHtml(error.message || "Something went wrong. Please try again.")}</p>
        <button type="button" class="btn-apply-filter" id="retryOrdersBtn" style="margin-top:12px;">Retry</button>
      </div>`;
    document.getElementById("retryOrdersBtn")?.addEventListener("click", () => loadOrders(user));
  }

}

function renderOrderCard(order) {

  const firstProduct = (order.products || [])[0] || {};
  const itemCount = (order.products || []).length;
  const isCOD = order.paymentMethod === "cod";
  const variantBits = [firstProduct.selectedSize, firstProduct.selectedColour].filter(Boolean).join(", ");

  const hasCashback = order.cashbackAmount > 0;

  return `
    <div class="card" data-order-id="${order.id}">

      <div class="order-meta-header">
        <span class="order-date-text">📅 Ordered on: ${formatDate(order.createdAt)}</span>
        <span class="payment-badge ${isCOD ? "badge-cod" : "badge-paid"}">${isCOD ? "COD" : "PAID"}</span>
      </div>

      <div class="product-main-info" data-toggle-details>
        <img src="${escapeHtml(firstProduct.image || "")}" alt="${escapeHtml(firstProduct.productName || "")}" class="product-thumb">
        <div class="product-text">
          <div class="order-id-title">${escapeHtml(firstProduct.productName || "Product")}${itemCount > 1 ? ` +${itemCount - 1} more` : ""}</div>
          <div class="item-list-note">${variantBits ? escapeHtml(variantBits) + " | " : ""}Status: ${escapeHtml(order.status || "Processing")}</div>
          <div class="variant-price">Qty: ${firstProduct.qty || 1} | <strong>₹${order.total ?? 0}</strong></div>
        </div>
      </div>

      <div class="order-actions">
        ${hasCashback ? `<button type="button" class="btn-action btn-cashback" data-cashback="${order.id}">🎁 View Cashback</button>` : ""}
        <button type="button" class="btn-action" data-share="${order.id}">🔗 Share</button>
        <button type="button" class="btn-action" data-track="${order.id}">🚚 Track Order</button>
      </div>

      <div class="full-details-panel" id="details-${order.id}">
        <p><strong>Order ID:</strong> #${escapeHtml(order.orderNumber || order.id.slice(0, 8).toUpperCase())}</p>
        <p><strong>Seller:</strong> Bestify Mobile</p>
        <p><strong>Placed on:</strong> ${formatDate(order.createdAt)}</p>
        <p><strong>Delivery Address:</strong> ${escapeHtml(order.address || "Not available")}</p>
      </div>

    </div>
  `;

}

function renderFilteredOrders() {

  const term = orderSearchInput.value.trim().toLowerCase();

  const filtered = allOrders.filter(order => {

    const isCOD = order.paymentMethod === "cod";

    const matchesTab =
      activeTabFilter === "all" ||
      (activeTabFilter === "cod" && isCOD) ||
      (activeTabFilter === "online" && !isCOD) ||
      (activeTabFilter === "delivered" && order.status === "Delivered");

    const matchesStatus = activeStatusFilter === "All" || order.status === activeStatusFilter;

    const matchesTerm = !term || (order.products || []).some(p =>
      (p.productName || "").toLowerCase().includes(term)
    );

    return matchesTab && matchesStatus && matchesTerm;

  });

  if (!filtered.length) {
    ordersDiv.innerHTML = `
      <div class="no-results">
        <h2>No orders match this filter</h2>
        <p>Try a different tab or search term.</p>
      </div>`;
    return;
  }

  ordersDiv.innerHTML = filtered.map(renderOrderCard).join("");

}

orderSearchInput.addEventListener("input", renderFilteredOrders);

/* ---------- Tab chips ---------- */
document.getElementById("filterTabsRow").addEventListener("click", (e) => {
  const chip = e.target.closest(".tab-chip");
  if (!chip) return;

  activeTabFilter = chip.dataset.filter;
  document.querySelectorAll(".tab-chip").forEach(c => c.classList.toggle("active", c === chip));
  renderFilteredOrders();
});

/* ---------- Filter drawer (status) ---------- */
const filterModal = document.getElementById("filterModal");
const statusFilterOptions = document.getElementById("statusFilterOptions");
let pendingStatusFilter = "All";

document.getElementById("openFilterBtn").addEventListener("click", () => filterModal.classList.add("active"));
document.getElementById("closeFilterBtn").addEventListener("click", () => filterModal.classList.remove("active"));
filterModal.addEventListener("click", (e) => { if (e.target === filterModal) filterModal.classList.remove("active"); });

statusFilterOptions.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-option-btn");
  if (!btn) return;
  statusFilterOptions.querySelectorAll(".filter-option-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  pendingStatusFilter = btn.dataset.value;
});

document.getElementById("applyFilterBtn").addEventListener("click", () => {
  activeStatusFilter = pendingStatusFilter;
  renderFilteredOrders();
  filterModal.classList.remove("active");
});

document.getElementById("resetFilterBtn").addEventListener("click", () => {
  pendingStatusFilter = "All";
  activeStatusFilter = "All";
  statusFilterOptions.querySelectorAll(".filter-option-btn").forEach(b => b.classList.toggle("selected", b.dataset.value === "All"));
  renderFilteredOrders();
  filterModal.classList.remove("active");
});

/* ---------- Card interactions ---------- */
ordersDiv.addEventListener("click", async (e) => {

  const cashbackBtn = e.target.closest("[data-cashback]");
  if (cashbackBtn) {
    e.stopPropagation();
    openCashbackModal(cashbackBtn.dataset.cashback);
    return;
  }

  const shareBtn = e.target.closest("[data-share]");
  if (shareBtn) {
    e.stopPropagation();
    await shareOrder(shareBtn.dataset.share);
    return;
  }

  const trackBtn = e.target.closest("[data-track]");
  if (trackBtn) {
    e.stopPropagation();
    window.location.href = `order-details.html?orderId=${trackBtn.dataset.track}`;
    return;
  }

  const toggleArea = e.target.closest("[data-toggle-details]");
  if (toggleArea) {
    const card = toggleArea.closest(".card");
    const panel = document.getElementById(`details-${card.dataset.orderId}`);
    panel.classList.toggle("show");
  }

});

/* ---------- Real cashback modal (actual amount + status, no fake coupon) ---------- */
const cashbackModal = document.getElementById("cashbackModal");

function openCashbackModal(orderId) {

  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const isCredited = order.cashbackStatus === "credited";

  document.getElementById("cashbackSubtext").textContent = isCredited
    ? "This has already been added to your wallet."
    : "Credited to your wallet once this order is delivered.";

  document.getElementById("cashbackStatusLabel").textContent = isCredited ? "CREDITED TO WALLET" : "PENDING DELIVERY";
  document.getElementById("cashbackAmountDisplay").textContent = `₹${order.cashbackAmount}`;

  cashbackModal.classList.add("active");

}

document.getElementById("closeCashbackBtn").addEventListener("click", () => cashbackModal.classList.remove("active"));
cashbackModal.addEventListener("click", (e) => { if (e.target === cashbackModal) cashbackModal.classList.remove("active"); });

/* ---------- Real share ---------- */
async function shareOrder(orderId) {

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

}
