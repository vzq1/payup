const STORAGE_KEY = "bill-split-v1";
const THEME_KEY = "bill-split-theme";
const PAYEE = "Bon";
const GCASH_LINK = "https://vzq1.github.io/payup/gcash/";
const GCASH = {
  name: "ME****O TH****S J** B.",
  mobile: "0976 041 ••••",
  userId: "•••••••••••Y94CTA",
  qr: "gcash-qr.svg",
};
const THEME_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/></svg>';

// Launch screen: stays at least 0.9 s from launch and until every hold is released (8 s at most)
const splash = (() => {
  const node = document.getElementById("splash");
  const MIN_MS = 900, MAX_MS = 8000;
  let holds = 0;
  let finished = !node;
  function finish() {
    if (finished) return;
    finished = true;
    setTimeout(() => {
      node.classList.add("done");
      setTimeout(() => node.remove(), 400);
    }, Math.max(0, MIN_MS - performance.now()));
  }
  setTimeout(finish, MAX_MS);
  return {
    hold() { holds++; },
    release() { holds = Math.max(0, holds - 1); if (holds === 0) finish(); },
  };
})();
splash.hold();

const GROUPS_KEY = "payup-groups";

// Who paid the bill. null means the app's owner (Bon), whose GCash QR is in the app.
const isOwnerName = (name) => name.trim().toLowerCase() === PAYEE.toLowerCase();
function payer() {
  const p = state.paidBy && state.people.find((x) => x.id === state.paidBy);
  return p && !isOwnerName(p.name) ? p : null;
}
const ownerPaid = () => !payer();
const payeeName = () => (payer() ? payer().name : PAYEE);
function isPayerId(id) {
  const p = payer();
  if (p) return p.id === id;
  const person = state.people.find((x) => x.id === id);
  return !!person && isOwnerName(person.name);
}

// GCash QRs of friends who paid, remembered on this phone by name.
const QRS_KEY = "payup-qrs";
function loadSavedQrs() {
  try {
    const saved = JSON.parse(localStorage.getItem(QRS_KEY));
    return saved && typeof saved === "object" ? saved : {};
  } catch (e) {
    return {};
  }
}
function rememberQr(name, payload) {
  const saved = loadSavedQrs();
  if (payload) saved[name.toLowerCase()] = payload;
  else delete saved[name.toLowerCase()];
  try {
    localStorage.setItem(QRS_KEY, JSON.stringify(saved));
  } catch (e) {}
}
function payerQr() {
  const p = payer();
  if (!p) return null;
  return parsePayQr(p.qr || loadSavedQrs()[p.name.toLowerCase()]);
}

function loadGroups() {
  try {
    const groups = JSON.parse(localStorage.getItem(GROUPS_KEY));
    return Array.isArray(groups) ? groups : [];
  } catch (e) {
    return [];
  }
}
function saveGroups(groups) {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  } catch (e) {}
}

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function defaultState() {
  return { receiptTotal: "", people: [], items: [], paidBy: null };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.people) && Array.isArray(saved.items)) {
      return { receiptTotal: saved.receiptTotal || "", people: saved.people, items: saved.items, billId: saved.billId, paidBy: saved.paidBy || null };
    }
  } catch (e) {}
  if (window.PAYUP_SAMPLE) return { ...JSON.parse(JSON.stringify(window.PAYUP_SAMPLE)), sample: true };
  return defaultState();
}

let state = loadState();

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}
}

function persist() {
  delete state.sample;
  if (cloud.enabled && !state.billId && (state.people.length || state.items.length)) state.billId = uuid();
  saveLocal();
  cloud.queueSave(state);
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function pct(rate) {
  return `${round2(rate * 100)}%`;
}

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child != null) node.append(child);
  }
  return node;
}

// Slide a row left to reveal Remove; slide all the way to remove it straight away.
let openSwipe = null;
document.addEventListener("pointerdown", (e) => {
  if (openSwipe && !openSwipe.li.contains(e.target)) openSwipe.close();
}, true);

function swipeToRemove(li, onRemove) {
  const ACTION = 88;
  const inner = el("div", { class: "swipe-inner" });
  while (li.firstChild) inner.append(li.firstChild);
  const action = el("button", { type: "button", class: "swipe-action", text: "Remove", tabindex: "-1", "aria-hidden": "true" });
  li.classList.add("swipe");
  li.append(action, inner);

  let startX = 0, startY = 0, offset = 0, base = 0, tracking = false, horizontal = null, swiped = false, settle = 0;
  const move = (x, animate) => {
    offset = x;
    clearTimeout(settle);
    if (x) li.classList.add("moving");
    else if (animate) settle = setTimeout(() => li.classList.remove("moving"), 240);
    else li.classList.remove("moving");
    inner.style.transition = animate ? "transform 220ms var(--ease-out)" : "none";
    inner.style.transform = x ? `translateX(${x}px)` : "";
  };
  const api = { li, close: () => { move(0, true); if (openSwipe === api) openSwipe = null; } };
  const remove = () => {
    if (openSwipe === api) openSwipe = null;
    onRemove();
    move(0, false);
  };

  li.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (action.contains(e.target)) return;
    startX = e.clientX; startY = e.clientY;
    base = offset; tracking = true; horizontal = null; swiped = false;
  });
  li.addEventListener("pointermove", (e) => {
    if (!tracking) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (horizontal === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      horizontal = Math.abs(dx) > Math.abs(dy);
      if (!horizontal) { tracking = false; return; }
      li.classList.add("dragged");
      li.setPointerCapture(e.pointerId);
      swiped = true;
      // sliding right on a closed row does nothing
      if (dx > 0 && base === 0) { tracking = false; return; }
      if (openSwipe && openSwipe !== api) openSwipe.close();
    }
    move(Math.min(0, base + dx), false);
  });
  const end = () => {
    li.classList.remove("dragged");
    if (!tracking || !horizontal) { tracking = false; return; }
    tracking = false;
    swiped = true;
    const width = li.offsetWidth;
    if (offset < -width * 0.55) {
      move(-width, true);
      setTimeout(remove, 200);
    } else if (offset < -ACTION / 2) {
      move(-ACTION, true);
      openSwipe = api;
    } else {
      api.close();
    }
  };
  li.addEventListener("pointerup", end);
  li.addEventListener("pointercancel", end);
  // a swipe, or a tap on a row that's slid open, shouldn't also open the row
  li.addEventListener("click", (e) => {
    if (action.contains(e.target)) return;
    if (swiped || offset !== 0) {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (!swiped) api.close();
    }
    swiped = false;
  }, true);
  action.addEventListener("click", (e) => {
    e.stopPropagation();
    remove();
  });
  return li;
}

