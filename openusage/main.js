import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, theme, run, exec, appHome, props, closeOverlay, shared, setShared, layout } from "herdr";

const PROVIDER_METAS = {
  claude: {
    name: "Claude Code",
    script: "helpers/claude.py",
    icon: "mods/openusage/icons/claude.svg",
    color: "#d97757",
    poll: 300_000,
    stale: 10 * 60_000,
    app: "claude",
  },
  codex: {
    name: "OpenAI ChatGPT",
    script: "helpers/codex.py",
    icon: "mods/openusage/icons/openai.svg",
    color: "#10a37f",
    poll: 120_000,
    stale: 10 * 60_000,
    app: "codex",
  },
  antigravity: {
    name: "Google Antigravity",
    script: "helpers/antigravity.py",
    icon: "mods/openusage/icons/antigravity.svg",
    color: "#4285f4",
    poll: 600_000,
    stale: 20 * 60_000,
    app: "antigravity",
  },
  opencode: {
    name: "OpenCode",
    script: "helpers/opencode.py",
    icon: "mods/openusage/icons/opencode.svg",
    color: "#8b5cf6",
    poll: 120_000,
    stale: 10 * 60_000,
    app: "opencode",
  },
};

const PERIODS = {
  session: 5 * 3600,       // 5 hours = 18,000s
  weekly: 7 * 24 * 3600,   // 7 days = 604,800s
  monthly: 30 * 24 * 3600, // 30 days = 2,592,000s
  rolling: 24 * 3600,      // 24 hours = 86,400s
};



// 60-second cooldown: Opening/toggling the mod within 60s will NEVER trigger a refetch
const MIN_REFRESH_INTERVAL = 60_000;
const CACHE_KEY = "openusage.accounts_cache";

function getSharedCache() {
  try {
    const c = shared(CACHE_KEY);
    return (c && typeof c === "object") ? c : {};
  } catch {
    return {};
  }
}

function updateSharedCache(accId, state) {
  try {
    const current = getSharedCache();
    setShared(CACHE_KEY, { ...current, [accId]: state });
  } catch {}
}

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function getSidebarWidth() {
  try {
    const root = layout();
    const sb = findNode(root, "sidebar");
    const px = sb?.size?.px;
    if (typeof px === "number" && Number.isFinite(px) && px > 0) return px;
  } catch {}
  return 268;
}

function clamp(value, min = 0, max = 100) {
  const n = Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, n));
}

