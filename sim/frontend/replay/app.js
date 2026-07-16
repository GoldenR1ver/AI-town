async function loadData() {
  const res = await fetch("./demo_data.json");
  if (!res.ok) {
    throw new Error("缺少 demo_data.json。请先运行: npm run sim:run && npm run frontend:export");
  }
  return res.json();
}

function layoutNodes(agents, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.36;
  const n = Math.max(agents.length, 1);
  const map = new Map();
  agents.forEach((a, i) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    map.set(a.id, {
      ...a,
      x: cx + r * Math.cos(ang),
      y: cy + r * Math.sin(ang),
    });
  });
  return map;
}

function renderGraph(slot, selectedId) {
  const svg = document.getElementById("relGraph");
  const width = 640;
  const height = 360;
  const agents = slot.agents ?? [];
  const edges = slot.edges ?? slot.sampleEdges ?? [];
  const pos = layoutNodes(agents, width, height);

  const edgeEls = edges
    .map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return "";
      const trust = Number(e.trust ?? 20);
      const intimacy = Number(e.intimacy ?? 20);
      const stroke = 0.6 + (trust / 100) * 4.5;
      const opacity = 0.15 + (intimacy / 100) * 0.75;
      const hi =
        selectedId && (e.from === selectedId || e.to === selectedId)
          ? ' class="edge edge-hi"'
          : ' class="edge"';
      return `<line${hi} x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${stroke.toFixed(2)}" stroke-opacity="${opacity.toFixed(2)}" data-from="${e.from}" data-to="${e.to}" />`;
    })
    .join("");

  const nodeEls = [...pos.values()]
    .map((a) => {
      const face = a.face ?? 50;
      const radius = 10 + Math.min(8, face / 20);
      const selected = a.id === selectedId ? " node-selected" : "";
      return `
        <g class="node${selected}" data-id="${a.id}" style="cursor:pointer">
          <circle class="node-circle" cx="${a.x}" cy="${a.y}" r="${radius}" />
          <text class="node-label" x="${a.x}" y="${a.y + 4}">${a.id}</text>
          <text class="node-meta" x="${a.x}" y="${a.y + radius + 12}">${a.name ?? ""}</text>
        </g>`;
    })
    .join("");

  svg.innerHTML = `${edgeEls}${nodeEls}`;
  svg.querySelectorAll("g.node").forEach((g) => {
    g.addEventListener("click", () => {
      state.selectedAgentId = g.getAttribute("data-id");
      const sel = document.getElementById("agentSelect");
      if (sel) sel.value = state.selectedAgentId;
      render(state.data, state.index);
    });
  });
}

function actForSlot(data, key) {
  const acts = data.story?.acts;
  if (!Array.isArray(acts)) return null;
  return acts.find((a) => `D${a.time.day}-${a.time.slot}` === key) ?? null;
}