function deleteItem(id) {
  const item = state.items.find((i) => i.id === id);
  state.items = state.items.filter((i) => i.id !== id);
  persist();
  renderMain();
  if (item) toast(`Removed ${item.name.trim() || "the item"}`);
}

function onActivate(node, fn) {
  node.addEventListener("click", fn);
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  });
}

function joinNames(names) {
  if (names.length >= 3 && names.length === state.people.length) return "Everyone";
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function eatersOf(item) {
  return state.people.filter((p) => item.people.includes(p.id));
}

function splitNote(item) {
  const eaters = eatersOf(item);
  const price = toNumber(item.price);
  if (eaters.length === 0) return { text: "Choose who had this", warn: true };
  if (eaters.length === 1) return null;
  if (!item.custom) return { text: `${peso.format(price / eaters.length)} each`, warn: false };
  const assigned = eaters.reduce((sum, p) => sum + toNumber(item.shares[p.id]), 0);
  const left = round2(price - assigned);
  if (left > 0) return { text: `${peso.format(left)} left to assign`, warn: true };
  if (left < 0) return { text: `${peso.format(-left)} over the price`, warn: true };
  return { text: "Custom split", warn: false };
}

function line(label, value, cls = "") {
  return el("div", { class: `line ${cls}`.trim() }, [
    el("span", { text: label }),
    el("span", { class: "num", text: peso.format(value) }),
  ]);
}

function field(label, control, extra = null) {
  return el("div", { class: "field" }, [
    el("div", { class: "field-head" }, [el("span", { class: "label", text: label }), extra]),
    control,
  ]);
}

/* ---------- Main screen ---------- */

function renderMain() {
  const result = computeSplit(state);
  renderSummary(result);
  renderPeople(result);
  renderItems(result);
}

function renderSummary(result) {
  $("#food-total").textContent = peso.format(result.itemsTotal);
  $("#service-total").textContent = result.hasReceipt ? peso.format(result.extra) : "—";
  $("#rate").textContent = result.hasReceipt ? `${result.rate >= 0 ? "+" : "−"}${pct(Math.abs(result.rate))}` : "";

  let hint = "";
  if (state.sample) hint = "Sample bill. Tap Clear all to start your own.";
  else if (state.people.length === 0 && state.items.length === 0) hint = "Add people and items below, then the receipt total.";
  else if (!result.hasReceipt && result.itemsTotal > 0) hint = "Add the receipt total to share out the service charge.";
  $("#summary-hint").textContent = hint;
}

const addPersonRow = (() => {
  const input = el("input", {
    class: "add-input", type: "text", placeholder: "Add person", maxlength: "30",
    enterkeyhint: "done", autocomplete: "off", autocapitalize: "words", "aria-label": "Add person",
  });
  const button = el("button", { type: "button", class: "add-btn", text: "Add" });
  button.hidden = true;
  const submit = () => {
    if (addPerson(input.value)) {
      input.value = "";
      button.hidden = true;
      // re-focus so the phone keyboard starts the next name with a capital letter again
      input.blur();
      input.focus();
    }
  };
  input.addEventListener("input", () => (button.hidden = !input.value.trim()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
  button.addEventListener("click", submit);
  return el("li", { class: "row add-row" }, [el("span", { class: "plus", text: "+" }), input, button]);
})();

function renderPeople(result) {
  $("#people-count").textContent = state.people.length || "";

  $("#paid-by-name").textContent = ownerPaid() ? `${PAYEE} (you)` : payer().name;

  const rows = result.rows.map((r) => {
    let sub = "No items yet";
    if (r.food > 0) sub = result.hasReceipt ? `Food ${peso.format(r.food)} · Service ${peso.format(r.extra)}` : `Food ${peso.format(r.food)}`;
    if (isPayerId(r.id)) sub = `Paid the bill · ${sub}`;
    const li = el("li", { class: "row", role: "button", tabindex: "0" }, [
      el("div", { class: "row-main" }, [
        el("span", { class: "row-title", text: r.name }),
        el("span", { class: "row-sub", text: sub }),
      ]),
      el("span", { class: "row-amount num", text: peso.format(r.total) }),
    ]);
    onActivate(li, () => openPersonSheet(r.id));
    swipeToRemove(li, () => removePerson(r.id));
    return li;
  });

  const list = $("#people");
  for (const child of [...list.children]) if (child !== addPersonRow) child.remove();
  if (!addPersonRow.isConnected) list.append(addPersonRow);
  for (const row of rows) list.insertBefore(row, addPersonRow);
}

function renderItems(result) {
  $("#items-count").textContent = state.items.length || "";

  const rows = state.items.map((item) => {
    const names = eatersOf(item).map((p) => p.name);
    const note = splitNote(item);
    let sub = names.length ? joinNames(names) : "";
    if (note) sub = sub ? `${sub} · ${note.text}` : note.text;
    const name = item.name.trim();
    const li = el("li", { class: "row", role: "button", tabindex: "0" }, [
      el("div", { class: "row-main" }, [
        el("span", { class: name ? "row-title" : "row-title placeholder", text: name || "Item" }),
        el("span", { class: note && note.warn ? "row-sub err" : "row-sub", text: sub }),
      ]),
      el("span", { class: "row-amount light num", text: peso.format(toNumber(item.price)) }),
    ]);
    onActivate(li, () => openItemSheet(item.id));
    swipeToRemove(li, () => deleteItem(item.id));
    return li;
  });

  const add = el("li", { class: "row add-row", role: "button", tabindex: "0" }, [
    el("span", { class: "plus", text: "+" }),
    el("span", { class: "add-label", text: "Add item" }),
  ]);
  onActivate(add, () => openItemSheet(null));
  $("#items").replaceChildren(...rows, add);

  const note = $("#items-note");
  let text = "Enter menu prices as printed.";
  if (result.unassigned > 0) text = `${peso.format(result.unassigned)} of the items isn't assigned to anyone yet.`;
  else if (result.unassigned < 0) text = `People's shares add up to ${peso.format(-result.unassigned)} more than the item prices.`;
  note.textContent = text;
  note.classList.toggle("err", result.unassigned !== 0);
}

// "josh" -> "Josh", "ana marie" -> "Ana Marie"; the rest of each word stays as typed
function nameCase(name) {
  return name.trim().replace(/\s+/g, " ").replace(/(^|\s)(\S)/g, (m, space, ch) => space + ch.toLocaleUpperCase());
}

function addPerson(name) {
  const clean = nameCase(name);
  if (!clean) return false;
  if (state.people.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    toast(`${clean} is already on the list`);
    return false;
  }
  state.people.push({ id: newId(), name: clean });
  persist();
  renderMain();
  return true;
}

function removePerson(id) {
  const person = state.people.find((p) => p.id === id);
  const used = state.items.some((i) => i.people.includes(id));
  const remove = () => {
    if (state.paidBy === id) state.paidBy = null;
    state.people = state.people.filter((p) => p.id !== id);
    for (const item of state.items) {
      item.people = item.people.filter((pid) => pid !== id);
      delete item.shares[id];
    }
    persist();
    renderMain();
    closeSheet();
  };
  if (!used) {
    remove();
    return;
  }
  confirmAction({
    title: `Remove ${person.name}?`,
    message: `${person.name}'s items will need to be assigned to someone else.`,
    confirmLabel: `Remove ${person.name}`,
    onConfirm: remove,
  });
}

/* ---------- Bottom sheet ---------- */

const sheet = $("#sheet");
const scrim = $("#scrim");
let sheetTimer;

function setBarButton(button, config) {
  button.style.visibility = config ? "" : "hidden";
  button.disabled = !config;
  if (!config) return;
  button.textContent = config.label;
  button.onclick = config.onClick;
}

function openSheet({ title, left, right, body }) {
  clearTimeout(sheetTimer);
  $("#sheet-title").textContent = title;
  setBarButton($("#sheet-cancel"), left);
  setBarButton($("#sheet-done"), right);
  $("#sheet-body").replaceChildren(...body.filter(Boolean));
  sheet.scrollTop = 0;
  if (!sheet.classList.contains("open")) {
    sheet.hidden = false;
    scrim.hidden = false;
    document.body.classList.add("sheet-open");
    void sheet.offsetHeight;
    sheet.classList.add("open");
    scrim.classList.add("open");
  }
}

function closeSheet() {
  if (sheet.hidden) return;
  if (sheet.contains(document.activeElement)) document.activeElement.blur();
  sheet.classList.remove("open");
  scrim.classList.remove("open");
  document.body.classList.remove("sheet-open");
  sheetTimer = setTimeout(() => {
    sheet.hidden = true;
    scrim.hidden = true;
    $("#sheet-body").replaceChildren();
  }, 300);
}

function confirmAction({ title, message, confirmLabel, onConfirm }) {
  openSheet({
    title,
    left: { label: "Cancel", onClick: closeSheet },
    right: null,
    body: [
      el("p", { class: "confirm-text", text: message }),
      el("button", { type: "button", class: "btn btn-alarm", text: confirmLabel, onclick: onConfirm }),
    ],
  });
}

scrim.addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
});

function openItemSheet(id) {
  const existing = state.items.find((i) => i.id === id);
  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: newId(), name: "", price: "", people: [], custom: false, shares: {} };

  const nameInput = el("input", {
    class: "line-input", type: "text", placeholder: "e.g. Pizza", maxlength: "40",
    enterkeyhint: "next", autocomplete: "off", "aria-label": "Item name",
  });
  nameInput.value = draft.name;
  nameInput.addEventListener("input", () => (draft.name = nameInput.value));
  nameInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    priceInput.focus();
  });

  const priceInput = el("input", {
    class: "num", type: "text", inputmode: "decimal", placeholder: "0.00",
    autocomplete: "off", "aria-label": "Price",
  });
  priceInput.value = draft.price;
  priceInput.addEventListener("input", () => {
    draft.price = priceInput.value;
    refreshNote();
  });

  const allButton = el("button", { type: "button", class: "text-btn" });
  const chips = el("div", { class: "chips" });
  const mode = el("div", { class: "mode" });
  const note = el("p", { class: "note" });

  function sortPeople(ids) {
    return state.people.map((p) => p.id).filter((pid) => ids.includes(pid));
  }

  function refreshNote() {
    const info = splitNote(draft);
    note.hidden = !info;
    if (!info) return;
    const n = draft.people.length;
    note.textContent = n > 1 && !draft.custom ? `Split ${n} ways · ${info.text}` : info.text;
    note.classList.toggle("err", info.warn);
  }

  function setCustom(custom) {
    if (custom && !draft.custom) {
      const amounts = evenShares(toNumber(draft.price), draft.people.length);
      draft.shares = Object.fromEntries(draft.people.map((pid, i) => [pid, String(amounts[i])]));
    }
    draft.custom = custom;
    renderParts();
  }

  function renderParts() {
    if (state.people.length === 0) {
      allButton.hidden = true;
      chips.replaceChildren(el("p", { class: "note", text: "Add people on the main screen first." }));
    } else {
      const everyone = state.people.every((p) => draft.people.includes(p.id));
      allButton.hidden = state.people.length < 2;
      allButton.textContent = everyone ? "Clear" : "All";
      allButton.onclick = () => {
        draft.people = everyone ? [] : state.people.map((p) => p.id);
        renderParts();
      };
      chips.replaceChildren(...state.people.map((p) => {
        const selected = draft.people.includes(p.id);
        return el("button", {
          type: "button", class: "chip", "aria-pressed": String(selected), text: p.name,
          onclick: () => {
            draft.people = selected ? draft.people.filter((pid) => pid !== p.id) : sortPeople([...draft.people, p.id]);
            renderParts();
          },
        });
      }));
    }

    if (draft.people.length < 2) {
      mode.replaceChildren();
    } else {
      const parts = [el("div", { class: "tabs", role: "group", "aria-label": "How to split" }, [
        el("button", { type: "button", class: "tab", "aria-pressed": String(!draft.custom), text: "Split evenly", onclick: () => setCustom(false) }),
        el("button", { type: "button", class: "tab", "aria-pressed": String(!!draft.custom), text: "Custom amounts", onclick: () => setCustom(true) }),
      ])];
      if (draft.custom) {
        for (const p of eatersOf(draft)) {
          const input = el("input", {
            class: "num", type: "text", inputmode: "decimal", placeholder: "0.00",
            autocomplete: "off", "aria-label": `${p.name}'s share`,
          });
          input.value = draft.shares[p.id] ?? "";
          input.addEventListener("input", () => {
            draft.shares[p.id] = input.value;
            refreshNote();
          });
          parts.push(el("label", { class: "share-row" }, [el("span", { text: p.name }), input]));
        }
      }
      mode.replaceChildren(...parts);
    }
    refreshNote();
  }

  renderParts();

  const done = () => {
    draft.name = draft.name.trim();
    const blank = !draft.name && !toNumber(draft.price) && draft.people.length === 0;
    if (!existing && blank) {
      closeSheet();
      return;
    }
    if (existing) Object.assign(existing, draft);
    else state.items.push(draft);
    persist();
    renderMain();
    closeSheet();
  };

  const remove = () => {
    state.items = state.items.filter((i) => i.id !== id);
    persist();
    renderMain();
    closeSheet();
  };

  openSheet({
    title: existing ? "Edit item" : "New item",
    left: { label: "Cancel", onClick: closeSheet },
    right: { label: existing ? "Done" : "Add", onClick: done },
    body: [
      field("Item", nameInput),
      field("Price", el("label", { class: "price" }, [el("span", { text: "₱" }), priceInput])),
      field("Who had this", el("div", { class: "field" }, [chips, mode, note]), allButton),
      existing ? el("button", { type: "button", class: "btn btn-danger", text: "Delete item", onclick: remove }) : null,
    ],
  });
}

