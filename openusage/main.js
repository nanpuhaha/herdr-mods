import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, theme, run, exec, appHome, props, closeOverlay } from "herdr";

const PROVIDERS = {
  claude: {
    name: "Claude Code",
    script: "helpers/claude.py",
    icon: "icons/claude.svg",
    color: "#d97757",
    poll: 300_000,
    stale: 10 * 60_000,
    app: "claude",
  },
  codex: {
    name: "OpenAI Codex",
    script: "helpers/codex.py",
    icon: "icons/codex.svg",
    color: "#10a37f",
    poll: 120_000,
    stale: 10 * 60_000,
    app: "codex",
  },
  antigravity: {
    name: "Google Antigravity",
    script: "helpers/antigravity.py",
    icon: "icons/antigravity.svg",
    color: "#4285f4",
    poll: 600_000,
    stale: 20 * 60_000,
    app: "antigravity",
  },
  opencode: {
    name: "OpenCode",
    script: "helpers/opencode.py",
    icon: "icons/opencode.svg",
    color: "#8b5cf6",
    poll: 120_000,
    stale: 10 * 60_000,
    app: "opencode",
  },
};

// Known window durations in seconds
const PERIODS = {
  session: 5 * 3600,       // 5 hours = 18,000s
  weekly: 7 * 24 * 3600,   // 7 days = 604,800s
  monthly: 30 * 24 * 3600, // 30 days = 2,592,000s
  rolling: 24 * 3600,      // 24 hours = 86,400s
};

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

