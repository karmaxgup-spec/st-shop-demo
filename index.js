import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const MODULE = "corner_market_demo";
const STORE = "Corner Market Demo";
const TEST_CARD = "4242424242424242";

const DEFAULTS = {
    address: { name: "", line1: "", city: "", zip: "", country: "" },
    template: "I bought this for you 💝 {items}",   // {items} and {total} are replaced
    autoSend: true,                                  // send to the character as soon as the order is placed
    showPhotos: true,                                // free Openverse photos for search results
};

const DELIVERY = [
    { name: "Standard (3–5 days)", fee: 0 },
    { name: "Express (1–2 days)", fee: 5.99 },
    { name: "Same day", fee: 9.99 },
];

const DEMO_CATALOG = [
    { id: "d1", title: "Burgundy silk scarf", price: 24.99, emoji: "🧣", category: "fashion", tags: ["gift", "accessory"], blurb: "Lightweight silk, 70×70 cm.", variants: ["Burgundy", "Navy", "Cream"] },
    { id: "d2", title: "Lavender soy candle", price: 18.5, emoji: "🕯️", category: "home", tags: ["gift", "cozy"], blurb: "Hand-poured, about 40 hours of burn time." },
    { id: "d3", title: "Fleece hoodie", price: 39.0, emoji: "🧥", category: "fashion", tags: ["clothes", "cozy"], blurb: "Heavyweight cotton fleece.", variants: ["S", "M", "L", "XL"] },
    { id: "d4", title: "Vanilla body lotion", price: 12.75, emoji: "🧴", category: "beauty", tags: ["skincare", "gift"], blurb: "Fragrance-light, 500 ml." },
    { id: "d5", title: "Dark chocolate truffles", price: 14.99, emoji: "🍫", category: "food", tags: ["sweet", "gift"], blurb: "Box of 16, 70% cacao." },
    { id: "d6", title: "Peony bouquet", price: 44.0, emoji: "💐", category: "flowers", tags: ["flowers", "gift"], blurb: "Seasonal peonies." },
    { id: "d7", title: "Wireless earbuds", price: 59.99, emoji: "🎧", category: "electronics", tags: ["audio", "tech"], blurb: "Noise cancelling, 24h total battery." },
    { id: "d8", title: "Ceramic mug", price: 16.0, emoji: "☕", category: "home", tags: ["kitchen", "gift"], blurb: "350 ml, dishwasher safe.", variants: ["Sage", "Terracotta"] },
    { id: "d9", title: "Romance paperback", price: 9.49, emoji: "📖", category: "books", tags: ["book", "reading"], blurb: "Paperback." },
    { id: "d10", title: "Hair clip set", price: 11.25, emoji: "🎀", category: "accessories", tags: ["hair", "gift"], blurb: "Set of 3." },
    { id: "d11", title: "Running shoes", price: 79.0, emoji: "👟", category: "fashion", tags: ["shoes", "sport"], blurb: "Lightweight daily trainers.", variants: ["7", "8", "9", "10"] },
    { id: "d12", title: "Plush bunny", price: 22.0, emoji: "🐰", category: "toys", tags: ["plush", "gift", "cute"], blurb: "Soft, 30 cm." },
    { id: "d13", title: "Instant camera", price: 89.0, emoji: "📷", category: "electronics", tags: ["camera", "photo"], blurb: "Prints in about a minute." },
    { id: "d14", title: "Succulent planter", price: 13.5, emoji: "🪴", category: "home", tags: ["plant", "gift"], blurb: "Ceramic pot with drainage." },
    { id: "d15", title: "Silver charm bracelet", price: 34.0, emoji: "📿", category: "jewelry", tags: ["jewelry", "gift"], blurb: "Sterling silver, adjustable." },
    { id: "d16", title: "Ticket to Ride", price: 44.99, emoji: "🎲", category: "games", tags: ["game", "board"], blurb: "Family strategy board game." },
];

