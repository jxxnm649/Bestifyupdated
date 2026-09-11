import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

import { raiseAdminAlert } from "./admin-alerts.js";

const ordersDiv = document.getElementById("orders");
const orderSearchInput = document.getElementById("orderSearchInput");

let allOrders = [];
let activeStatusFilter = "All";

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
    return "";
  }
}

// Real status → a friendly title + colour, no fake claims like
// "delivered early" (we don't track an original ETA to compare against).
function statusDisplay(status) {
  switch (status) {
    case "Pending":   return { title: "Order Placed", cls: "" };
    case "Confirmed": return { title: "Order Confirmed", cls: "" };
    case "Packed":    return { title: "Packed", cls: "" };
    case "Shipped":   return { title: "On the way", cls: "" };
    case "Delivered": return { title: "Delivered", cls: "" };
    case "Cancelled": return { title: "Order Cancelled", cls: "rust" };
    default:          return { title: status || "Processing", cls: "" };
  }
}

function renderOrderCard(order) {

  const firstProduct = (order.products || [])[0] || {};
  const itemCount = (order.products || []).length;
  const { title, cls } = statusDisplay(order.status);

  const variantBits = [firstProduct.selectedSize, firstProduct.selectedColour].filter(Boolean).join(", ");
  const qty = firstProduct.qty || 1;

  const ratingHTML = order.status === "Delivered" ? `
    <div class="rating-box">
      ${order.rating ? `
        <div class="rating-saved-note">✅ You rated this order ${order.rating}/5 — thank you!</div>
      ` : `
        <div class="rating-title">How was the product?</div>
        <div class="stars-row" data-order-id="${order.id}">
          ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star-btn" data-rating="${n}">${n}⭐</button>`).join("")}
        </div>
      `}
    </div>
  ` : "";

  return `
    <div class="order-card" data-status="${escapeHtml(order.status || "")}" data-order-id="${order.id}">
      <div class="order-content" data-view-id="${order.id}">
        <img src="${escapeHtml(firstProduct.image || "")}" alt="${escapeHtml(firstProduct.productName || "")}">
        <div class="order-details">
          <div class="status-title ${cls}">${title}</div>
          <div class="delivery-date">Placed on ${formatDate(order.createdAt)}</div>
          <div class="variant-info">${escapeHtml(firstProduct.productName || "Product")}${itemCount > 1 ? ` +${itemCount - 1} more` : ""}${variantBits ? ` • ${escapeHtml(variantBits)}` : ""} • Qty: ${qty}</div>
        </div>
        <div class="chevron">›</div>
      </div>

      <div class="share-row">
        <div class="share-preview">
          <img class="share-thumb" src="${escapeHtml(firstProduct.image || "")}" alt="">
          <span>Share your purchase with friends</span>
        </div>
        <button type="button" class="share-btn" data-share-id="${order.id}">📤 SHARE</button>
      </div>

      ${ratingHTML}
    </div>
  `;

}

// Auth State Monitor
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
    const q = query(
      collection(db, "orders"),
      where("userId", "==", user.uid)
    );

    const querySnapshot = await getDocs(q);

    allOrders = querySnapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
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
    console.error("Orders Fetch Error: ", error);
    ordersDiv.innerHTML = `
      <div class="no-results">
        <h2>❌ Couldn't load your orders</h2>
        <p>${escapeHtml(error.message || "Something went wrong. Please try again.")}</p>
        <button type="button" class="btn-apply" id="retryOrdersBtn" style="margin-top:12px;">Retry</button>
      </div>`;
    const retryBtn = document.getElementById("retryOrdersBtn");
    if (retryBtn) retryBtn.addEventListener("click", () => loadOrders(user));
  }

}

function renderFilteredOrders() {

  const term = orderSearchInput ? orderSearchInput.value.trim().toLowerCase() : "";

  const filtered = allOrders.filter((order) => {

    const matchesStatus = activeStatusFilter === "All" || order.status === activeStatusFilter;

    const matchesTerm = !term || (order.products || []).some(p =>
      (p.productName || "").toLowerCase().includes(term)
    );

    return matchesStatus && matchesTerm;

  });

  if (!filtered.length) {
    ordersDiv.innerHTML = `
      <div class="no-results">
        <h2>No orders match this filter</h2>
        <p>Try a different status or search term.</p>
      </div>`;
    return;
  }

  ordersDiv.innerHTML = filtered.map(renderOrderCard).join("");

}

if (orderSearchInput) orderSearchInput.addEventListener("input", renderFilteredOrders);

/* ---------- Filter modal ---------- */
const openFilterBtn = document.getElementById("openFilterBtn");
const closeFilterBtn = document.getElementById("closeFilterBtn");
const filterModal = document.getElementById("filterModal");
const statusOptionsList = document.getElementById("statusOptionsList");
const clearFilterBtn = document.getElementById("clearFilterBtn");
const applyFilterBtn = document.getElementById("applyFilterBtn");

let pendingStatusFilter = "All";

if (openFilterBtn) openFilterBtn.addEventListener("click", () => filterModal.classList.add("open"));
if (closeFilterBtn) closeFilterBtn.addEventListener("click", () => filterModal.classList.remove("open"));
if (filterModal) filterModal.addEventListener("click", (e) => {
  if (e.target === filterModal) filterModal.classList.remove("open");
});

if (statusOptionsList) {
  statusOptionsList.addEventListener("click", (e) => {
    const item = e.target.closest(".option-item");
    if (!item) return;
    [...statusOptionsList.children].forEach(el => el.classList.remove("selected"));
    item.classList.add("selected");
    pendingStatusFilter = item.dataset.value;
  });
}

if (applyFilterBtn) {
  applyFilterBtn.addEventListener("click", () => {
    activeStatusFilter = pendingStatusFilter;
    renderFilteredOrders();
    filterModal.classList.remove("open");
  });
}

if (clearFilterBtn) {
  clearFilterBtn.addEventListener("click", () => {
    pendingStatusFilter = "All";
    activeStatusFilter = "All";
    [...statusOptionsList.children].forEach(el => el.classList.toggle("selected", el.dataset.value === "All"));
    if (orderSearchInput) orderSearchInput.value = "";
    renderFilteredOrders();
    filterModal.classList.remove("open");
  });
}

/* ---------- Card interactions: view details / share / rate / cancel ---------- */
ordersDiv.addEventListener("click", async (e) => {

  // Real share — actual order/product info, native share sheet or clipboard.
  const shareBtn = e.target.closest(".share-btn");
  if (shareBtn) {
    e.stopPropagation();
    const order = allOrders.find(o => o.id === shareBtn.dataset.shareId);
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
    return;
  }

  // Real rating — saved once to the order document.
  const starBtn = e.target.closest(".star-btn");
  if (starBtn) {
    e.stopPropagation();
    const starsRow = starBtn.closest(".stars-row");
    const orderId = starsRow.dataset.orderId;
    const rating = Number(starBtn.dataset.rating);

    try {
      await updateDoc(doc(db, "orders", orderId), { rating, ratedAt: new Date() });
      const idx = allOrders.findIndex(o => o.id === orderId);
      if (idx !== -1) allOrders[idx].rating = rating;
      renderFilteredOrders();
    } catch (error) {
      console.error(error);
      alert(error.message || "Could not save your rating.");
    }
    return;
  }

  // Tap the card body → real order details page.
  const contentRow = e.target.closest(".order-content");
  if (contentRow) {
    window.location.href = `order-details.html?orderId=${contentRow.dataset.viewId}`;
  }

});