function openPersonSheet(id) {
  const index = state.people.findIndex((p) => p.id === id);
  if (index < 0) {
    closeSheet();
    return;
  }
  const person = state.people[index];
  const result = computeSplit(state);
  const row = result.rows[index];

  const nameInput = el("input", { class: "line-input", type: "text", maxlength: "30", autocomplete: "off", autocapitalize: "words", "aria-label": "Name" });
  nameInput.value = person.name;

  const validIds = new Set(state.people.map((p) => p.id));
  const itemLines = [];
  for (const item of state.items) {
    const shares = itemShares(item, validIds);
    if (!shares.has(id)) continue;
    let label = item.name.trim() || "Item";
    if (shares.size > 1) label += item.custom ? " · custom" : ` · ÷ ${shares.size}`;
    itemLines.push(line(label, shares.get(id)));
  }
  if (itemLines.length === 0) itemLines.push(el("div", { class: "line" }, el("span", { text: "No items yet" })));

  const totals = [line("Food", row.food)];
  if (result.hasReceipt) totals.push(line("Service charge", row.extra));
  totals.push(line("Pays", row.total, "total"));

  const applyName = () => {
    const clean = nameCase(nameInput.value);
    if (!clean || clean === person.name) return true;
    if (state.people.some((p) => p.id !== id && p.name.toLowerCase() === clean.toLowerCase())) {
      toast(`${clean} is already on the list`);
      return false;
    }
    person.name = clean;
    if (person.qr) rememberQr(clean, person.qr);
    persist();
    renderMain();
    return true;
  };

  openSheet({
    title: person.name,
    left: { label: "Cancel", onClick: closeSheet },
    right: { label: "Done", onClick: () => applyName() && closeSheet() },
    body: [
      field("Name", nameInput),
      field("Items", el("div", { class: "lines" }, itemLines)),
      el("div", { class: "lines" }, totals),
      isPayerId(id) ? el("p", { class: "note", text: `${person.name} paid the bill, so ${person.name} doesn't pay anyone.` }) : null,
      isPayerId(id) ? null : el("button", { type: "button", class: "btn btn-solid", text: "Send GCash link", onclick: () => applyName() && sendGcashLink(id) }),
      isPayerId(id) || !(ownerPaid() || payerQr()) ? null : el("button", { type: "button", class: "btn btn-outline", text: "Show GCash QR", onclick: () => applyName() && openQrSheet(id) }),
      isPayerId(id) && !ownerPaid() ? el("button", { type: "button", class: "btn btn-outline", text: payerQr() ? "Show GCash QR" : "Add GCash QR", onclick: () => applyName() && openQrSheet(null, id) }) : null,
      el("button", { type: "button", class: "btn btn-danger", text: "Remove person", onclick: () => removePerson(id) }),
    ],
  });
}

