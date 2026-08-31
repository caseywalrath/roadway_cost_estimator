const scanButton = document.querySelector("#scan-now");
const groupsNode = document.querySelector("#source-groups");
const announcement = document.querySelector("#announcement");
const lastScan = document.querySelector("#last-scan");
const runStatus = document.querySelector("#run-status");
let sourcesPayload = { sources: [], activeScanId: null, lastSuccessfulScan: "" };
let pollTimer = null;
const activeSourceIds = new Set();

const esc = (value) => String(value ?? "");
const formatTime = (value) => value ? new Date(value).toLocaleString() : "Never";
const statusClass = (status) => `status-${esc(status).replaceAll(" ", "-")}`;

async function request(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function sourceStatus(source) {
  return source.activeStatus || source.latest?.status || (activeSourceIds.has(source.id) ? "Queued" : "Not scanned");
}

function resultSummary(latest, status) {
  if (!latest || status === "Unchanged" || status === "Not scanned" || status === "Queued" || status === "Scanning") return "";
  if (status === "Unavailable" || status === "Review required") return latest.message;
  const parts = [];
  if (latest.new?.length) parts.push(`${latest.new.length} new`);
  if (latest.changed?.length) parts.push(`${latest.changed.length} changed`);
  if (latest.removed?.length) parts.push(`${latest.removed.length} removed`);
  return parts.join(" · ") || `${latest.discoveredCount} records`;
}

function button(label, className, onClick, disabled = false) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  node.disabled = disabled;
  if (!disabled) node.addEventListener("click", onClick);
  return node;
}

function render() {
  lastScan.textContent = formatTime(sourcesPayload.lastSuccessfulScan);
  groupsNode.replaceChildren();
  const groups = new Map();
  for (const source of sourcesPayload.sources || []) {
    const group = source.state === "Shared" ? "Shared / FHWA" : source.state;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(source);
  }
  const order = ["CO", "IA", "NE", "SD", "Shared / FHWA"];
  const groupOrder = [...order, ...[...groups.keys()].filter((groupName) => !order.includes(groupName))];
  for (const groupName of groupOrder) {
    if (!groups.has(groupName)) continue;
    const section = document.createElement("section");
    section.className = "group";
    const heading = document.createElement("h2");
    heading.textContent = groupName;
    section.append(heading);
    groups.get(groupName).forEach((source) => section.append(renderSource(source)));
    groupsNode.append(section);
  }
}