function countdown(isoOrMs) {
  if (!isoOrMs) return null;
  const stamp = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  const left = stamp - Date.now();
  if (!Number.isFinite(left)) return null;
  if (left <= 0) return "now";
  const minutes = Math.floor(left / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${rest}m`;
  return `${rest}m`;
}

function timeAgo(stamp) {
  if (!stamp) return "pending";
  const diff = Date.now() - stamp;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function evaluatePace({ used, limit = 100, resetsAt, periodSeconds, now = Date.now() }) {
  const actualRemaining = Math.max(0, limit - used);
  const remainingPercent = Math.min(100, Math.max(0, (actualRemaining / limit) * 100));

  if (!resetsAt || !periodSeconds || limit <= 0) {
    return {
      status: "unpaced",
      statusText: null,
      remainingPercent,
      actualRemaining,
      guideRemainingPercent: null,
      projectedUsagePercent: null,
      isAhead: null,
    };
  }

  const resetMs = typeof resetsAt === "number" ? resetsAt : Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) {
    return {
      status: "unpaced",
      statusText: null,
      remainingPercent,
      actualRemaining,
      guideRemainingPercent: null,
      projectedUsagePercent: null,
      isAhead: null,
    };
  }

  const periodMs = periodSeconds * 1000;
  const startMs = resetMs - periodMs;
  const elapsedMs = now - startMs;
  const remainingTimeMs = resetMs - now;

  if (remainingTimeMs <= 0 || elapsedMs <= 0) {
    return {
      status: "unpaced",
      statusText: null,
      remainingPercent,
      actualRemaining,
      guideRemainingPercent: null,
      projectedUsagePercent: null,
      isAhead: null,
    };
  }

  const elapsedFraction = Math.min(1, Math.max(0, elapsedMs / periodMs));
  const guideRemainingPercent = Math.max(0, Math.min(100, (1 - elapsedFraction) * 100));

  if (used >= limit) {
    return {
      status: "spent",
      statusText: "Limit reached",
      remainingPercent: 0,
      actualRemaining: 0,
      guideRemainingPercent,
      projectedUsagePercent: 100,
      isAhead: false,
    };
  }

  if (used <= 0 || elapsedMs < Math.max(60_000, periodMs * 0.01)) {
    return {
      status: "healthy",
      statusText: "100% available",
      remainingPercent,
      actualRemaining,
      guideRemainingPercent,
      projectedUsagePercent: 0,
      isAhead: true,
    };
  }

  const projectedUsed = (used / elapsedMs) * periodMs;
  const projectedFraction = projectedUsed / limit;
  const projectedUsagePercent = Math.round(projectedFraction * 100);

  let status = "ahead";
  let statusText = "";
  let isAhead = true;

  if (projectedUsed > limit) {
    status = "behind";
    isAhead = false;
    const overPercent = Math.max(1, Math.round((projectedFraction - 1) * 100));
    statusText = `~${overPercent}% over limit at reset`;
  } else if (projectedUsed > limit * 0.9) {
    status = "onTrack";
    isAhead = false;
    statusText = `~${projectedUsagePercent}% used at reset`;
  } else {
    status = "ahead";
    isAhead = true;
    const leftPercent = Math.max(1, Math.round((1 - projectedFraction) * 100));
    statusText = `~${leftPercent}% left at reset`;
  }

  return {
    status,
    statusText,
    remainingPercent,
    actualRemaining,
    guideRemainingPercent,
    projectedUsagePercent,
    isAhead,
  };
}

export default class OpenUsage extends View {
  init(_props, cx) {
    this.viewMode = props()?.view === "settings" ? "settings" : "dashboard";
    this.accounts = [];

    // Stamp load time into shared memory for diagnostics
    try { setShared("openusage.build_v", "2026-11-05-v3-debug"); } catch {}

    // Warm cache from shared Herdr memory across all open instances (sidebar, tabs, overlays)
    this.accountData = { ...getSharedCache() };

    // Load multi-accounts configuration
    this.loadAccounts(cx);

    // Refresh countdowns & relative timestamps every 30s without hitting any network
    cx.timer.every(30_000, (cx) => cx.notify());
  }

  loadAccounts(cx) {
    cx.spawn(async (cx) => {
      try {
        const scriptPath = `${appHome()}/mods/openusage/helpers/accounts.py`;
        const res = await exec("python3", [scriptPath, "list"]);
        if (res.code === 0) {
          const cfg = JSON.parse(res.stdout);
          this.accounts = cfg.accounts ?? [];
        }
      } catch (err) {
        this.accounts = [
          { id: "claude-default", provider: "claude", name: "Claude Code", label: "Work", enabled: true },
          { id: "codex-default", provider: "codex", name: "OpenAI Codex", label: "Personal", enabled: true },
          { id: "antigravity-default", provider: "antigravity", name: "Google Antigravity", label: "Default", enabled: true },
          { id: "opencode-default", provider: "opencode", name: "OpenCode", label: "Go", enabled: true },
        ];
      }

      const cached = getSharedCache();
      for (const acc of this.accounts) {
        if (!this.accountData[acc.id] && cached[acc.id]) {
          this.accountData[acc.id] = cached[acc.id];
        }
        if (acc.enabled !== false) {
          // Schedule background polling for this account (runs periodically)
          const provMeta = PROVIDER_METAS[acc.provider];
          const pollMs = provMeta?.poll ?? 120_000;
          cx.timer.every(pollMs, (cx) => this.refreshAccount(acc, cx, true));

          // NEVER auto-fetch on Open if data already exists in memory or shared cache!
          // Only fetch if there is completely NO data at all (first cold start of app)
          if (!this.accountData[acc.id]?.data && !cached[acc.id]?.data) {
            this.refreshAccount(acc, cx, false);
          }
        }
      }
      cx.notify();
    });
  }

  refreshAccount(account, cx, force = false) {
    const provMeta = PROVIDER_METAS[account.provider];
    if (!provMeta) return;

    const cached = getSharedCache()[account.id];

    // If not forced (e.g. user simply opened the mod), NEVER trigger a fetch if cache exists!
    // Refetches ONLY happen on periodic background timer or when user clicks 'Refresh' (force=true)
    if (!force && (cached?.data || this.accountData[account.id]?.data)) {
      if (cached?.data) this.accountData[account.id] = cached;
      cx.notify();
      return;
    }

    let provState = this.accountData[account.id];
    if (!provState) {
      provState = { data: null, at: 0, loading: false, error: null, warning: null };
      this.accountData[account.id] = provState;
    }
    if (provState.loading) return;

    provState.loading = true;
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        const scriptPath = `${appHome()}/mods/openusage/${provMeta.script}`;
        const args = [scriptPath];
        if (account.provider === "claude" && account.keychainService) {
          args.push(account.keychainService);
        } else if (account.provider === "codex" && account.authPath) {
          args.push(account.authPath);
        }

        const res = await exec("python3", args);
        if (res.code !== 0) {
          throw new Error(res.stderr.trim() || `Script exited ${res.code}`);
        }
        const data = JSON.parse(res.stdout);
        if (!data.ok) {
          throw new Error(data.error || "Unsuccessful response");
        }
        const resultState = {
          data,
          at: data.fetched_at ? data.fetched_at * 1000 : Date.now(),
          error: null,
          warning: data.warning ?? null,
          loading: false,
        };
        this.accountData[account.id] = resultState;
        updateSharedCache(account.id, resultState);
      } catch (err) {
        provState.error = String(err?.message ?? err);
        provState.loading = false;
      } finally {
        provState.loading = false;
        cx.notify();
      }
    });
  }

  refreshAll(cx) {
    // Explicit click on Refresh forces immediate update
    for (const acc of this.accounts) {
      if (acc.enabled !== false) {
        this.refreshAccount(acc, cx, true);
      }
    }
  }

  toggleAccount(accId, cx) {
    cx.spawn(async (cx) => {
      try {
        const scriptPath = `${appHome()}/mods/openusage/helpers/accounts.py`;
        await exec("python3", [scriptPath, "toggle", accId]);
        this.loadAccounts(cx);
      } catch (err) {
        cx.notify();
      }
    });
  }

  deleteAccount(accId, cx) {
    cx.spawn(async (cx) => {
      try {
        const scriptPath = `${appHome()}/mods/openusage/helpers/accounts.py`;
        await exec("python3", [scriptPath, "remove", accId]);
        this.loadAccounts(cx);
      } catch (err) {
        cx.notify();
      }
    });
  }

  addAccountPreset(provider, label, customArg, cx) {
    cx.spawn(async (cx) => {
      try {
        const meta = PROVIDER_METAS[provider];
        const newAcc = {
          id: `${provider}-${Date.now().toString(36)}`,
          provider,
          name: meta?.name ?? provider,
          label: label || "New Account",
          enabled: true,
        };
        if (provider === "claude" && customArg) newAcc.keychainService = customArg;
        if (provider === "codex" && customArg) newAcc.authPath = customArg;

        const scriptPath = `${appHome()}/mods/openusage/helpers/accounts.py`;
        await exec("python3", [scriptPath, "add", JSON.stringify(newAcc)]);
        this.loadAccounts(cx);
      } catch (err) {
        cx.notify();
      }
    });
  }

  isAnyLoading() {
    return Object.values(this.accountData).some((p) => p.loading);
  }

  getOverallPacingSummary(t) {
    let aheadCount = 0;
    let onTrackCount = 0;
    let behindCount = 0;

    const test = (w, period) => {
      if (!w || !w.resets_at) return;
      const res = evaluatePace({ used: w.utilization ?? 0, resetsAt: w.resets_at, periodSeconds: period });
      if (res.status === "behind" || res.status === "spent") behindCount++;
      else if (res.status === "onTrack") onTrackCount++;
      else if (res.status === "ahead" || res.status === "healthy") aheadCount++;
    };

    for (const acc of this.accounts) {
      if (acc.enabled === false) continue;
      const p = this.accountData[acc.id];
      if (!p?.data) continue;
      if (acc.provider === "claude") {
        test(p.data.five_hour, PERIODS.session);
        test(p.data.seven_day, PERIODS.weekly);
      } else if (acc.provider === "codex") {
        test(p.data.five_hour, PERIODS.session);
        test(p.data.seven_day, PERIODS.weekly);
      } else if (acc.provider === "antigravity") {
        test(p.data.five_hour, PERIODS.session);
        test(p.data.seven_day, PERIODS.weekly);
      } else if (acc.provider === "opencode") {
        test(p.data.rolling, PERIODS.rolling);
        test(p.data.weekly, PERIODS.weekly);
        test(p.data.monthly, PERIODS.monthly);
      }
    }

    if (behindCount > 0) {
      return { label: `${behindCount} Burning Fast · ${aheadCount} Ahead`, color: t.blocked };
    }
    if (onTrackCount > 0) {
      return { label: `${onTrackCount} On Track · ${aheadCount} Ahead`, color: t.working };
    }
    return { label: "All Pacing Healthy", color: t.done };
  }

  getEarliestReset() {
    let earliest = Infinity;
    const check = (iso) => {
      if (!iso) return;
      const t = Date.parse(iso);
      if (t > Date.now() && t < earliest) earliest = t;
    };

    for (const acc of this.accounts) {
      if (acc.enabled === false) continue;
      const p = this.accountData[acc.id];
      if (!p?.data) continue;
      check(p.data.five_hour?.resets_at);
      check(p.data.seven_day?.resets_at);
      check(p.data.rolling?.resets_at);
      check(p.data.weekly?.resets_at);
      check(p.data.monthly?.resets_at);
    }
    return earliest < Infinity ? countdown(earliest) : null;
  }

  getActiveAgentsFor(appKey) {
    const list = agents();
    return list.filter((a) => a.app === appKey || (appKey === "claude" && a.app === "claude-code"));
  }

  /**
   * Renders the Remaining Gauge with OpenUsage Pace Guide Line (Full Dashboard view)
   */
  renderPacedMetricRow(t, label, windowData, periodSeconds) {
    if (!windowData) return null;
    const used = clamp(windowData.utilization ?? 0);
    const resetsAt = windowData.resets_at;
    const pace = evaluatePace({
      used,
      limit: 100,
      resetsAt,
      periodSeconds,
      now: Date.now(),
    });

    const remaining = Math.round(pace.remainingPercent);
    const resetNote = countdown(resetsAt);

    let barColor = t.done;
    let badgeText = pace.statusText || `${remaining}% left`;
    let badgeTextColor = t.done;

    if (pace.status === "spent") {
      barColor = t.blocked;
      badgeTextColor = t.blocked;
      badgeText = "Limit reached";
    } else if (pace.status === "behind") {
      barColor = t.blocked;
      badgeTextColor = t.blocked;
      badgeText = pace.statusText;
    } else if (pace.status === "onTrack") {
      barColor = t.working;
      badgeTextColor = t.working;
      badgeText = pace.statusText;
    } else if (pace.status === "ahead") {
      barColor = t.done;
      badgeTextColor = t.done;
      badgeText = pace.statusText;
    } else {
      barColor = remaining <= 10 ? t.blocked : remaining <= 30 ? t.working : t.done;
      badgeTextColor = barColor;
      badgeText = `${remaining}% left`;
    }

    const guidePct = pace.guideRemainingPercent != null
      ? Math.round(clamp(pace.guideRemainingPercent, 1, 99))
      : null;

    return v_flex()
      .w_full()
      .gap(5)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .flex_wrap()
          .gap(4)
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().font_semibold().text_size(11.5).text_color(t.foreground).child(label))
              .when(Boolean(resetNote), (el) =>
                el.child(
                  div()
                    .px(5)
                    .py(1)
                    .rounded(3)
                    .bg(t.surface)
                    .border(1)
                    .border_color(t.border)
                    .text_size(10)
                    .text_color(t.muted)
                    .child(`↻ in ${resetNote}`)
                )
              )
          )
          .child(
            div()
              .px(6)
              .py(1)
              .rounded(3)
              .bg(t.surface)
              .border(1)
              .border_color(t.border)
              .text_size(10.5)
              .font_semibold()
              .text_color(badgeTextColor)
              .child(badgeText)
          )
      )
      .child(
        div()
          .relative()
          .w_full()
          .h(8)
          .rounded(4)
          .bg(t.border)
          .overflow_hidden()
          .flex_none()
          .child(
            div()
              .absolute()
              .left(0)
              .top(0)
              .h_full()
              .w(`${remaining}%`)
              .rounded(4)
              .bg(barColor)
          )
          .when(guidePct != null, (el) =>
            el.child(
              h_flex()
                .absolute()
                .inset_0()
                .child(div().w(`${guidePct}%`).h_full())
                .child(div().w(2).h_full().bg(t.foreground).opacity(0.85))
            )
          )
      )
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .text_size(10.5)
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(
                div()
                  .font_bold()
                  .text_color(badgeTextColor)
                  .child(`${remaining}% remaining`)
              )
              .when(guidePct != null, (el) =>
                el.child(
                  div()
                    .text_color(t.dim)
                    .child(`(Guide: ~${guidePct}% expected)`)
                )
              )
          )
          .child(
            div()
              .text_color(t.dim)
              .child(`${Math.round(used)}% used`)
          )
      );
  }

  /**
   * Renders a Single Multi-Account Card (Full Dashboard view)
   */
  renderAccountCard(t, account, cx) {
    const provMeta = PROVIDER_METAS[account.provider] ?? PROVIDER_METAS.antigravity;
    const state = this.accountData[account.id] ?? { data: null, at: 0, loading: false };
    const data = state.data;
    const activeAgents = this.getActiveAgentsFor(provMeta.app);
    const isStale = state.at > 0 && Date.now() - state.at > provMeta.stale;

    const rows = [];
    if (account.provider === "claude") {
      rows.push(this.renderPacedMetricRow(t, "5-Hour Session (5시간)", data?.five_hour, PERIODS.session));
      rows.push(this.renderPacedMetricRow(t, "7-Day Weekly (주간)", data?.seven_day, PERIODS.weekly));
    } else if (account.provider === "codex") {
      rows.push(this.renderPacedMetricRow(t, "5-Hour Session (5시간)", data?.five_hour, PERIODS.session));
      rows.push(this.renderPacedMetricRow(t, "7-Day Weekly (주간)", data?.seven_day, PERIODS.weekly));
    } else if (account.provider === "antigravity") {
      const bucketTitle = data?.bucket ?? "Gemini Models";
      if (data?.five_hour) rows.push(this.renderPacedMetricRow(t, `${bucketTitle} (5시간)`, data.five_hour, PERIODS.session));
      if (data?.seven_day) rows.push(this.renderPacedMetricRow(t, `${bucketTitle} (주간)`, data.seven_day, PERIODS.weekly));
      for (const b of data?.buckets ?? []) {
        if (b.five_hour || b.seven_day) {
          rows.push(div().pt(4).text_size(10.5).font_semibold().text_color(t.muted).child(b.name ?? "Other Models"));
          if (b.five_hour) rows.push(this.renderPacedMetricRow(t, "5-Hour (5시간)", b.five_hour, PERIODS.session));
          if (b.seven_day) rows.push(this.renderPacedMetricRow(t, "Weekly (주간)", b.seven_day, PERIODS.weekly));
        }
      }
    } else if (account.provider === "opencode") {
      if (data?.rolling) rows.push(this.renderPacedMetricRow(t, "Rolling Limit (24시간)", data.rolling, PERIODS.rolling));
      if (data?.weekly) rows.push(this.renderPacedMetricRow(t, "Weekly Limit (주간)", data.weekly, PERIODS.weekly));
      if (data?.monthly) rows.push(this.renderPacedMetricRow(t, "Monthly Limit (월간)", data.monthly, PERIODS.monthly));
    }

    return v_flex()
      .id(`acc-${account.id}`)
      .flex_1()
      .min_w(270)
      .bg(t.raised)
      .border(1)
      .border_color(t.border)
      .rounded(8)
      .p(14)
      .gap(12)
      .child(
        // Card Top Header
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(svg(provMeta.icon).size(18))
              .child(
                v_flex()
                  .gap(1)
                  .child(
                    h_flex()
                      .gap(6)
                      .items_center()
                      .child(div().font_bold().text_size(13).text_color(t.foreground).child(account.name))
                      .child(
                        div()
                          .px(5)
                          .py(1)
                          .rounded(3)
                          .bg(t.surface)
                          .border(1)
                          .border_color(t.border)
                          .text_size(9.5)
                          .text_color(t.dim)
                          .child(account.label || "Default")
                      )
                  )
              )
          )
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .when(isStale, (el) =>
                el.child(
                  div()
                    .px(6)
                    .py(2)
                    .rounded(4)
                    .bg(t.surface)
                    .border(1)
                    .border_color(t.border)
                    .text_size(10.5)
                    .text_color(t.dim)
                    .child("Stale")
                )
              )
              .child(
                div()
                  .p(4)
                  .rounded(4)
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => this.refreshAccount(account, cx, true))
                  .child(
                    state.loading
                      ? svg("mods/workspace-chrome/spinner.svg").size(14).spin(900)
                      : svg("mods/openusage/icons/refresh.svg").size(14)
                  )
              )
          )
      )
      // Active Herdr Agent Callout
      .when(activeAgents.length > 0, (el) =>
        el.child(
          h_flex()
            .px(8)
            .py(5)
            .rounded(5)
            .bg(t.surface)
            .border(1)
            .border_color(t.border)
            .items_center()
            .justify_between()
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .child(div().size(6).rounded(3).bg(t.working))
                .child(
                  div()
                    .text_size(11)
                    .text_color(t.foreground)
                    .child(`${activeAgents.length} active agent (${activeAgents.map((a) => a.terminal).join(", ")})`)
                )
            )
            .child(
              div()
                .cursor_pointer()
                .text_size(10.5)
                .text_color(t.accent)
                .on_click(() => {
                  if (activeAgents[0]?.terminal) run("agent.focus", { terminal: activeAgents[0].terminal });
                })
                .child("Focus →")
            )
        )
      )
      // Metric Gauges (5-Hour AND Weekly simultaneously)
      .child(
        v_flex()
          .gap(10)
          .children(rows.filter(Boolean))
      )
      // Card Footer
      .child(
        h_flex()
          .pt(4)
          .border_t(1)
          .border_color(t.border)
          .items_center()
          .justify_between()
          .text_size(10.5)
          .text_color(t.dim)
          .child(div().child(state.loading ? "Updating..." : `Updated ${timeAgo(state.at)}`))
          .when(Boolean(state.error), (el) =>
            el.child(div().text_color(t.blocked).truncate().child(`Error: ${state.error}`))
          )
      );
  }

  /**
   * Responsive Sidebar View: Adapts layout based on sidebar width
   * - Rail (< 140px): Ultra-compact icon strip with status dots & hover tooltips
   * - Narrow (140px ~ 230px): Compact stacked rows with short labels (5h, 7d)
   * - Standard (230px ~ 320px): Full stacked dual rows (5시간, 주간)
   * - Wide (>= 320px): Dual columns side-by-side (5시간 | 주간) on a single row!
   */
  renderSidebar(cx, t) {
    const sbWidth = this.sidebarWidth || getSidebarWidth();
    try { setShared("openusage.current_sbWidth", { sidebarWidth: this.sidebarWidth, sbWidth }); } catch {}
    const isRail = sbWidth < 140;
    const isNarrow = sbWidth >= 140 && sbWidth < 230;
    const isWide = sbWidth >= 320;
    const mode = isRail ? "rail" : isNarrow ? "narrow" : isWide ? "wide" : "standard";

    const overall = this.getOverallPacingSummary(t);
    const anyLoading = this.isAnyLoading();

    // 1. Ultra-Narrow Rail Mode (< 140px, e.g. 44px ~ 76px)
    if (isRail) {
      return v_flex()
        .size_full()
        .bg(t.chrome)
        .border_t(1)
        .border_color(t.border)
        .items_center()
        .py(6)
        .gap(8)
        .on_size_change((size, sizeCx) => {
          const w = Math.round(size.width);
          if (w > 0 && Math.abs(w - (this.sidebarWidth || 0)) >= 4) {
            this.sidebarWidth = w;
            sizeCx.notify();
          }
        })
        .child(
          div()
            .p(4)
            .rounded(4)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .tooltip("OpenUsage · Usages (Click to open)")
            .on_click(() => run("mod.open", { name: "openusage" }))
            .child(svg("mods/openusage/icons/openusage.svg").size(16).text_color(t.accent))
        )
        .child(
          v_flex()
            .flex_1()
            .overflow_y_scrollbar()
            .w_full()
            .items_center()
            .gap(6)
            .children(
              this.accounts
                .filter((acc) => acc.enabled !== false)
                .map((acc) => this.renderSidebarRailAccount(t, acc, cx))
            )
        );
    }

    // 2. Standard / Wide / Narrow Sidebar Modes
    return v_flex()
      .size_full()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(11)
      .on_size_change((size, sizeCx) => {
        const w = Math.round(size.width);
        if (w > 0 && Math.abs(w - (this.sidebarWidth || 0)) >= 4) {
          this.sidebarWidth = w;
          sizeCx.notify();
        }
      })
      // Responsive Sidebar Header
      .child(
        h_flex()
          .px(isNarrow ? 6 : 10)
          .py(isNarrow ? 4 : 6)
          .items_center()
          .justify_between()
          .border_b(1)
          .border_color(t.border)
          .child(
            h_flex()
              .gap(isNarrow ? 4 : 6)
              .items_center()
              .child(svg("mods/openusage/icons/openusage.svg").size(14).text_color(t.accent))
              .child(div().font_bold().text_size(isNarrow ? 10.5 : 11.5).child("Usages"))
              .child(div().size(6).rounded(3).bg(overall.color))
              .when(isWide, (el) =>
                el.child(
                  div()
                    .text_size(9)
                    .text_color(t.dim)
                    .child(`(${sbWidth}px · ${overall.label})`)
                )
              )
          )
          .child(
            h_flex()
              .gap(4)
              .items_center()
              .child(
                div()
                  .p(2.5)
                  .rounded(3)
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover))
                  .tooltip("Refresh usage")
                  .on_click((_e, cx) => this.refreshAll(cx))
                  .child(
                    anyLoading
                      ? svg("mods/workspace-chrome/spinner.svg").size(12).spin(900)
                      : svg("mods/openusage/icons/refresh.svg").size(12)
                  )
              )
              .child(
                div()
                  .px(isNarrow ? 4 : 6)
                  .py(2)
                  .rounded(3)
                  .cursor_pointer()
                  .text_size(isNarrow ? 9.5 : 10)
                  .text_color(t.muted)
                  .hover((s) => s.bg(t.hover))
                  .on_click(() => run("mod.open", { name: "openusage" }))
                  .child(isNarrow ? "↗" : "↗ Open")
              )
          )
      )
      // Accounts List (Responsive)
      .child(
        v_flex()
          .flex_1()
          .overflow_y_scrollbar()
          .p(isNarrow ? 4 : 6)
          .gap(isNarrow ? 4 : 6)
          .children(
            this.accounts
              .filter((acc) => acc.enabled !== false)
              .map((acc) => this.renderSidebarAccountRow(t, acc, cx, mode))
          )
      );
  }

  /**
   * Ultra-compact rail icon for sidebar width < 140px.
   * Rendered in the style of "iPhone Duo" battery/network widget:
   * - Top: 5h remaining % (OpenCode: 24h remaining %) with matching gauge color
   * - Center: Official Provider Vector Logo (OpenAI ChatGPT, Claude, Antigravity, OpenCode)
   * - Circular Arc: Decreases along the single continuous arch (7 o'clock -> 12 o'clock -> 5 o'clock)
   * - Bottom: 7d remaining % with matching weekly color
   */
  renderSidebarRailAccount(t, acc, cx) {
    const provMeta = PROVIDER_METAS[acc.provider] ?? PROVIDER_METAS.antigravity;
    const state = this.accountData[acc.id] ?? { data: null };
      const data = state.data;

      const isOpenCode = acc.provider === "opencode";

      let topPercent = null;
      let bottomPercent = null;
      let topGuidePct = null;
      let botGuidePct = null;
      let topStatus = "ahead";
      let bottomStatus = "ahead";
      const summaries = [];

      if (data) {
        if (isOpenCode) {
          // OpenCode: Top is 24h (rolling), Bottom is 7d (weekly)
          const w24 = data.rolling;
          if (w24) {
            const pace24 = evaluatePace({
              used: w24.utilization ?? 0,
              resetsAt: w24.resets_at,
              periodSeconds: PERIODS.rolling,
            });
            topPercent = Math.round(pace24.remainingPercent);
            topStatus = pace24.status;
            if (pace24.guideRemainingPercent != null) {
              topGuidePct = Math.round(clamp(pace24.guideRemainingPercent, 0, 100));
            }
            summaries.push(`• 24h: 잔여 ${topPercent}% (${countdown(w24.resets_at) || "idle"})`);
          }
        } else {
          // Claude, Codex, Antigravity: Top is 5h
          const w5 = data.five_hour || (data.buckets?.[0]?.five_hour);
          if (w5) {
            const pace5 = evaluatePace({
              used: w5.utilization ?? 0,
              resetsAt: w5.resets_at,
              periodSeconds: PERIODS.session,
            });
            topPercent = Math.round(pace5.remainingPercent);
            topStatus = pace5.status;
            if (pace5.guideRemainingPercent != null) {
              topGuidePct = Math.round(clamp(pace5.guideRemainingPercent, 0, 100));
            }
            summaries.push(`• 5시간: 잔여 ${topPercent}% (${countdown(w5.resets_at) || "idle"})`);
          }
        }

        // Bottom is always 7d (weekly)
        const w7 = data.seven_day || data.weekly || (data.buckets?.[0]?.seven_day) || (data.buckets?.[0]?.weekly);
        if (w7) {
          const pace7 = evaluatePace({
            used: w7.utilization ?? 0,
            resetsAt: w7.resets_at,
            periodSeconds: PERIODS.weekly,
          });
          bottomPercent = Math.round(pace7.remainingPercent);
          bottomStatus = pace7.status;
          if (pace7.guideRemainingPercent != null) {
            botGuidePct = Math.round(clamp(pace7.guideRemainingPercent, 0, 100));
          }
          summaries.push(`• 주간(7d): 잔여 ${bottomPercent}% (${countdown(w7.resets_at) || "idle"})`);
        }
      }

      // Fallbacks if data not yet loaded
      if (topPercent === null) {
        topPercent = 50;
        topStatus = "idle";
      }
      if (bottomPercent === null) {
        bottomPercent = 50;
        bottomStatus = "idle";
      }

      // If 7d / weekly is 0% remaining, 5h quota is unavailable / meaningless -> treat as 0% gray
      const is7dExhausted = bottomPercent !== null && bottomPercent <= 0;
      if (is7dExhausted) {
        topPercent = 0;
        topStatus = "spent";
      }

      // Top text & Gauge Color (5h / 24h)
      const topColor = is7dExhausted
        ? (t.dim || "#71717a")
        : (topPercent <= 20 || topStatus === "spent")
          ? "#ef4444"
          : (topPercent <= 50 || topStatus === "behind")
            ? "#f59e0b"
            : "#3b82f6";

      // Bottom text Color (7d)
      const bottomColor = (bottomPercent <= 20 || bottomStatus === "spent")
        ? "#ef4444"
        : (bottomPercent <= 50 || bottomStatus === "behind")
          ? "#f59e0b"
          : "#3b82f6";

      const topLabel = isOpenCode ? "24h" : "5h";

      // Pre-generated discrete PNGs (Status-Trio Upper & Lower Arcs)
      const pTopInt = Number.isFinite(topPercent) ? Math.max(0, Math.min(100, Math.round(topPercent))) : 50;
      const pBotInt = Number.isFinite(bottomPercent) ? Math.max(0, Math.min(100, Math.round(bottomPercent))) : 50;
      const upperPngPath = `mods/openusage/cache/upper-${pTopInt}.png`;
      const lowerPngPath = `mods/openusage/cache/lower-${pBotInt}.png`;

      const tip = [
        `${acc.name} (${acc.label || "Default"})`,
        `• ${topLabel} 잔여: ${topPercent}%${topGuidePct !== null ? ` (가이드: ${topGuidePct}%)` : ""}${is7dExhausted ? " (주간 소진으로 비활성)" : ""}`,
        `• 7d 잔여: ${bottomPercent}%${botGuidePct !== null ? ` (가이드: ${botGuidePct}%)` : ""}`,
        ...summaries.filter((s) => !s.includes(topLabel) && !s.includes("7d")),
        "클릭하여 전체 사용량 열기",
      ].join("\n");

      return div()
        .id(`rail-acc-${acc.id}`)
        .w(48)
        .h(48)
        .relative()
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .rounded(8)
        .tooltip(tip)
        .on_click(() => run("mod.open", { name: "openusage" }))
        // Pure Status-Trio Dual Arc Gauge: 40x40 (Minimal Icon Widget with Pace Marks)
        .child(
          div()
            .relative()
            .size(40)
            // 1. Upper Arch Gauge (PNG)
            .child(
              div()
                .absolute()
                .inset_0()
                .child(image(upperPngPath).w(40).h(40))
            )
            // 2. Upper Pace Guideline Tick (PNG)
            .when(topGuidePct !== null && !is7dExhausted, (el) =>
              el.child(
                div()
                  .absolute()
                  .inset_0()
                  .child(image(`mods/openusage/cache/upper-tick-${topGuidePct}.png`).w(40).h(40))
              )
            )
            // 3. Lower Cradle Gauge (PNG)
            .child(
              div()
                .absolute()
                .inset_0()
                .child(image(lowerPngPath).w(40).h(40))
            )
            // 4. Lower Pace Guideline Tick (PNG)
            .when(botGuidePct !== null && !is7dExhausted, (el) =>
              el.child(
                div()
                  .absolute()
                  .inset_0()
                  .child(image(`mods/openusage/cache/lower-tick-${botGuidePct}.png`).w(40).h(40))
              )
            )
            // 5. Center Provider Logo (e.g. OpenAI white flower, Claude, Antigravity, OpenCode)
            .child(
              div()
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_center()
                .child(svg(provMeta.icon).size(18).text_color(is7dExhausted ? t.dim : t.foreground))
            )
        );
  }

  /**
   * Compact mini gauge row for the sidebar & small screens (shows label, remaining bar, pace marker, % and reset note)
   */
  renderSidebarWindowGauge(t, label, windowData, periodSeconds, compact = false, forceExhausted = false) {
    const isAvailable = Boolean(windowData);
    const used = forceExhausted ? 100 : (isAvailable ? clamp(windowData.utilization ?? 0) : 0);
    const resetsAt = isAvailable ? windowData.resets_at : null;
    const pace = isAvailable ? evaluatePace({ used, resetsAt, periodSeconds }) : null;
    const rem = forceExhausted ? 0 : (pace ? Math.round(pace.remainingPercent) : null);
    const resetNote = countdown(resetsAt) || (isAvailable ? "idle" : "—");

    let dotColor = t.dim;
    if (forceExhausted) {
      dotColor = t.dim;
    } else if (pace) {
      if (pace.status === "spent" || pace.status === "behind") dotColor = t.blocked;
      else if (pace.status === "onTrack") dotColor = t.working;
      else if (pace.status === "ahead" || pace.status === "healthy") dotColor = t.done;
      else dotColor = rem <= 15 ? t.blocked : rem <= 35 ? t.working : t.done;
    }

    const guidePct = !forceExhausted && pace?.guideRemainingPercent != null
      ? Math.round(clamp(pace.guideRemainingPercent, 1, 99))
      : null;

    // Minimum 4px indicator if 0% remaining so an exhausted meter never looks like an empty/missing bar
    const barWidth = rem != null ? (rem <= 0 ? (forceExhausted ? 0 : 4) : `${rem}%`) : 0;

    const labelW = compact ? 28 : 46;
    const remW = compact ? 26 : 28;
    const resetW = compact ? 28 : 34;

    return h_flex()
      .gap(compact ? 4 : 5)
      .items_center()
      .flex_1()
      .min_w(0)
      // Window Label: e.g. "5시간", "주간", "5h", "7d", etc.
      .child(
        div()
          .w(labelW)
          .flex_none()
          .text_size(compact ? 8.5 : 9)
          .font_medium()
          .text_color(t.muted)
          .truncate()
          .child(label)
      )
      // Remaining Gauge Bar with Linear Pace Guide Line
      .child(
        div()
          .relative()
          .flex_1()
          .h(compact ? 4 : 5)
          .rounded(2.5)
          .bg(t.border)
          .overflow_hidden()
          .when(rem != null, (el) =>
            el.child(
              div()
                .absolute()
                .left(0)
                .top(0)
                .h_full()
                .w(barWidth)
                .rounded(2.5)
                .bg(dotColor)
            )
          )
          .when(guidePct != null, (el) =>
            el.child(
              h_flex()
                .absolute()
                .inset_0()
                .child(div().w(`${guidePct}%`).h_full())
                .child(div().w(1.5).h_full().bg(t.foreground).opacity(0.85))
            )
          )
      )
      // Percentage (Remaining %)
      .child(
        div()
          .w(remW)
          .flex_none()
          .text_right()
          .font_bold()
          .text_size(compact ? 8.5 : 9.5)
          .text_color(dotColor)
          .child(rem != null ? `${rem}%` : "--%")
      )
      // Reset Countdown
      .child(
        div()
          .w(resetW)
          .flex_none()
          .text_right()
          .text_size(8)
          .text_color(t.dim)
          .truncate()
          .child(resetNote)
      );
  }

  renderSidebarAccountRow(t, acc, cx, mode = "standard") {
    const provMeta = PROVIDER_METAS[acc.provider] ?? PROVIDER_METAS.antigravity;
    const state = this.accountData[acc.id] ?? { data: null };
    const data = state.data;
    const isNarrow = mode === "narrow";
    const isWide = mode === "wide";

    // Determine overall account dot color (most critical status)
    let overallDot = t.done;
    let worstPaceStatus = "ahead";
    if (data) {
      const checkPace = (w, period) => {
        if (!w) return;
        const res = evaluatePace({ used: w.utilization ?? 0, resetsAt: w.resets_at, periodSeconds: period });
        if (res.status === "spent" || res.status === "behind") {
          overallDot = t.blocked;
          worstPaceStatus = "behind";
        } else if (res.status === "onTrack" && overallDot !== t.blocked) {
          overallDot = t.working;
          if (worstPaceStatus !== "behind") worstPaceStatus = "onTrack";
        }
      };
      if (data.five_hour) checkPace(data.five_hour, PERIODS.session);
      if (data.seven_day) checkPace(data.seven_day, PERIODS.weekly);
      if (data.rolling) checkPace(data.rolling, PERIODS.rolling);
      if (data.monthly) checkPace(data.monthly, PERIODS.monthly);
      for (const b of data.buckets ?? []) {
        if (b.five_hour) checkPace(b.five_hour, PERIODS.session);
        if (b.seven_day) checkPace(b.seven_day, PERIODS.weekly);
      }
    }

    const is7dExhausted = acc.provider === "opencode"
      ? ((data?.weekly?.utilization ?? 0) >= 100)
      : ((data?.seven_day?.utilization ?? 0) >= 100);

    // Helper to render dual meters side-by-side in 2 columns (Wide mode >= 320px)
    const renderDualSideBySide = (label1, data1, period1, label2, data2, period2, forceExhausted1 = false) => {
      return h_flex()
        .w_full()
        .gap(6)
        .items_center()
        .child(this.renderSidebarWindowGauge(t, label1, data1, period1, true, forceExhausted1))
        .child(div().w(1).h(10).bg(t.border).opacity(0.8))
        .child(this.renderSidebarWindowGauge(t, label2, data2, period2, true));
    };

    const windowElements = [];

    if (isWide) {
      // In Wide mode (>= 320px), place 5시간 & 주간 SIDE-BY-SIDE in 2 columns!
      if (acc.provider === "claude") {
        windowElements.push(renderDualSideBySide("5시간", data?.five_hour, PERIODS.session, "주간", data?.seven_day, PERIODS.weekly, is7dExhausted));
      } else if (acc.provider === "codex") {
        windowElements.push(renderDualSideBySide("5시간", data?.five_hour, PERIODS.session, "주간", data?.seven_day, PERIODS.weekly, is7dExhausted));
      } else if (acc.provider === "antigravity") {
        windowElements.push(renderDualSideBySide("Gem 5h", data?.five_hour, PERIODS.session, "Gem 주간", data?.seven_day, PERIODS.weekly, is7dExhausted));
        const altBucket = data?.buckets?.find((b) => b.five_hour || b.seven_day);
        if (altBucket) {
          const alt7dExhausted = (altBucket.seven_day?.utilization ?? 0) >= 100;
          windowElements.push(renderDualSideBySide("Cld 5h", altBucket.five_hour, PERIODS.session, "Cld 주간", altBucket.seven_day, PERIODS.weekly, alt7dExhausted));
        }
      } else if (acc.provider === "opencode") {
        windowElements.push(renderDualSideBySide("24h", data?.rolling, PERIODS.rolling, "주간", data?.weekly, PERIODS.weekly, is7dExhausted));
        if (data?.monthly) {
          windowElements.push(this.renderSidebarWindowGauge(t, "월간", data.monthly, PERIODS.monthly, false));
        }
      } else {
        windowElements.push(renderDualSideBySide("5시간", data?.five_hour, PERIODS.session, "주간", data?.seven_day, PERIODS.weekly, is7dExhausted));
      }
    } else {
      // In Standard (< 320px) and Narrow (< 230px) modes: stacked 2-row layout
      const l5h = isNarrow ? "5h" : "5시간";
      const lWk = isNarrow ? "7d" : "주간";
      const lG5h = isNarrow ? "G-5h" : "Gem 5h";
      const lGWk = isNarrow ? "G-7d" : "Gem 주간";
      const lC5h = isNarrow ? "C-5h" : "Cld 5h";
      const lCWk = isNarrow ? "C-7d" : "Cld 주간";
      const l24h = isNarrow ? "24h" : "24h";
      const lMo = isNarrow ? "월" : "월간";

      if (acc.provider === "claude") {
        windowElements.push(this.renderSidebarWindowGauge(t, l5h, data?.five_hour, PERIODS.session, isNarrow, is7dExhausted));
        windowElements.push(this.renderSidebarWindowGauge(t, lWk, data?.seven_day, PERIODS.weekly, isNarrow));
      } else if (acc.provider === "codex") {
        windowElements.push(this.renderSidebarWindowGauge(t, l5h, data?.five_hour, PERIODS.session, isNarrow, is7dExhausted));
        windowElements.push(this.renderSidebarWindowGauge(t, lWk, data?.seven_day, PERIODS.weekly, isNarrow));
      } else if (acc.provider === "antigravity") {
        windowElements.push(this.renderSidebarWindowGauge(t, lG5h, data?.five_hour, PERIODS.session, isNarrow, is7dExhausted));
        windowElements.push(this.renderSidebarWindowGauge(t, lGWk, data?.seven_day, PERIODS.weekly, isNarrow));
        const altBucket = data?.buckets?.find((b) => b.five_hour || b.seven_day);
        if (altBucket) {
          const alt7dExhausted = (altBucket.seven_day?.utilization ?? 0) >= 100;
          if (altBucket.five_hour) windowElements.push(this.renderSidebarWindowGauge(t, lC5h, altBucket.five_hour, PERIODS.session, isNarrow, alt7dExhausted));
          if (altBucket.seven_day) windowElements.push(this.renderSidebarWindowGauge(t, lCWk, altBucket.seven_day, PERIODS.weekly, isNarrow));
        }
      } else if (acc.provider === "opencode") {
        windowElements.push(this.renderSidebarWindowGauge(t, l24h, data?.rolling, PERIODS.rolling, isNarrow, is7dExhausted));
        windowElements.push(this.renderSidebarWindowGauge(t, lWk, data?.weekly, PERIODS.weekly, isNarrow));
        if (data?.monthly) windowElements.push(this.renderSidebarWindowGauge(t, lMo, data.monthly, PERIODS.monthly, isNarrow));
      } else {
        windowElements.push(this.renderSidebarWindowGauge(t, l5h, data?.five_hour, PERIODS.session, isNarrow, is7dExhausted));
        windowElements.push(this.renderSidebarWindowGauge(t, lWk, data?.seven_day, PERIODS.weekly, isNarrow));
      }
    }

    const badgeLabel = worstPaceStatus === "behind" ? "Burning Fast" : worstPaceStatus === "onTrack" ? "On Track" : "Ahead";

    return v_flex()
      .p(isNarrow ? 5 : isWide ? 8 : 7)
      .gap(isNarrow ? 3 : 5)
      .rounded(6)
      .bg(t.surface)
      .border(1)
      .border_color(t.border)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("mod.open", { name: "openusage" }))
      // Card Header: Icon + Name + Dot
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(5)
              .items_center()
              .child(svg(provMeta.icon).size(isNarrow ? 12 : 13))
              .child(
                div()
                  .font_semibold()
                  .text_size(isNarrow ? 9.5 : 10.5)
                  .truncate()
                  .child(acc.label ? `${acc.name} (${acc.label})` : acc.name)
              )
          )
          .child(
            h_flex()
              .gap(4)
              .items_center()
              .when(isWide, (el) =>
                el.child(
                  div()
                    .px(4)
                    .py(1)
                    .rounded(3)
                    .bg(t.raised)
                    .text_size(9)
                    .font_semibold()
                    .text_color(overallDot)
                    .child(badgeLabel)
                )
              )
              .child(div().size(5).rounded(3).bg(overallDot))
          )
      )
      // Dual Gauges: Side-by-side on wide sidebars, stacked on standard/narrow
      .child(
        v_flex()
          .gap(isNarrow ? 2.5 : 3.5)
          .children(windowElements.filter(Boolean))
      );
  }

  /**
   * Settings & Multi-Account Management Screen
   */
  renderSettings(cx, t) {
    return v_flex()
      .size_full()
      .bg(t.canvas)
      .text_color(t.foreground)
      .text_size(12)
      // Top Settings Bar
      .child(
        h_flex()
          .px(18)
          .py(12)
          .bg(t.chrome)
          .border_b(1)
          .border_color(t.border)
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(10)
              .items_center()
              .child(
                div()
                  .px(8)
                  .py(4)
                  .rounded(4)
                  .bg(t.raised)
                  .border(1)
                  .border_color(t.border)
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover))
                  .on_click(() => {
                    this.viewMode = "dashboard";
                    cx.notify();
                  })
                  .child("← Back to Dashboard")
              )
              .child(div().font_bold().text_size(15).child("OpenUsage Settings & Accounts"))
          )
          .child(
            div()
              .px(8)
              .py(4)
              .rounded(4)
              .text_color(t.muted)
              .child("Config: ~/.config/herdr-app/openusage-accounts.json")
          )
      )
      // Settings Body
      .child(
        v_flex()
          .flex_1()
          .overflow_y_scrollbar()
          .p(20)
          .gap(20)
          // Section 1: Configured Multi-Accounts
          .child(
            v_flex()
              .gap(10)
              .child(
                h_flex()
                  .items_center()
                  .justify_between()
                  .child(div().font_bold().text_size(13).child("Configured Accounts (등록된 계정 목록)"))
                  .child(div().text_size(11).text_color(t.dim).child(`${this.accounts.length} accounts configured`))
              )
              .child(
                v_flex()
                  .gap(8)
                  .children(
                    this.accounts.map((acc) =>
                      h_flex()
                        .p(12)
                        .rounded(6)
                        .bg(t.raised)
                        .border(1)
                        .border_color(t.border)
                        .items_center()
                        .justify_between()
                        .child(
                          h_flex()
                            .gap(10)
                            .items_center()
                            .child(svg(PROVIDER_METAS[acc.provider]?.icon ?? "mods/openusage/icons/openai.svg").size(18))
                            .child(
                              v_flex()
                                .gap(2)
                                .child(
                                  h_flex()
                                    .gap(6)
                                    .items_center()
                                    .child(div().font_semibold().text_size(12.5).child(acc.name))
                                    .child(
                                      div()
                                        .px(5)
                                        .py(1)
                                        .rounded(3)
                                        .bg(t.surface)
                                        .border(1)
                                        .border_color(t.border)
                                        .text_size(10)
                                        .child(acc.label || "Default")
                                    )
                                )
                                .child(
                                  div()
                                    .text_size(10.5)
                                    .text_color(t.dim)
                                    .child(
                                      acc.authType === "keychain"
                                        ? `Keychain: ${acc.keychainService}`
                                        : acc.authType === "auth_file"
                                        ? `Path: ${acc.authPath}`
                                        : "Default CLI integration"
                                    )
                                )
                            )
                        )
                        .child(
                          h_flex()
                            .gap(8)
                            .items_center()
                            .child(
                              div()
                                .px(8)
                                .py(4)
                                .rounded(4)
                                .cursor_pointer()
                                .bg(acc.enabled !== false ? t.surface : t.border)
                                .border(1)
                                .border_color(t.border)
                                .hover((s) => s.bg(t.hover))
                                .on_click((_e, cx) => this.toggleAccount(acc.id, cx))
                                .child(acc.enabled !== false ? "● Enabled" : "○ Disabled")
                            )
                            .child(
                              div()
                                .px(8)
                                .py(4)
                                .rounded(4)
                                .cursor_pointer()
                                .text_color(t.blocked)
                                .hover((s) => s.bg(t.hover))
                                .on_click((_e, cx) => this.deleteAccount(acc.id, cx))
                                .child("Delete")
                            )
                        )
                    )
                  )
              )
          )
          // Section 2: Add New Account Presets
          .child(
            v_flex()
              .gap(10)
              .child(div().font_bold().text_size(13).child("Add Account (계정 추가)"))
              .child(
                div()
                  .text_size(11)
                  .text_color(t.dim)
                  .child("원하는 프로바이더의 계정을 추가하여 여러 계정의 사용량을 동시에 모니터링할 수 있습니다.")
              )
              .child(
                h_flex()
                  .gap(10)
                  .flex_wrap()
                  .child(
                    div()
                      .px(12)
                      .py(8)
                      .rounded(6)
                      .bg(t.raised)
                      .border(1)
                      .border_color(t.border)
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover))
                      .on_click((_e, cx) => this.addAccountPreset("claude", "Personal", "Claude Code-credentials-personal", cx))
                      .child("+ Add Claude (Personal)")
                  )
                  .child(
                    div()
                      .px(12)
                      .py(8)
                      .rounded(6)
                      .bg(t.raised)
                      .border(1)
                      .border_color(t.border)
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover))
                      .on_click((_e, cx) => this.addAccountPreset("codex", "Work", "~/.codex-work/auth.json", cx))
                      .child("+ Add Codex (Work auth.json)")
                  )
                  .child(
                    div()
                      .px(12)
                      .py(8)
                      .rounded(6)
                      .bg(t.raised)
                      .border(1)
                      .border_color(t.border)
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover))
                      .on_click((_e, cx) => this.addAccountPreset("antigravity", "Team", null, cx))
                      .child("+ Add Antigravity Profile")
                  )
                  .child(
                    div()
                      .px(12)
                      .py(8)
                      .rounded(6)
                      .bg(t.raised)
                      .border(1)
                      .border_color(t.border)
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover))
                      .on_click((_e, cx) => this.addAccountPreset("opencode", "Work", null, cx))
                      .child("+ Add OpenCode Profile")
                  )
              )
          )
          // Section 3: Performance & Cache Info
          .child(
            v_flex()
              .p(14)
              .rounded(8)
              .bg(t.raised)
              .border(1)
              .border_color(t.border)
              .gap(6)
              .child(div().font_semibold().text_size(12).child("캐싱 및 새로고침 방지 안내"))
              .child(
                div()
                  .text_size(11)
                  .text_color(t.muted)
                  .child("최근 60초 이내에 갱신된 데이터가 있으면 'Open'을 누르거나 창을 열 때마다 재호출되지 않고 즉시 캐시된 데이터를 표시합니다. 최신 데이터를 강제로 받아오려면 'Refresh' 버튼을 누르면 됩니다.")
              )
          )
      );
  }

  render(cx) {
    const t = theme();
    const isSidebarRole = props()?.role === "sidebar";

    if (isSidebarRole) {
      return this.renderSidebar(cx, t);
    }

    if (this.viewMode === "settings") {
      return this.renderSettings(cx, t);
    }

    const overallPacing = this.getOverallPacingSummary(t);
    const earliestReset = this.getEarliestReset();
    const allAgents = agents();
    const isOverlay = Boolean(props()?.overlay);
    const anyLoading = this.isAnyLoading();

    return v_flex()
      .size_full()
      .bg(t.canvas)
      .text_color(t.foreground)
      .text_size(12)
      // Top Navigation / Header Bar
      .child(
        h_flex()
          .px(18)
          .py(12)
          .bg(t.chrome)
          .border_b(1)
          .border_color(t.border)
          .items_center()
          .justify_between()
          .child(
            // Left: Logo & Title
            h_flex()
              .gap(10)
              .items_center()
              .child(svg("mods/openusage/icons/openusage.svg").size(22).text_color(t.accent))
              .child(
                v_flex()
                  .gap(1)
                  .child(
                    h_flex()
                      .gap(6)
                      .items_center()
                      .child(div().font_bold().text_size(15).child("OpenUsage"))
                      .child(
                        div()
                          .px(5)
                          .py(1)
                          .rounded(3)
                          .bg(t.raised)
                          .text_size(10)
                          .text_color(t.muted)
                          .child("Multi-Account Pace Tracker")
                      )
                  )
                  .child(
                    div()
                      .text_size(11)
                      .text_color(t.dim)
                      .child("Remaining quota vs linear pace across accounts (5-Hour & Weekly simultaneous)")
                  )
              )
          )
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(
                h_flex()
                  .id("btn-settings")
                  .px(10)
                  .py(5)
                  .rounded(5)
                  .bg(t.raised)
                  .border(1)
                  .border_color(t.border)
                  .gap(6)
                  .items_center()
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover))
                  .on_click(() => {
                    this.viewMode = "settings";
                    cx.notify();
                  })
                  .child(div().text_size(11.5).font_semibold().child("⚙ Settings / Accounts"))
              )
              .child(
                h_flex()
                  .id("btn-refresh-all")
                  .px(10)
                  .py(5)
                  .rounded(5)
                  .bg(t.raised)
                  .border(1)
                  .border_color(t.border)
                  .gap(6)
                  .items_center()
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => this.refreshAll(cx))
                  .child(
                    anyLoading
                      ? svg("mods/workspace-chrome/spinner.svg").size(13).spin(900)
                      : svg("mods/openusage/icons/refresh.svg").size(13)
                  )
                  .child(div().text_size(11.5).font_semibold().child(anyLoading ? "Refreshing..." : "Refresh"))
              )
              .when(isOverlay, (el) =>
                el.child(
                  div()
                    .id("btn-close-overlay")
                    .px(8)
                    .py(4)
                    .rounded(4)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover))
                    .on_click(() => {
                      if (props()?.overlay) closeOverlay(props().overlay);
                    })
                    .child("✕ Close")
                )
              )
          )
      )
      // Visual Pacing Guide Legend Strip
      .child(
        h_flex()
          .px(18)
          .py(7)
          .bg(t.surface)
          .border_b(1)
          .border_color(t.border)
          .justify_between()
          .items_center()
          .flex_wrap()
          .gap(8)
          .child(
            h_flex()
              .gap(16)
              .items_center()
              .flex_wrap()
              .child(
                h_flex()
                  .gap(6)
                  .items_center()
                  .child(div().size(6).rounded(3).bg(overallPacing.color))
                  .child(div().text_size(11).font_semibold().text_color(overallPacing.color).child(overallPacing.label))
              )
              .child(
                h_flex()
                  .gap(6)
                  .items_center()
                  .child(div().size(6).rounded(3).bg(allAgents.length > 0 ? t.working : t.dim))
                  .child(div().text_size(11).text_color(t.muted).child(`${allAgents.length} Herdr Agents Active`))
              )
              .when(Boolean(earliestReset), (el) =>
                el.child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .child(div().size(6).rounded(3).bg(t.accent))
                    .child(div().text_size(11).text_color(t.muted).child(`Next Reset in ${earliestReset}`))
                )
              )
          )
          .child(
            h_flex()
              .gap(12)
              .items_center()
              .text_size(10.5)
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .child(div().w(2).h(10).bg(t.foreground).opacity(0.85))
                  .child(div().text_color(t.dim).child("Pace Guide (|)"))
              )
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .child(div().size(6).rounded(3).bg(t.done))
                  .child(div().text_color(t.dim).child("Ahead (안전)"))
              )
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .child(div().size(6).rounded(3).bg(t.working))
                  .child(div().text_color(t.dim).child("On Track (적정)"))
              )
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .child(div().size(6).rounded(3).bg(t.blocked))
                  .child(div().text_color(t.dim).child("Burning Fast (초과 위험)"))
              )
          )
      )
      // Main Body: Configured Accounts Cards Grid (Showing 5-Hour and Weekly simultaneously)
      .child(
        v_flex()
          .flex_1()
          .overflow_y_scrollbar()
          .p(16)
          .gap(14)
          .child(
            h_flex()
              .flex_wrap()
              .gap(14)
              .children(
                this.accounts
                  .filter((acc) => acc.enabled !== false)
                  .map((acc) => this.renderAccountCard(t, acc, cx))
              )
          )
      );
  }
}