function openQrSheet(personId = null, backId = personId) {
  const result = computeSplit(state);
  const index = state.people.findIndex((p) => p.id === personId);
  const row = index >= 0 ? result.rows[index] : null;
  const reopen = () => openQrSheet(personId, backId);
  const p = payer();
  const qr = payerQr();
  let body;
  if (!p) {
    body = [
      el("div", { class: "qr" }, [
        el("span", { class: "qr-label", text: "GCash · InstaPay" }),
        el("div", { class: "qr-box" }, el("img", { src: GCASH.qr, alt: `GCash QR code for ${GCASH.name}`, width: "300", height: "300" })),
        el("div", {}, [
          el("div", { class: "qr-name", text: GCASH.name }),
          el("div", { class: "qr-meta", text: `Mobile ${GCASH.mobile}` }),
          el("div", { class: "qr-meta", text: `User ID ${GCASH.userId}` }),
        ]),
      ]),
      el("p", { class: "note center", text: "Scan with GCash or any InstaPay app. Transfer fees may apply." }),
    ];
  } else if (qr) {
    body = [
      el("div", { class: "qr" }, [
        el("span", { class: "qr-label", text: qr.gcash ? `${p.name} · GCash` : `${p.name} · InstaPay` }),
        el("div", { class: "qr-box" }, el("img", { id: "payer-qr", src: qrSvgUrl(qr.payload), alt: `GCash QR code for ${p.name}`, width: "300", height: "300" })),
        el("div", {}, [
          qr.name ? el("div", { class: "qr-name", text: qr.name }) : null,
          qr.userId ? el("div", { class: "qr-meta", text: `User ID ${maskedId(qr.userId)}` }) : null,
        ]),
      ]),
      el("p", { class: "note center", text: "Scan with GCash or any InstaPay app. Transfer fees may apply." }),
      row ? null : el("button", { type: "button", class: "btn btn-outline", text: "Change QR", onclick: () => pickPayerQr(reopen) }),
      row ? null : el("button", { type: "button", class: "btn btn-danger", text: "Remove QR", onclick: () => {
        delete p.qr;
        rememberQr(p.name, null);
        persist();
        renderMain();
        reopen();
        toast(`Removed ${p.name}'s GCash QR`);
      } }),
    ];
  } else {
    loadQrReader().catch(() => {});
    body = [
      el("p", { class: "note", text: `${p.name} paid the bill. Add ${p.name}'s GCash QR so everyone can scan it.` }),
      el("button", { type: "button", class: "btn btn-solid", text: `Upload ${p.name}'s GCash QR`, onclick: () => pickPayerQr(reopen) }),
      el("p", { class: "note", text: `${QR_UPLOAD.label}. A screenshot of the QR works.` }),
    ];
  }
  openSheet({
    title: "GCash",
    left: backId ? { label: "Back", onClick: () => openPersonSheet(backId) } : null,
    right: { label: "Done", onClick: closeSheet },
    body: [
      row && !isPayerId(row.id) && (qr || !p) ? el("div", { class: "pay" }, [
        el("span", { class: "pay-who", text: `${row.name} pays` }),
        el("span", { class: "pay-big num", text: peso.format(row.total) }),
      ]) : null,
      ...body,
    ],
  });
}