const ui = {
    view: "search",
    query: "",
    current: null,
    variant: "",
    qty: 1,
    cart: [],
    checkout: null,   // { address, delivery, last4 } kept in memory only, never saved
    order: null,
    message: "",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `$${Number(n).toFixed(2)}`;

function settings() {
    const s = (extension_settings[MODULE] ??= structuredClone(DEFAULTS));
    for (const k of Object.keys(DEFAULTS)) if (s[k] === undefined) s[k] = structuredClone(DEFAULTS[k]);
    s.address = { ...DEFAULTS.address, ...(s.address || {}) };
    return s;
}

function deliveryFee(name) {
    return DELIVERY.find((d) => d.name === name)?.fee ?? 0;
}

function subtotal() {
    return ui.cart.reduce((sum, l) => sum + l.price * l.qty, 0);
}

// ---------- catalog and photos ----------

function searchProducts(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return DEMO_CATALOG.filter((p) => {
        const hay = `${p.title} ${p.category} ${p.tags.join(" ")}`.toLowerCase();
        return words.every((w) => hay.includes(w));
    });
}

// Free, openly licensed photos from Openverse's official API. Safe search (mature=false) is always on.
const photoCache = new Map();
function photoFor(title) {
    if (!photoCache.has(title)) {
        const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(title)}&page_size=1&mature=false`;
        const p = fetch(url, { referrerPolicy: "no-referrer" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => j?.results?.[0]?.thumbnail || null)
            .catch(() => null);
        photoCache.set(title, p);
    }
    return photoCache.get(title);
}

// Fills every [data-photo] placeholder inside an element. Falls back to the emoji if no photo loads.
function loadPhotos(root) {
    if (!settings().showPhotos) return;
    root.querySelectorAll("[data-photo]").forEach(async (el) => {
        const src = await photoFor(el.dataset.photo);
        if (!src || !el.isConnected) return;
        const img = new Image();
        img.referrerPolicy = "no-referrer";
        img.loading = "lazy";
        img.alt = el.dataset.photo;
        img.onload = () => { el.innerHTML = ""; el.appendChild(img); };
        img.src = src;
    });
}

// ---------- cart / order ----------

function addToCart(product, variant, qty) {
    const key = `${product.id}|${variant}`;
    const line = ui.cart.find((l) => l.key === key);
    if (line) line.qty += qty;
    else ui.cart.push({ key, id: product.id, title: product.title, price: product.price, emoji: product.emoji, variant, qty });
}

function buildMessage(lines, total) {
    const items = lines
        .map((l) => `${l.title}${l.variant ? ` (${l.variant})` : ""} ×${l.qty}`)
        .join(", ");
    return settings().template.replaceAll("{items}", items).replaceAll("{total}", money(total));
}

function placeOrder() {
    const s = settings();
    const total = subtotal() + deliveryFee(ui.checkout.delivery);
    ui.order = { id: "ORD-" + Math.random().toString(36).slice(2, 8).toUpperCase(), total };
    ui.message = buildMessage(ui.cart, total);
    ui.cart = [];
    ui.checkout.last4 = "";   // drop the test card reference once the order is placed
    if (s.autoSend && sendToCharacter(ui.message)) {
        ui.view = "search";
        closeModal();
        window.toastr?.success?.("Order placed and sent to chat");
        return;
    }
    ui.view = "done";
    render();
}

function sendToCharacter(text) {
    const ta = document.querySelector("#send_textarea");
    const btn = document.querySelector("#send_but");
    if (!ta || !btn) {
        window.toastr?.warning?.("Chat input not found. Copy the message manually.");
        return false;
    }
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    btn.click();
    return true;
}

// ---------- modal ----------

function ensureModal() {
    if (document.getElementById("cm_modal")) return;
    const el = document.createElement("div");
    el.id = "cm_modal";
    el.innerHTML = `
        <div class="cm-card">
            <div class="cm-head">
                <span class="cm-brand">${esc(STORE)}</span>
                <span class="cm-spacer"></span>
                <button class="cm-cartbtn" title="Cart">🛒 <span class="cm-count"></span></button>
                <button class="cm-close" title="Close">✕</button>
            </div>
            <div class="cm-banner">Demo store. No real products are sold and no payment is taken.</div>
            <div class="cm-body"></div>
        </div>`;
    document.body.appendChild(el);
    el.querySelector(".cm-close").onclick = closeModal;
    el.querySelector(".cm-cartbtn").onclick = () => { ui.view = "cart"; render(); };
    el.addEventListener("click", (e) => { if (e.target === el) closeModal(); });
}

function openModal() {
    ensureModal();
    document.getElementById("cm_modal").classList.add("open");
    render();
}

function closeModal() {
    document.getElementById("cm_modal")?.classList.remove("open");
}

function bind(body, map) {
    body.onclick = (e) => {
        const el = e.target.closest("[data-act]");
        if (!el || !body.contains(el)) return;
        map[el.dataset.act]?.(el);
    };
}

function render() {
    const body = document.querySelector("#cm_modal .cm-body");
    if (!body) return;
    const count = ui.cart.reduce((n, l) => n + l.qty, 0);
    document.querySelector("#cm_modal .cm-count").textContent = count || "";
    const views = { search: viewSearch, product: viewProduct, cart: viewCart, checkout: viewCheckout, review: viewReview, done: viewDone };
    views[ui.view](body);
}

// ---------- views ----------

function viewSearch(body) {
    body.innerHTML = `
        <form class="cm-search">
            <input name="q" placeholder="Search the store…" value="${esc(ui.query)}">
            <button class="cm-primary" type="submit">Search</button>
        </form>
        <div class="cm-grid"></div>`;
    body.querySelector("form").onsubmit = (e) => {
        e.preventDefault();
        ui.query = e.target.q.value.trim();
        render();
    };
    const grid = body.querySelector(".cm-grid");
    const items = searchProducts(ui.query);
    grid.innerHTML = items.length
        ? items.map((p) => `
            <button class="cm-tile" data-id="${esc(p.id)}">
                <div class="cm-photo" data-photo="${esc(p.title)}"><span class="cm-emoji">${esc(p.emoji)}</span></div>
                <div class="cm-title">${esc(p.title)}</div>
                <div class="cm-price">${money(p.price)}</div>
            </button>`).join("")
        : `<div class="cm-muted">Nothing found. Try "gift", "home" or "shoes".</div>`;
    grid.querySelectorAll("[data-id]").forEach((b) => {
        b.onclick = () => {
            ui.current = items.find((p) => p.id === b.dataset.id);
            ui.variant = ui.current.variants?.[0] ?? "";
            ui.qty = 1;
            ui.view = "product";
            render();
        };
    });
    loadPhotos(grid);
}

function viewProduct(body) {
    const p = ui.current;
    const variants = p.variants?.length
        ? `<label>Option <select name="variant">${p.variants.map((v) => `<option ${v === ui.variant ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`
        : "";
    body.innerHTML = `
        <button class="cm-link" data-act="back">← Back to results</button>
        <div class="cm-product">
            <div class="cm-photo big" data-photo="${esc(p.title)}"><span class="cm-emoji big">${esc(p.emoji)}</span></div>
            <div class="cm-info">
                <h3>${esc(p.title)}</h3>
                <div class="cm-price">${money(p.price)}</div>
                <div class="cm-muted">${esc(p.blurb)}</div>
                ${variants}
                <label>Quantity <input type="number" name="qty" min="1" max="10" value="${ui.qty}"></label>
                <button class="cm-primary" data-act="add">Add to cart</button>
            </div>
        </div>`;
    bind(body, {
        back: () => { ui.view = "search"; render(); },
        add: () => {
            const variant = body.querySelector('[name="variant"]')?.value ?? "";
            const qty = Math.max(1, Math.min(10, parseInt(body.querySelector('[name="qty"]').value, 10) || 1));
            addToCart(p, variant, qty);
            ui.view = "cart";
            render();
        },
    });
    loadPhotos(body);
}

function viewCart(body) {
    if (!ui.cart.length) {
        body.innerHTML = `<p class="cm-muted">Your cart is empty.</p><button class="cm-link" data-act="shop">← Keep shopping</button>`;
        bind(body, { shop: () => { ui.view = "search"; render(); } });
        return;
    }
    body.innerHTML = `
        <button class="cm-link" data-act="shop">← Keep shopping</button>
        ${ui.cart.map((l, i) => `
            <div class="cm-line">
                <span class="cm-emoji sm">${esc(l.emoji)}</span>
                <div class="cm-grow">
                    <div>${esc(l.title)}</div>
                    <div class="cm-muted">${esc(l.variant)} · ${money(l.price)}</div>
                </div>
                <button data-act="dec" data-i="${i}">−</button>
                <span>${l.qty}</span>
                <button data-act="inc" data-i="${i}">+</button>
                <button data-act="rm" data-i="${i}">✕</button>
            </div>`).join("")}
        <div class="cm-total">Subtotal <b>${money(subtotal())}</b></div>
        <button class="cm-primary" data-act="checkout">Checkout</button>`;
    bind(body, {
        shop: () => { ui.view = "search"; render(); },
        inc: (el) => { ui.cart[el.dataset.i].qty = Math.min(10, ui.cart[el.dataset.i].qty + 1); render(); },
        dec: (el) => { const l = ui.cart[el.dataset.i]; if (l.qty > 1) l.qty--; render(); },
        rm: (el) => { ui.cart.splice(el.dataset.i, 1); render(); },
        checkout: () => { ui.view = "checkout"; render(); },
    });
}

function viewCheckout(body) {
    const s = settings();
    const a = ui.checkout?.address ?? s.address;
    const d = ui.checkout?.delivery ?? DELIVERY[0].name;
    body.innerHTML = `
        <button class="cm-link" data-act="cart">← Cart</button>
        <form class="cm-form">
            <h4>Shipping address</h4>
            <input name="name" placeholder="Full name" value="${esc(a.name)}" required>
            <input name="line1" placeholder="Street address" value="${esc(a.line1)}" required>
            <div class="cm-row">
                <input name="city" placeholder="City" value="${esc(a.city)}">
                <input name="zip" placeholder="ZIP / postcode" value="${esc(a.zip)}" required>
            </div>
            <input name="country" placeholder="Country" value="${esc(a.country)}">
            <h4>Delivery</h4>
            ${DELIVERY.map((o) => `
                <label class="cm-radio">
                    <input type="radio" name="delivery" value="${esc(o.name)}" ${o.name === d ? "checked" : ""}>
                    ${esc(o.name)} <span class="cm-muted">${o.fee ? money(o.fee) : "free"}</span>
                </label>`).join("")}
            <h4>Payment (test mode)</h4>
            <div class="cm-note">Test mode: nothing is charged, and card details are never saved or sent anywhere. Use the test card 4242 4242 4242 4242.</div>
            <input name="card" placeholder="Card number" value="4242 4242 4242 4242" inputmode="numeric" required>
            <div class="cm-row">
                <input name="expiry" placeholder="MM/YY" value="12/30" required>
                <input name="cvc" placeholder="CVC" value="123" inputmode="numeric" required>
            </div>
            <button class="cm-primary" type="submit">Review order</button>
        </form>`;
    bind(body, { cart: () => { ui.view = "cart"; render(); } });
    body.querySelector("form").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        const digits = f.card.value.replace(/\D/g, "");
        if (digits !== TEST_CARD) {
            window.toastr?.warning?.("Only the test card 4242 4242 4242 4242 works in this demo.");
            return;
        }
        ui.checkout = {
            address: {
                name: f.name.value.trim(),
                line1: f.line1.value.trim(),
                city: f.city.value.trim(),
                zip: f.zip.value.trim(),
                country: f.country.value.trim(),
            },
            delivery: f.delivery.value,
            last4: digits.slice(-4),
        };
        ui.view = "review";
        render();
    };
}

function viewReview(body) {
    const c = ui.checkout;
    const fee = deliveryFee(c.delivery);
    const total = subtotal() + fee;
    const addr = [c.address.name, c.address.line1, c.address.city, c.address.zip, c.address.country].filter(Boolean).join(", ");
    body.innerHTML = `
        <button class="cm-link" data-act="checkout">← Edit checkout</button>
        <div class="cm-summary">
            ${ui.cart.map((l) => `<div>${esc(l.emoji)} ${esc(l.title)}${l.variant ? ` (${esc(l.variant)})` : ""} ×${l.qty}: ${money(l.price * l.qty)}</div>`).join("")}
            <div>Delivery: ${esc(c.delivery)}, ${fee ? money(fee) : "free"}</div>
            <div>Ship to: ${esc(addr)}</div>
            <div>Pay with: test card ending ${esc(c.last4)}</div>
            <div class="cm-total">Total <b>${money(total)}</b></div>
        </div>
        <button class="cm-primary" data-act="place">Place your order</button>`;
    bind(body, {
        checkout: () => { ui.view = "checkout"; render(); },
        place: () => placeOrder(),
    });
}

function viewDone(body) {
    body.innerHTML = `
        <div class="cm-done">
            <div class="cm-emoji big">🎁</div>
            <h3>Order placed</h3>
            <div class="cm-muted">${esc(ui.order.id)} · ${money(ui.order.total)}</div>
            <div class="cm-label">Message for your character</div>
            <div class="cm-msg">${esc(ui.message)}</div>
            <button class="cm-primary" data-act="send">Send to chat</button>
            <button class="cm-link" data-act="shop">Keep shopping</button>
        </div>`;
    bind(body, {
        send: () => {
            if (sendToCharacter(ui.message)) {
                ui.view = "search";
                closeModal();
            }
        },
        shop: () => { ui.view = "search"; render(); },
    });
}

// ---------- settings panel ----------

function buildSettings() {
    const host = document.getElementById("extensions_settings2") ?? document.getElementById("extensions_settings");
    if (!host || document.getElementById("cm_settings")) return;
    const wrap = document.createElement("div");
    wrap.id = "cm_settings";
    wrap.className = "inline-drawer";
    wrap.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>${esc(STORE)}</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
        </div>
        <div class="inline-drawer-content cm-settings">
            <h4>Shipping address</h4>
            <input data-a="name" placeholder="Full name">
            <input data-a="line1" placeholder="Street address">
            <div class="cm-row">
                <input data-a="city" placeholder="City">
                <input data-a="zip" placeholder="ZIP / postcode">
            </div>
            <input data-a="country" placeholder="Country">
            <label>Message template ({items} and {total} are replaced)
                <textarea data-k="template" rows="2"></textarea>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" data-k="autoSend"> Send message to the character automatically after ordering
            </label>
            <label class="checkbox_label">
                <input type="checkbox" data-k="showPhotos"> Show free Openverse photos in search results
            </label>
            <button class="menu_button" data-act="open">Open store</button>
        </div>`;
    host.appendChild(wrap);

    const s = settings();
    const fill = () => {
        wrap.querySelectorAll("[data-k]").forEach((el) => {
            if (el.type === "checkbox") el.checked = !!s[el.dataset.k];
            else el.value = s[el.dataset.k] ?? "";
        });
        wrap.querySelectorAll("[data-a]").forEach((el) => { el.value = s.address[el.dataset.a] ?? ""; });
    };
    fill();

    wrap.addEventListener("change", (e) => {
        const el = e.target;
        if (el.dataset.k) s[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
        if (el.dataset.a) s.address[el.dataset.a] = el.value;
        saveSettingsDebounced();
    });
    wrap.querySelector('[data-act="open"]').onclick = openModal;
}

jQuery(async () => {
    settings();
    buildSettings();

    const btn = document.createElement("div");
    btn.id = "cm_button";
    btn.className = "list-group-item flex-container flexGap5 interactable";
    btn.tabIndex = 0;
    btn.innerHTML = `<div class="fa-solid fa-store extensionsMenuExtensionButton"></div>${esc(STORE)}`;
    btn.onclick = openModal;
    document.getElementById("extensionsMenu")?.appendChild(btn);
});
