// GCash and InstaPay QR codes: read one from a picture, check it, and draw it.

const QR_UPLOAD = {
  types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  extensions: ["jpg", "jpeg", "png", "webp", "heic", "heif"],
  maxBytes: 10 * 1024 * 1024,
  label: "JPG, PNG, WebP or HEIC, up to 10 MB",
};
QR_UPLOAD.accept = [...QR_UPLOAD.types, ...QR_UPLOAD.extensions.map((e) => "." + e)].join(",");

if (window.qrcode) qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

function qrFileError(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  const known = QR_UPLOAD.types.includes(type) || ((!type || type === "application/octet-stream") && QR_UPLOAD.extensions.includes(ext));
  if (!known) return "Use a JPG, PNG, WebP or HEIC picture";
  if (file.size === 0) return "That picture is empty";
  if (file.size > QR_UPLOAD.maxBytes) return "That picture is over 10 MB";
  return null;
}

// EMV QR fields: two-digit tag, two-digit length, value.
function qrFields(text) {
  const fields = {};
  let i = 0;
  while (i < text.length) {
    const tag = text.slice(i, i + 2);
    const size = text.slice(i + 2, i + 4);
    if (!/^\d\d$/.test(tag) || !/^\d\d$/.test(size)) return null;
    const end = i + 4 + Number(size);
    if (end > text.length) return null;
    fields[tag] = text.slice(i + 4, end);
    i = end;
  }
  return fields;
}

function qrChecksum(text) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Returns { payload, name, userId, gcash } for a Philippine payment QR, or null.
function parsePayQr(payload) {
  if (typeof payload !== "string" || !payload.startsWith("000201")) return null;
  const fields = qrFields(payload);
  if (!fields || fields["58"] !== "PH" || !fields["63"]) return null;
  if (qrChecksum(payload.slice(0, -4)) !== fields["63"].toUpperCase()) return null;
  let account = null;
  for (let tag = 26; tag <= 51; tag++) {
    const sub = fields[String(tag)] && qrFields(fields[String(tag)]);
    if (sub && sub["00"]) {
      account = sub;
      break;
    }
  }
  if (!account) return null;
  return {
    payload,
    name: (fields["59"] || "").trim(),
    userId: account["04"] || "",
    gcash: (account["01"] || "").startsWith("GXCHPH"),
  };
}

function maskedId(id) {
  return id.length > 6 ? "•".repeat(id.length - 6) + id.slice(-6) : id;
}

let jsQRLoading = null;
function loadQrReader() {
  if (window.jsQR) return Promise.resolve();
  if (!jsQRLoading) {
    jsQRLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/jsQR.js";
      script.onload = resolve;
      script.onerror = () => {
        jsQRLoading = null;
        reject(new Error("The QR reader didn't load"));
      };
      document.head.append(script);
    });
  }
  return jsQRLoading;
}

async function openPicture(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch (e) {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Reads the QR in a picture. Throws an Error with a message for the person.
async function readQrPicture(file) {
  await loadQrReader();
  let picture;
  try {
    picture = await openPicture(file);
  } catch (e) {
    throw new Error("This phone can't open that picture. Try a screenshot of the QR.");
  }
  const width = picture.width || picture.naturalWidth;
  const height = picture.height || picture.naturalHeight;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  for (const longest of [1000, 1600, 2400, 600]) {
    const scale = Math.min(1, longest / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
    if (found && found.data) {
      if (picture.close) picture.close();
      const qr = parsePayQr(found.data);
      if (!qr) throw new Error("That QR isn't a GCash or InstaPay QR");
      return qr;
    }
    if (scale === 1 && longest >= Math.max(width, height)) break;
  }
  if (picture.close) picture.close();
  throw new Error("No QR found in that picture");
}

// The QR's dark squares, with a 4-square white border like the GCash app's.
function qrGrid(payload) {
  const code = qrcode(0, "M");
  code.addData(payload, "Byte");
  code.make();
  const count = code.getModuleCount();
  return { size: count + 8, dark: (row, col) => row >= 4 && col >= 4 && row < count + 4 && col < count + 4 && code.isDark(row - 4, col - 4) };
}

function qrSvgUrl(payload) {
  const grid = qrGrid(payload);
  let path = "";
  for (let row = 0; row < grid.size; row++) {
    for (let col = 0; col < grid.size; col++) {
      if (!grid.dark(row, col)) continue;
      let run = 1;
      while (col + run < grid.size && grid.dark(row, col + run)) run++;
      path += `M${col} ${row}h${run}v1h-${run}z`;
      col += run - 1;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid.size} ${grid.size}" shape-rendering="crispEdges"><rect width="${grid.size}" height="${grid.size}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function drawQr(ctx, payload, x, y, size) {
  const grid = qrGrid(payload);
  const edge = (i) => Math.round((i * size) / grid.size);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#000000";
  for (let row = 0; row < grid.size; row++) {
    for (let col = 0; col < grid.size; col++) {
      if (grid.dark(row, col)) ctx.fillRect(x + edge(col), y + edge(row), edge(col + 1) - edge(col), edge(row + 1) - edge(row));
    }
  }
}
