(() => {
  const params = new URLSearchParams(location.search);
  const billId = params.get("bill");
  if (!billId) return;

  const PAYEE = "Bon";
  const editor = document.getElementById("editor");
  const page = document.getElementById("pay-page");
  const body = document.getElementById("pay-body");
  editor.hidden = true;
  page.hidden = false;
  document.title = "Pay Bon · PayUp";

  splash.hold();
  let splashReleased = false;
  const releaseSplash = () => {
    if (splashReleased) return;
    splashReleased = true;
    splash.release();
  };

  let who = params.get("who");
  let bill = null;
  let updatedAt = null;

  const amountText = (n) => n.toFixed(2);

  function setWho(id) {
    who = id;
    const url = new URL(location.href);
    if (id) url.searchParams.set("who", id); else url.searchParams.delete("who");
    history.replaceState(null, "", url);
    render();
  }

  function message(text, retry) {
    body.replaceChildren(el("div", { class: "pay-message" }, [
      el("p", { text }),
      retry ? el("button", { type: "button", class: "btn btn-outline", text: "Try again", onclick: load }) : null,
    ]));
  }

  function qrPng() {
    const size = 1024, pad = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qrImage, pad, pad, size - pad * 2, size - pad * 2);
    return canvas.toDataURL("image/png");
  }

  async function saveQr() {
    if (!(qrImage.complete && qrImage.naturalWidth > 0)) {
      toast("The QR is still loading. Try again in a moment");
      return;
    }
    const blob = dataUrlToBlob(qrPng());
    const file = new File([blob], "bon-gcash-qr.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    const link = el("a", { href: URL.createObjectURL(blob), download: file.name });
    document.body.append(link);
    link.click();
    link.remove();
    toast("QR saved");
  }

  async function copyAmount(total) {
    try {
      await navigator.clipboard.writeText(amountText(total));
      toast(`Copied ${amountText(total)}`);
    } catch (e) {
      toast(`Type ${amountText(total)} as the amount in GCash`);
    }
  }

  function step(n, text, action) {
    return el("li", { class: "step" }, [
      el("span", { class: "step-n", text: String(n) }),
      el("span", { class: "step-text", text }),
      action,
    ]);
  }

  function renderChooser(result) {
    body.replaceChildren(
      el("div", { class: "pay-head" }, [
        el("span", { class: "label", text: `Splitting with ${PAYEE}` }),
        el("h1", { class: "pay-title", text: "Who are you?" }),
      ]),
      el("ul", { class: "list" }, result.rows.map((r) => {
        const li = el("li", { class: "row", role: "button", tabindex: "0" }, [
          el("div", { class: "row-main" }, el("span", { class: "row-title", text: r.name })),
          el("span", { class: "row-amount num", text: peso.format(r.total) }),
        ]);
        onActivate(li, () => setWho(r.id));
        return li;
      })),
    );
  }

  function render() {
    const result = computeSplit(bill);
    const index = bill.people.findIndex((p) => p.id === who);
    if (index < 0) {
      renderChooser(result);
      return;
    }
    const person = bill.people[index];
    const row = result.rows[index];

    const validIds = new Set(bill.people.map((p) => p.id));
    const itemLines = [];
    for (const item of bill.items) {
      const shares = itemShares(item, validIds);
      if (!shares.has(person.id)) continue;
      let label = item.name.trim() || "Item";
      if (shares.size > 1) label += item.custom ? " · shared" : ` · ÷ ${shares.size}`;
      itemLines.push(line(label, shares.get(person.id)));
    }
    if (result.hasReceipt) itemLines.push(line("Service charge", row.extra));
    itemLines.push(line("Total", row.total, "total"));

    const everyone = result.rows.map((r) => line(r.name, r.total));
    everyone.push(line("Receipt total", result.billTotal, "total"));

    const isMe = person.name.trim().toLowerCase() === PAYEE.toLowerCase();

    body.replaceChildren(
      el("div", { class: "pay-head" }, [
        el("span", { class: "label", text: isMe ? `${person.name}, your share` : `${person.name}, you owe ${PAYEE}` }),
        el("div", { class: "pay-amount num", text: peso.format(row.total) }),
      ]),
      el("div", { class: "lines" }, itemLines),
      isMe ? null : el("div", { class: "field" }, [
        el("span", { class: "label", text: "Pay with GCash" }),
        el("ol", { class: "steps" }, [
          step(1, "Save Bon's QR to your photos.", el("button", { type: "button", class: "btn btn-outline", text: "Save QR", onclick: saveQr })),
          step(2, "Copy the amount.", el("button", { type: "button", class: "btn btn-outline num", text: `Copy ${amountText(row.total)}`, onclick: () => copyAmount(row.total) })),
          step(3, "In GCash, tap QR, then Upload QR. Pick the saved QR, paste the amount and send.", el("a", { class: "btn btn-solid", href: "gcash://", text: "Open GCash" })),
        ]),
        el("p", { class: "hint", text: "If GCash doesn't open, open it yourself and follow step 3." }),
      ]),
      isMe ? null : el("div", { class: "qr" }, [
        el("span", { class: "qr-label", text: "Paying from another phone? Scan this" }),
        el("div", { class: "qr-box" }, el("img", { src: GCASH.qr, alt: `GCash QR code for ${GCASH.name}`, width: "300", height: "300" })),
        el("div", {}, [
          el("div", { class: "qr-name", text: GCASH.name }),
          el("div", { class: "qr-meta", text: `Mobile ${GCASH.mobile}` }),
        ]),
      ]),
      el("details", { class: "everyone" }, [
        el("summary", { text: "Everyone's share" }),
        el("div", { class: "lines" }, everyone),
      ]),
      el("div", { class: "pay-foot" }, [
        el("button", { type: "button", class: "text-btn muted", text: `Not ${person.name}?`, onclick: () => setWho(null) }),
        el("span", { class: "hint", text: `Updated ${shortDate.format(new Date(updatedAt))}` }),
      ]),
    );
  }

  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    if (!bill) message("Loading the bill...");
    const res = await cloud.getShared(billId);
    loading = false;
    releaseSplash();
    if (res.error) {
      if (bill) return;
      if (res.error === "missing" || /invalid input syntax for type uuid/i.test(res.error)) message("This bill isn't available. Ask Bon to send the link again.");
      else message("Can't load the bill. Check your connection and try again.", true);
      return;
    }
    const changed = res.updatedAt !== updatedAt;
    bill = res.data;
    updatedAt = res.updatedAt;
    if (changed) render();
  }

  load();
  setInterval(() => { if (document.visibilityState === "visible") load(); }, 20000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
})();