let qrInput = null;
function pickPayerQr(done) {
  const p = payer();
  if (!p) return;
  if (!qrInput) {
    qrInput = el("input", { type: "file", accept: QR_UPLOAD.accept, hidden: "", "aria-hidden": "true", tabindex: "-1" });
    document.body.append(qrInput);
  }
  qrInput.value = "";
  qrInput.onchange = async () => {
    const file = qrInput.files && qrInput.files[0];
    if (!file) return;
    const problem = qrFileError(file);
    if (problem) {
      toast(problem);
      return;
    }
    toast("Reading the QR…");
    let qr;
    try {
      qr = await readQrPicture(file);
    } catch (e) {
      toast(e.message || "No QR found in that picture");
      return;
    }
    const person = state.people.find((x) => x.id === p.id);
    if (!person) return;
    person.qr = qr.payload;
    rememberQr(person.name, qr.payload);
    persist();
    renderMain();
    done();
    toast(`Saved ${person.name}'s GCash QR`);
  };
  qrInput.click();
}

/* ---------- Sharing and messages ---------- */

function summaryText() {
  const result = computeSplit(state);
  const lines = ["PayUp", ...result.rows.map((r) => `${r.name}: ${peso.format(r.total)}${isPayerId(r.id) ? " (paid the bill)" : ""}`), ""];
  lines.push(`Food: ${peso.format(result.itemsTotal)}`);
  if (result.hasReceipt) {
    lines.push(`${result.extra >= 0 ? "Service charge" : "Discount"}: ${peso.format(result.extra)}`);
  }
  lines.push(`Total: ${peso.format(result.billTotal)}`);
  lines.push("", `Pay ${payeeName()} on GCash: ${GCASH_LINK}`);
  return lines.join("\n");
}

