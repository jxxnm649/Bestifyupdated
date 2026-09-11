import { auth, db } from "../firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  deleteDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

import {
  openModal,
  closeModal,
  showToast
} from "../design-system.js";

import { logAdminAction } from "./audit.js";

import { nextSequenceNumber } from "../counters.js";


const form = document.getElementById("productForm");
const productsList = document.getElementById("productsList");
const productCount = document.getElementById("productCount");
const productSearch = document.getElementById("productSearch");
const productStatusFilter = document.getElementById("productStatusFilter");

const imageFile = document.getElementById("imageFile");
const previewRow = document.getElementById("previewRow");
const imageCountLabel = document.getElementById("imageCountLabel");
const categoryList = document.getElementById("categoryList");

const colorVariantRows = document.getElementById("colorVariantRows");
const addColorVariantBtn = document.getElementById("addColorVariantBtn");
let colorVariants = []; // { name, files: File[], existingImages: string[] }

const returnPolicySelect = document.getElementById("returnPolicy");
const returnPolicyCustom = document.getElementById("returnPolicyCustom");
const warrantySelect = document.getElementById("warranty");
const warrantyCustom = document.getElementById("warranty" + "Custom");

function toggleCustomInput(select, input) {
  input.style.display = select.value === "Custom" ? "block" : "none";
}

if (returnPolicySelect) {
  returnPolicySelect.addEventListener("change", () => toggleCustomInput(returnPolicySelect, returnPolicyCustom));
}
if (warrantySelect) {
  warrantySelect.addEventListener("change", () => toggleCustomInput(warrantySelect, warrantyCustom));
}

const MAX_IMAGES = 8;

const addProductBtn = document.getElementById("addProductBtn");
const productFormModal = document.getElementById("productFormModal");
const productFormCloseBtn = document.getElementById("productFormCloseBtn");
const productFormTitle = document.getElementById("productFormTitle");
const productFormSubmitBtn = document.getElementById("productFormSubmitBtn");

let editMode = false;
let editProductId = null;
let existingImages = [];
let selectedFiles = [];
let allProducts = [];


/* =========================
   IMAGE PREVIEW (accumulates up to MAX_IMAGES, doesn't overwrite previous picks)
========================= */

imageFile.value = "";

imageFile.addEventListener("change", () => {

  const newFiles = Array.from(imageFile.files);
  const usedSlots = existingImages.length + selectedFiles.length;
  const remainingSlots = MAX_IMAGES - usedSlots;

  if (newFiles.length > remainingSlots) {
    showToast(`Max ${MAX_IMAGES} images allowed. Added first ${Math.max(remainingSlots, 0)}.`, "danger");
  }

  selectedFiles = selectedFiles.concat(newFiles.slice(0, Math.max(remainingSlots, 0)));

  imageFile.value = ""; // allow re-picking without losing earlier selections

  renderPreview();

});

function thumb(src, onRemove) {
  const wrap = document.createElement("div");
  wrap.style.position = "relative";

  const img = document.createElement("img");
  img.src = src;
  img.width = 120;
  img.height = 120;
  img.style.objectFit = "cover";
  img.style.borderRadius = "10px";
  wrap.appendChild(img);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "✕";
  removeBtn.style.cssText = "position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;border:none;background:#c62828;color:#fff;cursor:pointer;font-size:12px;line-height:1;";
  removeBtn.addEventListener("click", onRemove);
  wrap.appendChild(removeBtn);

  return wrap;
}

function renderPreview() {
  previewRow.innerHTML = "";

  existingImages.forEach((url, idx) => {
    previewRow.appendChild(thumb(url, () => {
      existingImages = existingImages.filter((_, i) => i !== idx);
      renderPreview();
    }));
  });

  selectedFiles.forEach((file, idx) => {
    previewRow.appendChild(thumb(URL.createObjectURL(file), () => {
      selectedFiles = selectedFiles.filter((_, i) => i !== idx);
      renderPreview();
    }));
  });

  if (imageCountLabel) {
    imageCountLabel.textContent = `${existingImages.length + selectedFiles.length}/${MAX_IMAGES}`;
  }
}


/* =========================
   MODAL OPEN / CLOSE
========================= */