function fillAgentSelect(slot) {
  const sel = document.getElementById("agentSelect");
  const prev = state.selectedAgentId;
  sel.innerHTML = `<option value="">（未选择）</option>`;
  for (const a of slot.agents ?? []) {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.id} ${a.name}`;
    sel.appendChild(opt);
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function renderInspector(slot) {
  const id = state.selectedAgentId;
  const boxA = document.getElementById("inspectAgent");
  const boxG = document.getElementById("inspectGifts");
  const boxE = document.getElementById("inspectEdges");
  if (!id) {
    boxA.textContent = "点击关系图节点或下拉选择";
    boxG.textContent = "—";
    boxE.textContent = "—";
    return;
  }
  const agent = (slot.agents ?? []).find((a) => a.id === id);
  if (!agent) {
    boxA.textContent = `未找到 ${id}`;
    return;
  }
  boxA.textContent = [
    `${agent.id} ${agent.name}`,
    `occupation=${agent.occupation} age=${agent.age ?? "-"}`,
    `cash=${agent.cash} deposit=${agent.deposit ?? "-"} debt=${agent.debt ?? "-"} income=${agent.income ?? "-"}`,
    `face=${agent.face} prestige=${agent.prestige} reputation=${agent.reputation ?? "-"}`,
    `workplace=${agent.workplaceId ?? "-"} community=${agent.communityId ?? "-"}`,
    `kinship=${(agent.kinship ?? []).join(",") || "-"}`,
    `tags=${(agent.socialTags ?? []).join(",") || "-"}`,
    `emotion mood=${agent.emotion?.mood ?? "-"} stress=${agent.emotion?.stress ?? "-"}`,
    `beliefs=${(agent.openBeliefs ?? []).join(" | ") || "-"}`,
    `desires=${(agent.openDesires ?? []).join(" | ") || "-"}`,
    `intentions=${(agent.openIntentions ?? []).join(" | ") || "-"}`,
    `PET rows=${slot.inspector?.petCounts?.[id] ?? 0}`,
  ].join("\n");

  const gifts = (slot.gifts ?? []).filter((g) => g.from === id || g.to === id);
  boxG.textContent = gifts.length
    ? gifts
        .map(
          (g) =>
            `${g.gid} ${g.from}→${g.to} ¥${g.value} [${g.status}] ${g.occasion ?? ""} ${g.description ?? ""}`,
        )
        .join("\n")
    : "(无相关礼单)";

  const edges = (slot.edges ?? []).filter((e) => e.from === id || e.to === id);
  boxE.textContent = edges.length
    ? edges
        .map(
          (e) =>
            `${e.from}→${e.to} trust=${Number(e.trust).toFixed(1)} intimacy=${e.intimacy} debt=${e.giftDebt} axis=${e.relationAxis} ${e.socialBasis}`,
        )
        .join("\n")
    : "(无关系边)";
}

function render(data, index) {
  const slot = data.slots[index];
  const act = actForSlot(data, slot.key);
  const list = document.getElementById("slotList");
  list.innerHTML = "";
  data.slots.forEach((s, i) => {
    const a = actForSlot(data, s.key);
    const li = document.createElement("li");
    li.textContent = a
      ? `${s.key} · Act${a.act} ${a.title}`
      : `${s.key} · gifts=${s.giftCount}`;
    if (i === index) li.classList.add("active");
    li.onclick = () => {
      state.index = i;
      render(data, i);
    };
    list.appendChild(li);
  });

  document.getElementById("storyLine").textContent = act
    ? `Act ${act.act}: ${act.title}${act.tip ? " — " + act.tip : ""}`
    : data.story?.title ?? "（无剧情标注）";

  document.getElementById("runMeta").textContent =
    `run=${data.runId} · slot ${index + 1}/${data.slots.length} · seq=${slot.seq}` +
    (state.selectedAgentId ? ` · focus=${state.selectedAgentId}` : "");

  document.getElementById("slotTitle").textContent =
    `${slot.key}  metrics giftGiven=${slot.metrics.giftGiven} defaulted=${slot.metrics.giftDefaulted}` +
    (slot.metrics.dialoguesCompleted != null
      ? ` dialogue=${slot.metrics.dialoguesCompleted}`
      : "") +
    (slot.metrics.cognitivePromotions != null
      ? ` cog↑=${slot.metrics.cognitivePromotions}`
      : "") +
    (act ? ` · ${act.title}` : "");

  const metricsSrc = data.metrics ?? slot.experimentMetrics;
  document.getElementById("metricsBox").textContent = metricsSrc
    ? [
        `reciprocity_rate=${Number(metricsSrc.reciprocity_rate).toFixed(3)}`,
        `default_rate=${Number(metricsSrc.default_rate).toFixed(3)}`,
        `avg_repay_delay=${Number(metricsSrc.avg_repay_delay).toFixed(2)}`,
        `prestige_gini=${Number(metricsSrc.prestige_gini).toFixed(3)}`,
        `asymmetric_gift_ratio=${Number(metricsSrc.asymmetric_gift_ratio).toFixed(3)}`,
        `gift_count_total=${metricsSrc.gift_count_total}`,
        `trust_mean=${Number(metricsSrc.trust_mean).toFixed(2)}`,
        `agent_count=${metricsSrc.agent_count ?? slot.agents.length}`,
      ].join("\n")
    : "(无 metrics.json — 请跑 npm run sim:run)";

  fillAgentSelect(slot);
  renderGraph(slot, state.selectedAgentId);
  renderInspector(slot);

  document.getElementById("giftBox").textContent = slot.gifts.length
    ? slot.gifts
        .map(
          (g) =>
            `${g.gid} ${g.from}→${g.to} ¥${g.value} [${g.status}] ${g.description ?? ""}`,
        )
        .join("\n")
    : "(无礼单)";

  document.getElementById("agentBox").textContent = slot.agents
    .map(
      (a) =>
        `${a.id} ${a.name} (${a.occupation}) cash=${a.cash} face=${a.face ?? "-"} prestige=${a.prestige ?? "-"}`,
    )
    .join("\n");

  const nearby = data.logs.filter((l) => {
    const k = `D${l.simTime.day}-${l.simTime.slot}`;
    return k === slot.key;
  });
  document.getElementById("logBox").textContent = nearby.length
    ? nearby.map((l) => `#${l.seq} ${l.type} ${l.summary}`).join("\n")
    : "(本 slot 无额外摘要)";
}

const state = { data: null, index: 0, selectedAgentId: "" };

const data = await loadData();
state.data = data;
const withGift = data.slots.findIndex((s) => s.giftCount > 0);
state.index = withGift >= 0 ? withGift : 0;
render(data, state.index);

document.getElementById("prevBtn").onclick = () => {
  state.index = Math.max(0, state.index - 1);
  render(state.data, state.index);
};
document.getElementById("nextBtn").onclick = () => {
  state.index = Math.min(state.data.slots.length - 1, state.index + 1);
  render(state.data, state.index);
};
document.getElementById("agentSelect").onchange = (e) => {
  state.selectedAgentId = e.target.value;
  render(state.data, state.index);
};
document.getElementById("clearAgentBtn").onclick = () => {
  state.selectedAgentId = "";
  render(state.data, state.index);
};