async function share() {
  if (state.people.length === 0) {
    toast("Add people and items first");
    return;
  }
  await shareText(summaryText());
}

async function shareText(text) {
  const framed = window.self !== window.top;
  if (navigator.share && !framed) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied. Paste it in your group chat");
  } catch (e) {
    showSplitText(text);
  }
}

async function sendGcashLink(personId) {
  const result = computeSplit(state);
  const index = state.people.findIndex((p) => p.id === personId);
  const row = result.rows[index];
  await shareText(`${row.name}, you owe ${payeeName()} ${peso.format(row.total)}. Pay on GCash: ${GCASH_LINK}`);
}

/* ---------- Who paid ---------- */

function openPaidBySheet() {
  const current = payer();
  const options = [
    { id: null, name: `${PAYEE} (you)`, sub: "Friends pay you. Your GCash QR is used." },
    ...state.people.filter((p) => !isOwnerName(p.name)).map((p) => {
      const qr = p.qr || loadSavedQrs()[p.name.toLowerCase()];
      return { id: p.id, name: p.name, qr, sub: qr ? `Friends pay ${p.name} with ${p.name}'s GCash QR.` : `Friends pay ${p.name}. You can add ${p.name}'s GCash QR.` };
    }),
  ];
  const list = el("ul", { class: "list" }, options.map((o) => {
    const selected = (current ? current.id : null) === o.id;
    const li = el("li", { class: "row", role: "button", tabindex: "0", "aria-pressed": String(selected) }, [
      el("div", { class: "row-main" }, [
        el("span", { class: "row-title", text: o.name }),
        el("span", { class: "row-sub", text: o.sub }),
      ]),
      el("span", { class: "row-check", text: selected ? "✓" : "" }),
    ]);
    onActivate(li, () => {
      state.paidBy = o.id;
      const chosen = o.id && state.people.find((x) => x.id === o.id);
      if (chosen && !chosen.qr && o.qr) chosen.qr = o.qr;
      persist();
      renderMain();
      closeSheet();
      toast(o.id ? `${o.name} paid the bill` : "You paid the bill");
    });
    return li;
  }));
  openSheet({
    title: "Who paid?",
    left: null,
    right: { label: "Close", onClick: closeSheet },
    body: [
      el("p", { class: "note", text: "Everyone's share stays the same. This only changes who they pay." }),
      list,
      options.length === 1 ? el("p", { class: "note", text: "Add people first to pick one of them." }) : null,
    ],
  });
}

/* ---------- Saved groups ---------- */

function openGroupsSheet() {
  let groups = loadGroups();
  let editing = false;
  const note = el("p", { class: "note" });
  const list = el("ul", { class: "list" });

  const names = state.people.map((p) => p.name);
  const nameInput = el("input", {
    class: "line-input", type: "text", placeholder: "e.g. Barkada", maxlength: "30",
    enterkeyhint: "done", autocomplete: "off", "aria-label": "Group name",
  });
  const saveGroup = () => {
    const name = nameInput.value.trim().replace(/\s+/g, " ") || names.slice(0, 3).join(", ");
    const existing = groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (existing) existing.people = names;
    else groups.push({ id: newId(), name, people: names });
    saveGroups(groups);
    nameInput.value = "";
    nameInput.blur();
    renderRows();
    toast(existing ? `Updated ${name}` : `Saved ${name}`);
  };
  nameInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    saveGroup();
  });
  const saveSection = names.length ? el("div", { class: "field" }, [
    el("span", { class: "label", text: "Save the people on this bill" }),
    el("p", { class: "note", text: names.join(", ") }),
    nameInput,
    el("button", { type: "button", class: "btn btn-outline", text: "Save as a group", onclick: saveGroup }),
  ]) : null;

  function addGroup(g) {
    const have = new Set(state.people.map((p) => p.name.toLowerCase()));
    const adding = g.people.filter((n) => !have.has(n.toLowerCase()));
    closeSheet();
    if (adding.length === 0) {
      toast(`Everyone in ${g.name} is already on this bill`);
      return;
    }
    for (const n of adding) state.people.push({ id: newId(), name: n });
    persist();
    renderMain();
    toast(`Added ${adding.join(", ")}`);
  }

  function renderRows() {
    setBarButton($("#sheet-cancel"), groups.length ? { label: editing ? "Done" : "Edit", onClick: () => { editing = !editing; renderRows(); } } : null);
    note.hidden = groups.length > 0;
    note.textContent = "No groups yet. Add the people you usually eat with, then save them as a group here.";
    list.replaceChildren(...groups.map((g) => {
      const main = el("div", { class: "row-main" }, [
        el("span", { class: "row-title", text: g.name }),
        el("span", { class: "row-sub", text: g.people.join(", ") }),
      ]);
      if (editing) {
        const remove = el("button", { type: "button", class: "row-remove", text: "Remove", "aria-label": `Remove the ${g.name} group` });
        remove.addEventListener("click", () => {
          groups = groups.filter((x) => x.id !== g.id);
          saveGroups(groups);
          if (groups.length === 0) editing = false;
          renderRows();
          toast(`Removed ${g.name}`);
        });
        return el("li", { class: "row" }, [main, remove]);
      }
      const li = el("li", { class: "row", role: "button", tabindex: "0" }, [main, el("span", { class: "row-amount light", text: "Add" })]);
      onActivate(li, () => addGroup(g));
      swipeToRemove(li, () => {
        groups = groups.filter((x) => x.id !== g.id);
        saveGroups(groups);
        renderRows();
        toast(`Removed ${g.name}`);
      });
      return li;
    }));
  }

  openSheet({ title: "Saved groups", left: null, right: { label: "Close", onClick: closeSheet }, body: [note, list, saveSection] });
  renderRows();
}

