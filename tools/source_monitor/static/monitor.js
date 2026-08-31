const scanButton = document.querySelector("#scan-now");
const groupsNode = document.querySelector("#source-groups");
const announcement = document.querySelector("#announcement");
const lastScan = document.querySelector("#last-scan");
const healthNode = document.querySelector("#health");
const runStatus = document.querySelector("#run-status");
let sourcesPayload = { sources: [], activeScanId: null, lastSuccessfulScan: "" };
let pollTimer = null;

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
  return source.latest?.status || (sourcesPayload.activeScanId ? "Queued" : "Not scanned");
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
  for (const groupName of [...order, ...groups.keys()]) {
    if (!groups.has(groupName)) continue;
    const section = document.createElement("section");
    section.className = "group";
    const heading = document.createElement("h2");
    heading.textContent = groupName;
    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `${groups.get(groupName).length} source${groups.get(groupName).length === 1 ? "" : "s"}`;
    heading.append(count);
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
  const titleText = document.createElement("div");
  titleText.className = "source-title";
  titleText.textContent = source.label;
  const agencyText = document.createElement("div");
  agencyText.className = "source-agency";
  agencyText.textContent = `${source.agency} · ${source.sourceType}`;
  title.append(titleText, agencyText);
  const message = document.createElement("div");
  message.className = "source-message";
  message.textContent = latest?.message || (status === "Queued" || status === "Scanning" ? "Waiting for scan…" : "No scan result yet.");
  const badge = document.createElement("span");
  badge.className = `status ${statusClass(status)}`;
  badge.textContent = status;
  const actions = document.createElement("div");
  actions.className = "source-actions";
  actions.append(button("Open source page", "secondary", () => window.open(latest?.indexUrl || source.indexUrl, "_blank", "noopener,noreferrer")));
  const requestText = latest?.importRequest || "";
  actions.append(button("Copy import request", "secondary", async () => {
    try { await navigator.clipboard.writeText(requestText); announcement.textContent = `Copied import request for ${source.label}.`; }
    catch { announcement.textContent = "Clipboard access failed. Expand technical details and copy the request manually."; }
  }, !requestText));
  const canSave = latest && !["Unavailable", "Review required", "Scanning", "Queued"].includes(latest.status);
  actions.append(button("Save local baseline", "secondary", async () => {
    try { await request(`/api/sources/${encodeURIComponent(source.id)}/baseline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scanId: sourcesPayload.activeScanId || undefined }) }); announcement.textContent = `Saved the local baseline for ${source.label}.`; await loadSources(); }
    catch (error) { announcement.textContent = error.message; }
  }, !canSave));
  head.append(title, badge, actions);
  card.append(head, message);
  if (latest) {
    const details = document.createElement("details");
    details.className = "details";
    const summary = document.createElement("summary");
    summary.textContent = "Technical details";
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify({ indexUrl: latest.indexUrl, discoveredCount: latest.discoveredCount, baselineCount: latest.baselineCount, new: latest.new, changed: latest.changed, removed: latest.removed, importer: latest.importer, importRequest: latest.importRequest }, null, 2);
    details.append(summary, pre);
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

async function loadHealth() {
  try {
    const health = await request("/api/health");
    healthNode.textContent = health.ok ? `Ready on ${health.host}:${health.port}` : "Unavailable";
  } catch { healthNode.textContent = "Unavailable"; }
}

async function pollScan(scanId) {
  try {
    const run = await request(`/api/scans/${encodeURIComponent(scanId)}`);
    sourcesPayload.activeScanId = run.status === "running" ? scanId : null;
    runStatus.textContent = run.status === "running" ? `${run.completed}/${run.total} sources scanned` : run.status;
    sourcesPayload.sources = (sourcesPayload.sources || []).map((source) => {
      const progress = run.progress?.[source.id];
      return progress?.result ? { ...source, latest: progress.result } : source;
    });
    render();
    if (run.status === "running") pollTimer = setTimeout(() => pollScan(scanId), 700);
    else { scanButton.disabled = false; announcement.textContent = `Scan finished with status: ${run.status}.`; await loadSources(); }
  } catch (error) { scanButton.disabled = false; announcement.textContent = error.message; }
}

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  announcement.textContent = "Starting all-source scan…";
  try { const run = await request("/api/scans", { method: "POST" }); sourcesPayload.activeScanId = run.scanId; runStatus.textContent = "Starting"; await pollScan(run.scanId); }
  catch (error) { scanButton.disabled = false; announcement.textContent = error.message; }
});

await Promise.all([loadSources(), loadHealth()]);