function renderSource(source) {
  const latest = source.latest;
  const status = sourceStatus(source);
  const card = document.createElement("article");
  card.className = "source-card";
  const head = document.createElement("div");
  head.className = "source-head";
  const title = document.createElement("div");
  const titleText = document.createElement("a");
  titleText.className = "source-title";
  titleText.textContent = source.label;
  titleText.href = latest?.indexUrl || source.indexUrl;
  titleText.target = "_blank";
  titleText.rel = "noopener noreferrer";
  const agencyText = document.createElement("div");
  agencyText.className = "source-agency";
  agencyText.textContent = `${source.agency}${source.localBaseline?.savedAt ? " · baseline saved" : ""}`;
  if (source.localBaseline?.savedAt) {
    agencyText.title = `Baseline saved ${formatTime(source.localBaseline.savedAt)} · ${source.localBaseline.recordCount} record${source.localBaseline.recordCount === 1 ? "" : "s"}`;
  }
  title.append(titleText, agencyText);
  const message = document.createElement("div");
  message.className = "source-message";
  message.textContent = resultSummary(latest, status);
  const badge = document.createElement("span");
  badge.className = `status ${statusClass(status)}`;
  badge.textContent = status;
  const actions = document.createElement("div");
  actions.className = "source-actions";
  const scanInProgress = activeSourceIds.has(source.id);
  actions.append(button(scanInProgress ? "Scanning…" : "Scan", "secondary", () => scanSource(source), Boolean(sourcesPayload.activeScanId)));
  const requestText = latest?.importRequest || "";
  if (requestText) actions.append(button("Copy import request", "secondary", async () => {
    try { await navigator.clipboard.writeText(requestText); announcement.textContent = `Copied import request for ${source.label}.`; }
    catch { announcement.textContent = "Clipboard access failed. Expand technical details and copy the request manually."; }
  }));
  const canSave = latest && ["Baseline needed", "New", "Changed", "Removed"].includes(latest.status);
  if (canSave) actions.append(button("Save baseline", "secondary", async () => {
    try { const saved = await request(`/api/sources/${encodeURIComponent(source.id)}/baseline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scanId: sourcesPayload.activeScanId || undefined }) }); announcement.textContent = `Saved the local baseline for ${source.label}.`; source.localBaseline = { savedAt: saved.savedAt, recordCount: saved.recordCount }; render(); }
    catch (error) { announcement.textContent = error.message; }
  }));
  head.append(title, badge, actions);
  card.append(head);
  if (message.textContent) card.append(message);
  if (latest && ["New", "Changed", "Removed", "Unavailable", "Review required"].includes(latest.status)) {
    const details = document.createElement("details");
    details.className = "details";
    const summary = document.createElement("summary");
    summary.textContent = "Details";
    const list = document.createElement("ul");
    list.className = "detail-list";
    const records = [...(latest.new || []), ...(latest.changed || []), ...(latest.removed || [])];
    records.forEach((record) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = record.resolvedUrl || record.discoveredUrl || latest.indexUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = record.title || record.period || record.recordId;
      item.append(link);
      list.append(item);
    });
    if (!records.length) {
      const item = document.createElement("li");
      item.textContent = latest.message;
      list.append(item);
    }
    details.append(summary, list);
    card.append(details);
  }
  return card;
}

async function loadSources() {
  try {
    sourcesPayload = await request("/api/sources");
    if (sourcesPayload.registryError) announcement.textContent = sourcesPayload.registryError;
    render();
  } catch (error) { announcement.textContent = error.message; }
}

async function pollScan(scanId) {
  try {
    const run = await request(`/api/scans/${encodeURIComponent(scanId)}`);
    sourcesPayload.activeScanId = run.status === "running" ? scanId : null;
    runStatus.textContent = run.status === "running" ? `${run.completed}/${run.total} scanned` : "";
    sourcesPayload.sources = (sourcesPayload.sources || []).map((source) => {
      const progress = run.progress?.[source.id];
      if (!progress) return source;
      return progress.result ? { ...source, latest: progress.result, activeStatus: "" } : { ...source, activeStatus: progress.status };
    });
    render();
    if (run.status === "running") pollTimer = setTimeout(() => pollScan(scanId), 700);
    else {
      scanButton.disabled = false;
      for (const sourceId of run.sourceIds || []) activeSourceIds.delete(sourceId);
      announcement.textContent = `Scan finished with status: ${run.status}.`;
      await loadSources();
    }
  } catch (error) {
    scanButton.disabled = false;
    activeSourceIds.clear();
    announcement.textContent = error.message;
  }
}

async function scanSource(source) {
  activeSourceIds.add(source.id);
  source.activeStatus = "Queued";
  announcement.textContent = `Starting scan for ${source.label}…`;
  render();
  try {
    const run = await request(`/api/sources/${encodeURIComponent(source.id)}/scans`, { method: "POST" });
    sourcesPayload.activeScanId = run.scanId;
    runStatus.textContent = "Starting";
    await pollScan(run.scanId);
  } catch (error) {
    activeSourceIds.delete(source.id);
    announcement.textContent = error.message;
    render();
  }
}

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  announcement.textContent = "Starting all-source scan…";
  try { const run = await request("/api/scans", { method: "POST" }); sourcesPayload.activeScanId = run.scanId; runStatus.textContent = "Starting"; await pollScan(run.scanId); }
  catch (error) { scanButton.disabled = false; announcement.textContent = error.message; }
});

await loadSources();