/* ---------- History ---------- */

function billTitle(data) {
  const names = data.people.map((p) => p.name);
  if (names.length === 0) return "Bill with no people yet";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function openHistorySheet() {
  const note = el("p", { class: "note", text: "Loading your bills..." });
  const list = el("ul", { class: "list" });
  let bills = null;
  let editing = false;
  const editButton = () => (bills && bills.length ? { label: editing ? "Done" : "Edit", onClick: toggleEditing } : null);
  openSheet({ title: "History", left: null, right: { label: "Close", onClick: closeSheet }, body: [note, list] });

  function toggleEditing() {
    editing = !editing;
    renderRows();
  }

  function openBill(b) {
    state = { ...JSON.parse(JSON.stringify(b.data)), billId: b.id };
    receiptInput.value = state.receiptTotal || "";
    saveLocal();
    renderMain();
    closeSheet();
    toast(`Opened ${billTitle(b.data)}`);
  }

  async function removeBill(b, button) {
    button.disabled = true;
    if (!(await cloud.remove(b.id))) {
      button.disabled = false;
      toast("Couldn't remove it. Check your connection and try again");
      return;
    }
    bills = bills.filter((x) => x.id !== b.id);
    if (b.id === state.billId) {
      state = defaultState();
      receiptInput.value = "";
      saveLocal();
      renderMain();
      toast("Removed. Started a new bill");
    } else {
      toast("Removed from History");
    }
    if (bills.length === 0) editing = false;
    renderRows();
  }

  function renderRows() {
    setBarButton($("#sheet-cancel"), editButton());
    if (bills.length === 0) {
      note.hidden = false;
      note.textContent = "No saved bills yet. Bills save here as soon as you add someone.";
      list.replaceChildren();
      return;
    }
    note.hidden = true;
    list.replaceChildren(...bills.map((b) => {
      const result = computeSplit(b.data);
      const current = b.id === state.billId;
      const main = el("div", { class: "row-main" }, [
        el("span", { class: "row-title", text: billTitle(b.data) }),
        el("span", { class: "row-sub", text: `${shortDate.format(new Date(b.updated_at))}${current ? " · Open now" : ""}` }),
      ]);
      if (editing) {
        const remove = el("button", { type: "button", class: "row-remove", text: "Remove", "aria-label": `Remove ${billTitle(b.data)} from History` });
        remove.addEventListener("click", () => removeBill(b, remove));
        return el("li", { class: "row" }, [main, remove]);
      }
      const li = el("li", { class: "row", role: "button", tabindex: "0" }, [
        main,
        el("span", { class: "row-amount num", text: peso.format(result.billTotal) }),
      ]);
      onActivate(li, () => openBill(b));
      swipeToRemove(li, () => removeBill(b, { disabled: false }));
      return li;
    }));
  }

  await cloud.flush();
  bills = await cloud.list();
  if (!bills) {
    note.textContent = "Couldn't load your bills. Check your connection and try again.";
    note.classList.add("err");
    return;
  }
  renderRows();
}

const qrImage = new Image();
qrImage.src = GCASH.qr;

function paintSplit(ctx) {
  const result = computeSplit(state);
  const W = 1080;
  const pad = 72;
  const font = '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
  const ink = "#111111";
  const muted = "#6F6F6F";
  const rule = "#E6E6E6";
  const text = (str, x, y, size, weight = 400, color = ink, align = "left") => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(str, x, y);
  };
  const line = (y) => {
    ctx.fillStyle = rule;
    ctx.fillRect(pad, y, W - pad * 2, 2);
  };

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, ctx.canvas.height);

  let y = pad;
  text("PayUp", pad, y + 48, 52, 700);
  text(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), W - pad, y + 48, 30, 400, muted, "right");
  y += 96;
  line(y);

  for (const r of result.rows) {
    text(r.name, pad, y + 62, 40, 500);
    text(peso.format(r.total), W - pad, y + 62, 40, 600, ink, "right");
    let sub = result.hasReceipt ? `Food ${peso.format(r.food)} · Service charge ${peso.format(r.extra)}` : `Food ${peso.format(r.food)}`;
    if (isPayerId(r.id)) sub = `Paid the bill · ${sub}`;
    text(sub, pad, y + 104, 28, 400, muted);
    y += 132;
    line(y);
  }

  y += 28;
  const total = (label, value, strong = false) => {
    text(label, pad, y + 44, strong ? 36 : 30, strong ? 700 : 400, strong ? ink : muted);
    const shown = typeof value === "number" ? peso.format(value) : value;
    text(shown, W - pad, y + 44, strong ? 36 : 30, strong ? 700 : 500, typeof value === "number" ? ink : muted, "right");
    y += 62;
  };
  total("Food", result.itemsTotal);
  if (result.hasReceipt) {
    total(`Service charge (${result.rate >= 0 ? "+" : "−"}${pct(Math.abs(result.rate))})`, result.extra);
  } else {
    total("Service charge", "");
  }
  total("Total", result.billTotal, true);

  const qr = payerQr();
  const drawCard = (label, paint, name, meta) => {
    y += 64;
    ctx.save();
    ctx.font = `600 26px ${font}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "4px";
    ctx.fillStyle = muted;
    ctx.textAlign = "center";
    ctx.fillText(label, W / 2, y + 26);
    ctx.restore();
    y += 52;
    const size = 560;
    const x = (W - size) / 2;
    ctx.fillStyle = rule;
    ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, size, size);
    paint(x, y, size);
    y += size;
    let lineY = y;
    if (name) text(name, W / 2, (lineY += 60), 34, 700, ink, "center");
    if (meta) text(meta, W / 2, (lineY += name ? 44 : 60), 26, 400, muted, "center");
    text("Scan with GCash or any InstaPay app", W / 2, (lineY += 40), 26, 400, muted, "center");
    y = lineY;
  };

  if (qr) {
    drawCard(`PAY ${payeeName().toUpperCase()} WITH GCASH`, (x, top, size) => drawQr(ctx, qr.payload, x, top, size), qr.name, qr.userId ? `User ID ${maskedId(qr.userId)}` : "");
  } else if (!ownerPaid()) {
    y += 64;
    ctx.save();
    ctx.font = `600 26px ${font}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "4px";
    ctx.fillStyle = muted;
    ctx.textAlign = "center";
    ctx.fillText(`PAID BY ${payeeName().toUpperCase()}`, W / 2, y + 26);
    ctx.restore();
    text(`Send your share to ${payeeName()}`, W / 2, y + 96, 36, 600, ink, "center");
    y += 110;
  } else if (qrImage.complete && qrImage.naturalWidth > 0) {
    drawCard("PAY WITH GCASH", (x, top, size) => {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(qrImage, x, top, size, size);
    }, GCASH.name, `Mobile ${GCASH.mobile}`);
  }
  return y + pad;
}

