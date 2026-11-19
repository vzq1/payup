const SUPABASE_URL = "https://jknoyqwmqxynjnpxmlzv.supabase.co";
const SUPABASE_KEY = "sb_publishable_YyE9_MENgwpj5LIWAJ9lTg_Ew9w9G8D";

const cloud = (() => {
  const framed = window.self !== window.top;
  const lib = window.supabase;
  const db = lib && !framed
    ? lib.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "payup-auth" } })
    : null;

  let signedIn = null;
  function signIn() {
    if (!db) return Promise.resolve(false);
    if (!signedIn) {
      signedIn = (async () => {
        const { data } = await db.auth.getSession();
        if (data.session) return true;
        const { error } = await db.auth.signInAnonymously();
        if (error) throw error;
        return true;
      })().catch((e) => {
        console.warn("PayUp: couldn't sign in to save bills online", e);
        signedIn = null;
        return false;
      });
    }
    return signedIn;
  }

  const hasContent = (bill) => bill.people.length > 0 || bill.items.length > 0;
  const payload = (bill) => ({ receiptTotal: bill.receiptTotal, people: bill.people, items: bill.items });

  let pending = null;
  let timer = null;
  let saving = Promise.resolve(true);
  let savedJson = null;

  async function write(bill) {
    if (!(await signIn())) return false;
    const { error } = await db.from("bills").upsert({ id: bill.billId, data: payload(bill), updated_at: new Date().toISOString() });
    if (error) {
      console.warn("PayUp: couldn't save the bill online", error);
      return false;
    }
    savedJson = JSON.stringify([bill.billId, payload(bill)]);
    return true;
  }

  function isSaved(bill) {
    return !pending && savedJson === JSON.stringify([bill.billId, payload(bill)]);
  }

  function saveNow(bill) {
    if (!db || !bill.billId) return Promise.resolve(false);
    pending = JSON.parse(JSON.stringify(bill));
    return flush();
  }

  function flush() {
    clearTimeout(timer);
    if (!pending) return saving;
    const bill = pending;
    pending = null;
    saving = saving.then(() => write(bill));
    return saving;
  }

  function queueSave(bill) {
    if (!db || !bill.billId || !hasContent(bill)) return;
    pending = JSON.parse(JSON.stringify(bill));
    clearTimeout(timer);
    timer = setTimeout(flush, 800);
  }

  async function list() {
    if (!(await signIn())) return null;
    const { data, error } = await db.from("bills").select("id, data, updated_at").order("updated_at", { ascending: false }).limit(50);
    if (error) {
      console.warn("PayUp: couldn't load bill history", error);
      return null;
    }
    return data;
  }

  async function remove(id) {
    if (!(await signIn())) return false;
    const { error } = await db.from("bills").delete().eq("id", id);
    return !error;
  }

  async function getShared(id) {
    if (!db) return { error: "offline" };
    const { data, error } = await db.rpc("get_shared_bill", { bill_id: id });
    if (error) return { error: error.message };
    if (!data) return { error: "missing" };
    return { data: data.data, updatedAt: data.updated_at };
  }

  function payLink(billId, personId) {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set("bill", billId);
    if (personId) url.searchParams.set("who", personId);
    return url.toString();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  return { enabled: !!db, signIn, queueSave, saveNow, isSaved, flush, list, remove, getShared, payLink };
})();