/**
 * OpenUsage (robinebers/openusage) Pace Algorithm implementation.
 * Evaluates constant-rate burn guidance and projected status at window reset.
 */
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
  // Expected remaining percentage if spent at a completely linear rate
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

  // OpenUsage projection: projected = used / elapsed * periodDuration
  const projectedUsed = (used / elapsedMs) * periodMs;
  const projectedFraction = projectedUsed / limit;
  const projectedUsagePercent = Math.round(projectedFraction * 100);

  let status = "ahead";
  let statusText = "";
  let isAhead = true;

  if (projectedUsed > limit) {
    // Behind pace: Burning faster than linear guide (조기 소진 위험)
    status = "behind";
    isAhead = false;
    const overPercent = Math.max(1, Math.round((projectedFraction - 1) * 100));
    statusText = `~${overPercent}% over limit at reset`;
  } else if (projectedUsed > limit * 0.9) {
    // On track: Close to limit at reset (90-100% projected)
    status = "onTrack";
    isAhead = false;
    statusText = `~${projectedUsagePercent}% used at reset`;
  } else {
    // Ahead: Burning slower than linear guide, comfortable remaining quota
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
    this.providers = {};
    for (const key of Object.keys(PROVIDERS)) {
      this.providers[key] = {
        data: null,
        at: 0,
        loading: false,
        error: null,
        warning: null,
      };
      // Schedule background periodic poll
      cx.timer.every(PROVIDERS[key].poll, (cx) => this.refresh(key, cx));
    }

    // Refresh countdowns & relative timestamps every 30s
    cx.timer.every(30_000, (cx) => cx.notify());

    // Initial fetch for all providers
    for (const key of Object.keys(PROVIDERS)) {
      this.refresh(key, cx);
    }
  }

  refresh(key, cx) {
    const prov = this.providers[key];
    if (!prov || prov.loading) return;
    prov.loading = true;
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        const scriptPath = `${appHome()}/mods/openusage/${PROVIDERS[key].script}`;
        const res = await exec("python3", [scriptPath]);
        if (res.code !== 0) {
          throw new Error(res.stderr.trim() || `Script exited with code ${res.code}`);
        }
        const data = JSON.parse(res.stdout);
        if (!data.ok) {
          throw new Error(data.error || "Fetch returned unsuccessful response");
        }
        prov.data = data;
        prov.at = data.fetched_at ? data.fetched_at * 1000 : Date.now();
        prov.error = null;
        prov.warning = data.warning ?? null;
      } catch (err) {
        prov.error = String(err?.message ?? err);
      } finally {
        prov.loading = false;
        cx.notify();
      }
    });
  }

  refreshAll(cx) {
    for (const key of Object.keys(PROVIDERS)) {
      this.refresh(key, cx);
    }
  }

  isAnyLoading() {
    return Object.values(this.providers).some((p) => p.loading);
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

    const p = this.providers;
    if (p.claude.data) {
      test(p.claude.data.five_hour, PERIODS.session);
      test(p.claude.data.seven_day, PERIODS.weekly);
    }
    if (p.codex.data) {
      test(p.codex.data.five_hour, PERIODS.session);
      test(p.codex.data.seven_day, PERIODS.weekly);
    }
    if (p.antigravity.data) {
      test(p.antigravity.data.five_hour, PERIODS.session);
      test(p.antigravity.data.seven_day, PERIODS.weekly);
    }
    if (p.opencode.data) {
      test(p.opencode.data.rolling, PERIODS.rolling);
      test(p.opencode.data.weekly, PERIODS.weekly);
      test(p.opencode.data.monthly, PERIODS.monthly);
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

    const p = this.providers;
    if (p.claude.data) {
      check(p.claude.data.five_hour?.resets_at);
      check(p.claude.data.seven_day?.resets_at);
    }
    if (p.codex.data) {
      check(p.codex.data.five_hour?.resets_at);
      check(p.codex.data.seven_day?.resets_at);
    }
    if (p.antigravity.data) {
      check(p.antigravity.data.five_hour?.resets_at);
      check(p.antigravity.data.seven_day?.resets_at);
    }
    if (p.opencode.data) {
      check(p.opencode.data.rolling?.resets_at);
      check(p.opencode.data.weekly?.resets_at);
      check(p.opencode.data.monthly?.resets_at);
    }
    return earliest < Infinity ? countdown(earliest) : null;
  }

  getActiveAgentsFor(appKey) {
    const list = agents();
    return list.filter((a) => a.app === appKey || (appKey === "claude" && a.app === "claude-code"));
  }

  /**
   * Renders a Gauge representing Remaining Amount (잔여량)
   * with OpenUsage constant-rate pace guide marker line and status color.
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

    // Color based on whether user is within or exceeding linear burn guide
    let barColor = t.done;
    let badgeText = pace.statusText || `${remaining}% left`;
    let badgeTextColor = t.done;
    let badgeBg = t.surface;

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
      // unpaced fallback
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
      // Top Row: Window Label + Reset countdown pill
      .child(
        h_flex()
          .items_center()
          .justify_between()
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
          // Right: Pacing Status Badge (OpenUsage style)
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
      // Middle Row: Remaining Gauge Track with Linear Pace Guide Marker
      .child(
        div()
          .relative()
          .w_full()
          .h(8)
          .rounded(4)
          .bg(t.border)
          .overflow_hidden()
          .flex_none()
          // Remaining Gauge Bar (잔여량 게이지)
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
          // OpenUsage Linear Pace Guide Line (일정 소비 가이드 기준선)
          .when(guidePct != null, (el) =>
            el.child(
              div()
                .absolute()
                .left(`${guidePct}%`)
                .top(0)
                .h_full()
                .w(2)
                .bg(t.foreground)
                .opacity(0.85)
            )
          )
      )
      // Bottom Row: Explanatory readout (Actual Remaining vs Pace Guide Expected)
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

  renderClaudeCard(t, key, prov, cx) {
    const data = prov.data;
    const activeAgents = this.getActiveAgentsFor("claude");

    return this.renderCardContainer(
      t,
      key,
      PROVIDERS[key].name,
      PROVIDERS[key].icon,
      "Official OAuth",
      prov,
      activeAgents,
      cx,
      [
        data?.five_hour
          ? this.renderPacedMetricRow(t, "5-Hour Session Limit", data.five_hour, PERIODS.session)
          : div().text_size(11).text_color(t.dim).child("5-Hour Session: full quota available (fresh)"),
        data?.seven_day
          ? this.renderPacedMetricRow(t, "7-Day Weekly Limit", data.seven_day, PERIODS.weekly)
          : null,
      ]
    );
  }

  renderCodexCard(t, key, prov, cx) {
    const data = prov.data;
    const activeAgents = this.getActiveAgentsFor("codex");
    const planName = data?.plan ? `Plan ${data.plan.toUpperCase()}` : "ChatGPT Plus/Pro";

    return this.renderCardContainer(
      t,
      key,
      PROVIDERS[key].name,
      PROVIDERS[key].icon,
      planName,
      prov,
      activeAgents,
      cx,
      [
        data?.five_hour
          ? this.renderPacedMetricRow(t, "5-Hour Session Limit", data.five_hour, PERIODS.session)
          : null,
        data?.seven_day
          ? this.renderPacedMetricRow(t, "7-Day Weekly Limit", data.seven_day, PERIODS.weekly)
          : null,
      ]
    );
  }

  renderAntigravityCard(t, key, prov, cx) {
    const data = prov.data;
    const activeAgents = this.getActiveAgentsFor("antigravity");
    const bucketTitle = data?.bucket ?? "Gemini Models";

    const rows = [];
    if (data?.five_hour) {
      rows.push(this.renderPacedMetricRow(t, `${bucketTitle} (5-Hour)`, data.five_hour, PERIODS.session));
    }
    if (data?.seven_day) {
      rows.push(this.renderPacedMetricRow(t, `${bucketTitle} (Weekly)`, data.seven_day, PERIODS.weekly));
    }

    // Secondary buckets (Claude & GPT models quota)
    for (const b of data?.buckets ?? []) {
      if (b.five_hour || b.seven_day) {
        rows.push(
          div().pt(4).text_size(10.5).font_semibold().text_color(t.muted).child(b.name ?? "Other Models")
        );
        if (b.five_hour) rows.push(this.renderPacedMetricRow(t, "5-Hour", b.five_hour, PERIODS.session));
        if (b.seven_day) rows.push(this.renderPacedMetricRow(t, "Weekly", b.seven_day, PERIODS.weekly));
      }
    }

    return this.renderCardContainer(
      t,
      key,
      PROVIDERS[key].name,
      PROVIDERS[key].icon,
      "CLI /usage",
      prov,
      activeAgents,
      cx,
      rows
    );
  }

  renderOpencodeCard(t, key, prov, cx) {
    const data = prov.data;
    const activeAgents = this.getActiveAgentsFor("opencode");
    const wsName = data?.workspace ? `Workspace: ${data.workspace}` : "OpenCode Go";

    return this.renderCardContainer(
      t,
      key,
      PROVIDERS[key].name,
      PROVIDERS[key].icon,
      wsName,
      prov,
      activeAgents,
      cx,
      [
        data?.rolling ? this.renderPacedMetricRow(t, "Rolling Limit", data.rolling, PERIODS.rolling) : null,
        data?.weekly ? this.renderPacedMetricRow(t, "Weekly Limit", data.weekly, PERIODS.weekly) : null,
        data?.monthly ? this.renderPacedMetricRow(t, "Monthly Limit", data.monthly, PERIODS.monthly) : null,
      ]
    );
  }

  renderCardContainer(t, key, name, iconPath, planBadge, prov, activeAgents, cx, metricRows) {
    const isStale = prov.at > 0 && Date.now() - prov.at > PROVIDERS[key].stale;

    return v_flex()
      .id(`card-${key}`)
      .flex_1()
      .min_w(360)
      .bg(t.raised)
      .border(1)
      .border_color(t.border)
      .rounded(8)
      .p(14)
      .gap(12)
      .child(
        // Card Header
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(svg(iconPath).size(18))
              .child(
                v_flex()
                  .gap(1)
                  .child(
                    h_flex()
                      .gap(6)
                      .items_center()
                      .child(div().font_bold().text_size(13).text_color(t.foreground).child(name))
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
                          .child(planBadge)
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
                  .id(`refresh-${key}`)
                  .p(4)
                  .rounded(4)
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => this.refresh(key, cx))
                  .child(
                    prov.loading
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
                    .child(`${activeAgents.length} active Herdr agent (${activeAgents.map((a) => a.terminal).join(", ")})`)
                )
            )
            .child(
              div()
                .cursor_pointer()
                .text_size(10.5)
                .text_color(t.accent)
                .on_click(() => {
                  if (activeAgents[0]?.terminal) {
                    run("agent.focus", { terminal: activeAgents[0].terminal });
                  }
                })
                .child("Focus →")
            )
        )
      )
      // Metrics with Remaining Gauges and Linear Pace Guide
      .child(
        v_flex()
          .gap(10)
          .children(metricRows.filter(Boolean))
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
          .child(
            div().child(
              prov.loading
                ? "Updating from provider..."
                : `Updated ${timeAgo(prov.at)}`
            )
          )
          .when(Boolean(prov.error), (el) =>
            el.child(
              div().text_color(t.blocked).truncate().child(`Error: ${prov.error}`)
            )
          )
          .when(Boolean(prov.warning && !prov.error), (el) =>
            el.child(
              div().text_color(t.working).truncate().child(`Warning: ${prov.warning}`)
            )
          )
      );
  }

  render(cx) {
    const t = theme();
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
                          .child("Remaining Quota & Pace Monitor")
                      )
                  )
                  .child(
                    div()
                      .text_size(11)
                      .text_color(t.dim)
                      .child("Tracks remaining quota against constant linear burn rate (OpenUsage engine)")
                  )
              )
          )
          .child(
            // Right: Global Action Buttons
            h_flex()
              .gap(10)
              .items_center()
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
                  .child(
                    div()
                      .text_size(11.5)
                      .font_semibold()
                      .text_color(t.foreground)
                      .child(anyLoading ? "Refreshing..." : "Refresh All")
                  )
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
          .child(
            h_flex()
              .gap(16)
              .items_center()
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
                  .child(
                    div()
                      .text_size(11)
                      .text_color(t.muted)
                      .child(`${allAgents.length} Herdr Agents Active`)
                  )
              )
              .when(Boolean(earliestReset), (el) =>
                el.child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .child(div().size(6).rounded(3).bg(t.accent))
                    .child(
                      div()
                        .text_size(11)
                        .text_color(t.muted)
                        .child(`Next Reset in ${earliestReset}`)
                    )
                )
              )
          )
          // Right: Pace Guide Indicator Legend
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
                  .child(div().text_color(t.dim).child("Pace Guide"))
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
      // Main Body: Provider Cards Grid
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
              .child(this.renderClaudeCard(t, "claude", this.providers.claude, cx))
              .child(this.renderCodexCard(t, "codex", this.providers.codex, cx))
          )
          .child(
            h_flex()
              .flex_wrap()
              .gap(14)
              .child(this.renderAntigravityCard(t, "antigravity", this.providers.antigravity, cx))
              .child(this.renderOpencodeCard(t, "opencode", this.providers.opencode, cx))
          )
      );
  }
}