function renderSplitImage() {
  const probe = document.createElement("canvas");
  probe.width = 1080;
  probe.height = 1;
  const height = Math.ceil(paintSplit(probe.getContext("2d")));
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = height;
  paintSplit(canvas.getContext("2d"));
  return canvas;
}

function dataUrlToBlob(dataUrl) {
  const bytes = atob(dataUrl.split(",")[1]);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: "image/png" });
}

async function saveImage() {
  if (state.people.length === 0) {
    toast("Add people and items first");
    return;
  }
  const dataUrl = renderSplitImage().toDataURL("image/png");
  const framed = window.self !== window.top;
  if (!framed) {
    const name = `payup-${new Date().toISOString().slice(0, 10)}.png`;
    const blob = dataUrlToBlob(dataUrl);
    const file = new File([blob], name, { type: "image/png" });
    const text = `Pay ${payeeName()} on GCash: ${GCASH_LINK}`;
    const withText = { files: [file], text };
    const shareData = navigator.canShare && navigator.canShare(withText) ? withText : { files: [file] };
    if (navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    const link = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(link);
    link.click();
    link.remove();
    toast("Image saved");
    return;
  }
  showImage(dataUrl);
}

function showImage(dataUrl) {
  openSheet({
    title: "Save image",
    left: null,
    right: { label: "Done", onClick: closeSheet },
    body: [
      el("p", { class: "note", text: "Press and hold the image to save it to your photos. On a computer, right-click it and choose Save Image." }),
      el("img", { id: "split-image", class: "saved-img", src: dataUrl, alt: "The split as an image, with the GCash QR" }),
    ],
  });
}

function showSplitText(text) {
  const area = el("textarea", {
    id: "split-text", class: "copy-area", readonly: "",
    rows: String(text.split("\n").length), "aria-label": "Split text",
  });
  area.value = text;
  openSheet({
    title: "Copy split",
    left: null,
    right: { label: "Done", onClick: closeSheet },
    body: [el("p", { class: "note", text: "Select the text below and copy it into your group chat." }), area],
  });
  area.select();
}

let toastTimer;
let toastHideTimer;
function toast(message) {
  const node = $("#toast");
  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);
  node.textContent = message;
  node.hidden = false;
  void node.offsetHeight;
  node.classList.add("show");
  toastTimer = setTimeout(() => {
    node.classList.remove("show");
    toastHideTimer = setTimeout(() => (node.hidden = true), 250);
  }, 2200);
}

/* ---------- Theme ---------- */

let theme = document.documentElement.dataset.mode === "dark" ? "dark" : "light";

function applyTheme() {
  const dark = theme === "dark";
  if (dark) document.documentElement.dataset.mode = "dark";
  else delete document.documentElement.dataset.mode;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const schemeMeta = document.querySelector('meta[name="color-scheme"]');
  if (themeMeta) themeMeta.content = dark ? "#0E0E0E" : "#FFFFFF";
  if (schemeMeta) schemeMeta.content = dark ? "dark" : "light";
  $("#theme-btn").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

$("#theme-btn").innerHTML = THEME_ICON;
$("#theme-btn").addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {}
  applyTheme();
});
applyTheme();

/* ---------- Wiring ---------- */

const receiptInput = $("#receipt-total");
receiptInput.value = state.receiptTotal;
receiptInput.addEventListener("input", () => {
  state.receiptTotal = receiptInput.value;
  persist();
  renderMain();
});
receiptInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  addPersonRow.querySelector(".add-input").focus();
});

$("#share").addEventListener("click", share);
$("#save-image").addEventListener("click", saveImage);
$("#gcash-btn").addEventListener("click", () => openQrSheet());
$("#history-btn").hidden = !cloud.enabled;
$("#groups-btn").addEventListener("click", openGroupsSheet);
$("#paid-by").addEventListener("click", openPaidBySheet);
$("#history-btn").addEventListener("click", openHistorySheet);

$("#new-bill").addEventListener("click", () => {
  if (state.items.length === 0 && state.people.length === 0 && !state.receiptTotal) return;
  confirmAction({
    title: "Clear all",
    message: cloud.enabled
      ? "This starts a new, empty bill. The current bill stays in History."
      : "This removes everyone, all items and the receipt total.",
    confirmLabel: "Clear everything",
    onConfirm: () => {
      cloud.flush();
      state = defaultState();
      receiptInput.value = "";
      persist();
      renderMain();
      closeSheet();
    },
  });
});

renderMain();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => splash.release());
else splash.release();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