function resetForm() {
  form.reset();
  document.getElementById("status").value = "Active";
  if (returnPolicySelect) { returnPolicySelect.value = "7 Days Return"; returnPolicyCustom.value = ""; returnPolicyCustom.style.display = "none"; }
  if (warrantySelect) { warrantySelect.value = "6 Month Warranty"; warrantyCustom.value = ""; warrantyCustom.style.display = "none"; }
  previewRow.innerHTML = "";
  existingImages = [];
  selectedFiles = [];
  imageFile.value = "";
  if (imageCountLabel) imageCountLabel.textContent = `0/${MAX_IMAGES}`;
  colorVariants = [];
  renderColorVariantRows();
  editMode = false;
  editProductId = null;
  productFormTitle.textContent = "Add Product";
  productFormSubmitBtn.textContent = "Save Product";
}

if (addProductBtn) {
  addProductBtn.addEventListener("click", () => {
    resetForm();
    openModal("productFormModal");
  });
}

if (productFormCloseBtn) {
  productFormCloseBtn.addEventListener("click", () => {
    closeModal("productFormModal");
  });
}


/* =========================
   COLOR VARIANTS — each is a name + its own photo
========================= */

function renderColorVariantRows() {

  colorVariantRows.innerHTML = colorVariants.map((v, i) => {

    const previewUrls = [
      ...(v.existingImages || []),
      ...(v.files || []).map(f => URL.createObjectURL(f))
    ];

    return `
    <div class="bf-color-variant-row" style="border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;position:relative;">
      <button type="button" class="bf-btn bf-btn-ghost bf-btn-sm" data-variant-remove="${i}" aria-label="Remove row" style="position:absolute;top:8px;right:8px;width:auto;">✕ Remove</button>

      <div style="padding-right:80px;margin-bottom:8px;">
        <span style="font-size:12px;color:var(--ink-soft);">Color ${i + 1}</span>
      </div>

      <input type="text" class="bf-input" placeholder="Color name (e.g. Red)" value="${v.name || ""}" data-variant-name="${i}" style="margin-bottom:8px;">

      ${previewUrls.length ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          ${previewUrls.map((url, photoIdx) => `
            <div style="position:relative;">
              <img src="${url}" alt="" style="width:56px;height:56px;border-radius:8px;object-fit:cover;background:var(--paper-dim);">
              <button type="button" data-variant-photo-remove="${i}:${photoIdx}" aria-label="Remove photo"
                style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--bf-danger,#c0392b);color:#fff;border:none;font-size:11px;line-height:1;cursor:pointer;">✕</button>
            </div>
          `).join("")}
        </div>
      ` : ""}

      <label class="bf-btn bf-btn-ghost bf-btn-sm" style="display:inline-block;width:auto;cursor:pointer;">
        + Add Photos (multiple angles)
        <input type="file" accept="image/*" multiple data-variant-file="${i}" style="display:none;">
      </label>
    </div>
  `;
  }).join("");

}

if (addColorVariantBtn) {
  addColorVariantBtn.addEventListener("click", () => {
    colorVariants.push({ name: "", files: [], existingImages: [] });
    renderColorVariantRows();
  });
}

if (colorVariantRows) {
  colorVariantRows.addEventListener("input", (e) => {
    const nameIdx = e.target.dataset.variantName;
    if (nameIdx !== undefined) colorVariants[Number(nameIdx)].name = e.target.value;
  });

  // Pressing Enter/Done on a mobile keyboard inside a form field submits
  // the whole form by default — that was silently saving the product
  // with an empty colorVariants row before the photos were even picked.
  colorVariantRows.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset.variantName !== undefined) {
      e.preventDefault();
    }
  });

  colorVariantRows.addEventListener("change", (e) => {
    const fileIdx = e.target.dataset.variantFile;
    if (fileIdx !== undefined && e.target.files.length) {
      const v = colorVariants[Number(fileIdx)];
      v.files = [...(v.files || []), ...Array.from(e.target.files)];
      renderColorVariantRows();
    }
  });

  colorVariantRows.addEventListener("click", (e) => {

    const removeBtn = e.target.closest("[data-variant-remove]");
    if (removeBtn) {
      colorVariants.splice(Number(removeBtn.dataset.variantRemove), 1);
      renderColorVariantRows();
      return;
    }

    const photoRemoveBtn = e.target.closest("[data-variant-photo-remove]");
    if (photoRemoveBtn) {
      const [variantIdx, photoIdx] = photoRemoveBtn.dataset.variantPhotoRemove.split(":").map(Number);
      const v = colorVariants[variantIdx];
      const existingCount = (v.existingImages || []).length;

      if (photoIdx < existingCount) {
        v.existingImages.splice(photoIdx, 1);
      } else {
        v.files.splice(photoIdx - existingCount, 1);
      }
      renderColorVariantRows();
    }

  });
}

async function uploadColorVariants() {

  const result = [];
  let rowNumber = 0;

  for (const v of colorVariants) {

    rowNumber++;
    const name = (v.name || "").trim();
    const hasAnyPhoto = (v.existingImages && v.existingImages.length) || (v.files && v.files.length);
    if (!name && !hasAnyPhoto) continue; // fully blank row — skip quietly

    const images = [...(v.existingImages || [])];

    for (const file of (v.files || [])) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", "Bestifyimg");
      const response = await fetch("https://api.cloudinary.com/v1_1/rgksliph/image/upload", { method: "POST", body: formData });
      const data = await response.json();
      if (data.secure_url) images.push(data.secure_url);
    }

    if (!name || images.length === 0) {
      throw new Error(`Color row ${rowNumber} (${name || "no name yet"}) is missing a ${!name ? "name" : "photo"} — fill it in or tap ✕ to remove that row.`);
    }

    result.push({ name, image: images[0], images });

  }

  return result;

}


/* =========================
   IMAGE UPLOAD (Cloudinary)
========================= */

async function uploadImages() {

  if (selectedFiles.length === 0 && existingImages.length === 0) {
    showToast("Select at least one image", "danger");
    return null;
  }

  const uploadedUrls = [];

  for (const file of selectedFiles) {

    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "Bestifyimg");

    const response = await fetch(
      "https://api.cloudinary.com/v1_1/rgksliph/image/upload",
      {
        method: "POST",
        body: formData
      }
    );

    const data = await response.json();
    uploadedUrls.push(data.secure_url);

  }

  // Keep any existing (unremoved) images + newly uploaded ones, capped at MAX_IMAGES
  return [...existingImages, ...uploadedUrls].slice(0, MAX_IMAGES);

}


/* =========================
   SUBMIT (ADD / UPDATE)
========================= */

form.addEventListener("submit", async (e) => {

  e.preventDefault();

  productFormSubmitBtn.disabled = true;
  productFormSubmitBtn.textContent = editMode ? "Updating..." : "Saving...";

  try {

    const imageUrls = await uploadImages();

    if (!imageUrls || imageUrls.length === 0) {
      productFormSubmitBtn.disabled = false;
      productFormSubmitBtn.textContent = editMode ? "Update Product" : "Save Product";
      return;
    }

    const finalColorVariants = await uploadColorVariants();

    const productData = {
      image: imageUrls[0],
      images: imageUrls,
      productName: document.getElementById("productName").value.trim(),
      category: document.getElementById("category").value.trim(),
      mrp: document.getElementById("mrp").value ? Number(document.getElementById("mrp").value) : 0,
      price: Number(document.getElementById("price").value),
      stock: Number(document.getElementById("stock").value),
      description: document.getElementById("description").value.trim(),
      sizes: document.getElementById("sizes").value
        ? document.getElementById("sizes").value.split(",").map(s => s.trim()).filter(Boolean)
        : [],
      colours: document.getElementById("colours").value
        ? document.getElementById("colours").value.split(",").map(s => s.trim()).filter(Boolean)
        : [],
      colorVariants: finalColorVariants,
      returnPolicy: document.getElementById("returnPolicy").value === "Custom"
        ? (document.getElementById("returnPolicyCustom").value.trim() || "7 Days Return")
        : document.getElementById("returnPolicy").value,
      warranty: document.getElementById("warranty").value === "Custom"
        ? (document.getElementById("warrantyCustom").value.trim() || "6 Month Warranty")
        : document.getElementById("warranty").value,
      status: document.getElementById("status").value
    };

    if (editMode) {

      // Admin edits to an EXISTING listing don't need to be re-approved —
      // approvalStatus (if any) is left untouched by this partial update.
      await updateDoc(doc(db, "products", editProductId), productData);
      await logAdminAction("Updated product", "Products", {
        productId: editProductId,
        name: productData.productName
      });
      showToast("Product updated", "success");

    } else {

      const seq = await nextSequenceNumber("products");
      productData.productCode = `Bestify${seq}`;
      // Products admin adds directly are already trusted — live immediately.
      productData.approvalStatus = "Approved";

      const newDoc = await addDoc(collection(db, "products"), productData);
      await logAdminAction("Added product", "Products", {
        productId: newDoc.id,
        name: productData.productName,
        productCode: productData.productCode
      });
      showToast("Product added", "success");

    }

    closeModal("productFormModal");
    resetForm();
    loadProducts();

  } catch (error) {

    console.error("Product save error:", error);
    showToast(error.message || "Failed to save product.", "danger");

  } finally {

    productFormSubmitBtn.disabled = false;
    productFormSubmitBtn.textContent = editMode ? "Update Product" : "Save Product";

  }

});


/* =========================
   LOAD & RENDER PRODUCTS
========================= */

async function loadProducts() {

  try {

    const snapshot = await getDocs(collection(db, "products"));

    allProducts = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    renderProductList();

    if (categoryList) {
      const seen = new Map();
      allProducts.forEach((p) => {
        const raw = (p.category || "").toString().trim();
        if (raw && !seen.has(raw.toLowerCase())) seen.set(raw.toLowerCase(), raw);
      });
      categoryList.innerHTML = [...seen.values()]
        .map((c) => `<option value="${escapeHtml(c)}"></option>`)
        .join("");
    }

  } catch (error) {

    console.error("Products loading error:", error);

    productsList.innerHTML = `
      <div class="bf-card" style="padding:20px;">
        ❌ Unable to load products.
      </div>
    `;

  }

}

function escapeHtml(str) {
  if (typeof str !== "string") return str;
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

function getFilteredProducts() {

  const term = productSearch.value.trim().toLowerCase();
  const statusFilter = productStatusFilter.value;

  return allProducts.filter((product) => {

    const name = (product.productName || "").toLowerCase();
    const category = (product.category || "").toLowerCase();
    const status = product.status === "Inactive" ? "Inactive" : "Active";

    const matchesTerm = !term || name.includes(term) || category.includes(term);
    const matchesStatus = statusFilter === "All" || status === statusFilter;

    return matchesTerm && matchesStatus;

  });

}

function renderProductList() {

  const filtered = getFilteredProducts();

  productCount.textContent = `Total Products: ${allProducts.length}`;

  if (!filtered.length) {
    productsList.innerHTML = `
      <div class="bf-card" style="padding:20px;">
        No products found.
      </div>
    `;
    return;
  }

  productsList.innerHTML = filtered.map((product) => {

    const status = product.status === "Inactive" ? "Inactive" : "Active";
    const stock = product.stock ?? 0;

    const stockLabel =
      stock === 0 ? "Out of Stock" :
      stock <= 5 ? `${stock} left` :
      `${stock} in stock`;

    const stockClass =
      stock === 0 ? "bf-status-danger" :
      stock <= 5 ? "bf-status-warning" :
      "bf-status-success";

    const priceHtml =
      Number(product.mrp) > Number(product.price)
        ? `<span style="text-decoration:line-through;opacity:.55;font-size:12px;">₹${escapeHtml(String(product.mrp))}</span> <strong>₹${escapeHtml(String(product.price))}</strong>`
        : `<strong>₹${escapeHtml(String(product.price))}</strong>`;

    return `
      <div class="bf-card" style="padding:14px; display:flex; flex-direction:column; gap:8px;">

        <img
          src="${escapeHtml(product.image || "")}"
          alt="${escapeHtml(product.productName || "")}"
          style="width:100%; aspect-ratio:1/1; object-fit:cover; border-radius:10px;">

        <div style="font-weight:700; font-size:15px;">
          ${escapeHtml(product.productName || "Unnamed product")}
        </div>

        <div style="font-size:12px; opacity:.7;">
          ${escapeHtml(product.category || "Uncategorized")}
        </div>

        <div style="font-size:14px;">
          ${priceHtml}
        </div>

        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <span class="bf-status-pill ${stockClass}">${escapeHtml(stockLabel)}</span>
          <span class="bf-status-pill ${status === "Active" ? "bf-status-success" : "bf-status-pending"}">${status}</span>
        </div>

        <div style="display:flex; gap:8px; margin-top:6px;">
          <button
            type="button"
            class="bf-btn bf-btn-ghost bf-btn-sm edit-product-btn"
            data-id="${escapeHtml(product.id)}"
            style="flex:1;">
            ✏️ Edit
          </button>

          <button
            type="button"
            class="bf-btn bf-btn-ghost bf-btn-sm delete-product-btn"
            data-id="${escapeHtml(product.id)}"
            data-name="${escapeHtml(product.productName || "this product")}"
            style="flex:1; color:#c62828;">
            🗑️ Delete
          </button>
        </div>

      </div>
    `;

  }).join("");

}

if (productSearch) {
  productSearch.addEventListener("input", renderProductList);
}

if (productStatusFilter) {
  productStatusFilter.addEventListener("change", renderProductList);
}


/* =========================
   EDIT / DELETE
========================= */

async function editProduct(id) {

  try {

    const productRef = doc(db, "products", id);
    const productSnap = await getDoc(productRef);

    if (!productSnap.exists()) {
      showToast("Product not found", "danger");
      return;
    }

    const product = productSnap.data();

    existingImages = product.images && product.images.length
      ? product.images
      : (product.image ? [product.image] : []);

    selectedFiles = [];
    imageFile.value = "";
    renderPreview();

    document.getElementById("productName").value = product.productName || "";
    document.getElementById("category").value = product.category || "";
    document.getElementById("mrp").value = product.mrp || "";
    document.getElementById("price").value = product.price || "";
    document.getElementById("stock").value = product.stock ?? 0;
    document.getElementById("description").value = product.description || "";
    document.getElementById("sizes").value = (product.sizes || []).join(", ");
    document.getElementById("colours").value = (product.colours || []).join(", ");

    colorVariants = (product.colorVariants || []).map(v => ({
      name: v.name,
      files: [],
      existingImages: Array.isArray(v.images) && v.images.length ? v.images : [v.image].filter(Boolean)
    }));
    renderColorVariantRows();
    document.getElementById("status").value = product.status === "Inactive" ? "Inactive" : "Active";

    const STANDARD_RETURN = ["7 Days Return", "No Return"];
    const returnVal = product.returnPolicy || "7 Days Return";
    if (STANDARD_RETURN.includes(returnVal)) {
      returnPolicySelect.value = returnVal;
      returnPolicyCustom.style.display = "none";
      returnPolicyCustom.value = "";
    } else {
      returnPolicySelect.value = "Custom";
      returnPolicyCustom.value = returnVal;
      returnPolicyCustom.style.display = "block";
    }

    const STANDARD_WARRANTY = ["6 Month Warranty", "No Warranty"];
    const warrantyVal = product.warranty || "6 Month Warranty";
    if (STANDARD_WARRANTY.includes(warrantyVal)) {
      warrantySelect.value = warrantyVal;
      warrantyCustom.style.display = "none";
      warrantyCustom.value = "";
    } else {
      warrantySelect.value = "Custom";
      warrantyCustom.value = warrantyVal;
      warrantyCustom.style.display = "block";
    }

    editMode = true;
    editProductId = id;

    productFormTitle.textContent = "Edit Product";
    productFormSubmitBtn.textContent = "Update Product";

    openModal("productFormModal");

  } catch (error) {

    console.error("Edit product error:", error);
    showToast(error.message || "Failed to load product.", "danger");

  }

}

async function deleteProduct(id, name) {

  const ok = window.confirm(`Delete "${name}"? This cannot be undone.`);
  if (!ok) return;

  try {

    await deleteDoc(doc(db, "products", id));

    await logAdminAction("Deleted product", "Products", { productId: id, name });

    allProducts = allProducts.filter(p => p.id !== id);
    renderProductList();

    showToast("Product deleted", "success");

  } catch (error) {

    console.error("Delete product error:", error);
    showToast(error.message || "Failed to delete product.", "danger");

  }

}

if (productsList) {
  productsList.addEventListener("click", (e) => {

    const editBtn = e.target.closest(".edit-product-btn");
    if (editBtn) {
      editProduct(editBtn.dataset.id);
      return;
    }

    const deleteBtn = e.target.closest(".delete-product-btn");
    if (deleteBtn) {
      deleteProduct(deleteBtn.dataset.id, deleteBtn.dataset.name);
    }

  });
}


/* =========================
   APP INIT (ADMIN CHECK)
========================= */

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {

    const userDoc = await getDoc(doc(db, "users", user.uid));

    if (!userDoc.exists() || userDoc.data().isAdmin !== true) {
      alert("Access Denied ❌");
      window.location.href = "home.html";
      return;
    }

  } catch (error) {
    console.error("Admin check error:", error);
    window.location.href = "home.html";
    return;
  }

  loadProducts();

});
