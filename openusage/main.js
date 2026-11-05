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

function statusLevel(t, pct) {
  if (pct >= 90) return { label: "Critical", color: t.blocked, bg: t.blocked, textColor: t.blocked };
  if (pct >= 75) return { label: "Warning", color: t.working, bg: t.working, textColor: t.working };
  if (pct >= 50) return { label: "Moderate", color: t.accent, bg: t.accent, textColor: t.accent };
  return { label: "Healthy", color: t.done, bg: t.done, textColor: t.done };
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

  getPeakUsage() {
    let peak = 0;
    let peakName = "";

    const check = (pct, name) => {
      if (pct > peak) {
        peak = pct;
        peakName = name;
      }
    };

    const p = this.providers;
    if (p.claude.data) {
      if (p.claude.data.five_hour) check(p.claude.data.five_hour.utilization, "Claude 5h");
      if (p.claude.data.seven_day) check(p.claude.data.seven_day.utilization, "Claude Weekly");
    }
    if (p.codex.data) {
      if (p.codex.data.five_hour) check(p.codex.data.five_hour.utilization, "Codex 5h");
      if (p.codex.data.seven_day) check(p.codex.data.seven_day.utilization, "Codex Weekly");
    }
    if (p.antigravity.data) {
      if (p.antigravity.data.five_hour) check(p.antigravity.data.five_hour.utilization, "Antigravity 5h");
      if (p.antigravity.data.seven_day) check(p.antigravity.data.seven_day.utilization, "Antigravity Weekly");
    }
    if (p.opencode.data) {
      if (p.opencode.data.rolling) check(p.opencode.data.rolling.utilization, "OpenCode Rolling");
      if (p.opencode.data.weekly) check(p.opencode.data.weekly.utilization, "OpenCode Weekly");
      if (p.opencode.data.monthly) check(p.opencode.data.monthly.utilization, "OpenCode Monthly");
    }
    return { peak: Math.round(peak), name: peakName };
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

  renderProgressBar(t, pct, height = 6) {
    const valid = clamp(pct);
    const lvl = statusLevel(t, valid);
    return h_flex()
      .w_full()
      .h(height)
      .rounded(height / 2)
      .bg(t.border)
      .overflow_hidden()
      .flex_none()
      .child(
        div()
          .h_full()
          .w(`${valid}%`)
          .rounded(height / 2)
          .bg(lvl.color)
      );
  }

  renderMetricRow(t, label, windowData) {
    if (!windowData) return null;
    const util = Math.round(clamp(windowData.utilization ?? 0));
    const rem = windowData.remaining != null ? Math.round(windowData.remaining) : 100 - util;
    const reset = countdown(windowData.resets_at);
    const lvl = statusLevel(t, util);

    return v_flex()
      .w_full()
      .gap(4)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().font_semibold().text_size(11.5).text_color(t.foreground).child(label))
              .when(Boolean(reset), (el) =>
                el.child(
                  div()
                    .px(5)
                    .py(1)
                    .rounded(3)
                    .bg(t.border)
                    .text_size(10)
                    .text_color(t.muted)
                    .child(`resets in ${reset}`)
                )
              )
          )
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().font_semibold().text_size(12).text_color(lvl.textColor).child(`${util}%`))
              .child(div().text_size(10.5).text_color(t.dim).child(`(${rem}% left)`))
          )
      )
      .child(this.renderProgressBar(t, util, 6));
  }

  renderClaudeCard(t, key, prov, cx) {
    const data = prov.data;
    const activeAgents = this.getActiveAgentsFor("claude");
    const peak = data
      ? Math.max(data.five_hour?.utilization ?? 0, data.seven_day?.utilization ?? 0)
      : 0;
    const lvl = statusLevel(t, peak);

    return this.renderCardContainer(
      t,
      key,
      PROVIDERS[key].name,
      PROVIDERS[key].icon,
      "Official OAuth",
      lvl,
      prov,
      activeAgents,
      cx,
      [
        data?.five_hour
          ? this.renderMetricRow(t, "5-Hour Session Limit", data.five_hour)
          : div().text_size(11).text_color(t.dim).child("5-Hour window: no active quota limit"),
        data?.seven_day
          ? this.renderMetricRow(t, "7-Day Weekly Limit", data.seven_day)
          : null,
      ]
    );
  }

  renderCodexCard(t, key, prov, cx) {
    const data = prov.data;
    const activeAgents = this.getActiveAgentsFor("codex");
    const peak = data
      ? Math.max(data.five_hour?.utilization ?? 0, data.seven_day?.utilization ?? 0)
      : 0;
    const lvl = statusLevel(t, peak);
    const planName = data?.plan ? `Plan ${data.plan.toUpperCase()}` : "ChatGPT Plus/Pro";

    return this.renderCardContainer(
      t,
      key,
      PROVIDERS[key].name,
      PROVIDERS[key].icon,
      planName,
      lvl,
      prov,
      activeAgents,
      cx,
      [
        data?.five_hour
          ? this.renderMetricRow(t, "5-Hour Session Limit", data.five_hour)
          : null,
        data?.seven_day
          ? this.renderMetricRow(t, "7-Day Weekly Limit", data.seven_day)
          : null,
      ]
    );
  }

  renderAntigravityCard(t, key, prov, cx) {
    const data = prov.data;
    const activeAgents = this.getActiveAgentsFor("antigravity");
    const peak = data
      ? Math.max(data.five_hour?.utilization ?? 0, data.seven_day?.utilization ?? 0)
      : 0;
    const lvl = statusLevel(t, peak);
    const bucketTitle = data?.bucket ?? "Gemini Models";

    const rows = [];
    if (data?.five_hour) {
      rows.push(this.renderMetricRow(t, `${bucketTitle} (5-Hour)`, data.five_hour));
    }
    if (data?.seven_day) {
      rows.push(this.renderMetricRow(t, `${bucketTitle} (Weekly)`, data.seven_day));
    }

    // Secondary buckets (Claude & GPT models quota)
    for (const b of data?.buckets ?? []) {
      if (b.five_hour || b.seven_day) {
        rows.push(
          div().pt(2).text_size(10.5).font_semibold().text_color(t.muted).child(b.name ?? "Other Models")
        );
        if (b.five_hour) rows.push(this.renderMetricRow(t, "5-Hour", b.five_hour));
        if (b.seven_day) rows.push(this.renderMetricRow(t, "Weekly", b.seven_day));
      }
    }

    return this.renderCardContainer(
      t,
      key,
      PROVIDERS[key].name,
      PROVIDERS[key].icon,
      "CLI /usage",
      lvl,
      prov,
      activeAgents,
      cx,
      rows
    );
  }

  renderOpencodeCard(t, key, prov, cx) {
    const data = prov.data;
    const activeAgents = this.getActiveAgentsFor("opencode");
    const peak = data
      ? Math.max(
          data.rolling?.utilization ?? 0,
          data.weekly?.utilization ?? 0,
          data.monthly?.utilization ?? 0
        )
      : 0;
    const lvl = statusLevel(t, peak);
    const wsName = data?.workspace ? `Workspace: ${data.workspace}` : "OpenCode Go";

    return this.renderCardContainer(
      t,
      key,
      PROVIDERS[key].name,
      PROVIDERS[key].icon,
      wsName,
      lvl,
      prov,
      activeAgents,
      cx,
      [
        data?.rolling ? this.renderMetricRow(t, "Rolling Limit", data.rolling) : null,
        data?.weekly ? this.renderMetricRow(t, "Weekly Limit", data.weekly) : null,
        data?.monthly ? this.renderMetricRow(t, "Monthly Limit", data.monthly) : null,
      ]
    );
  }

  renderCardContainer(t, key, name, iconPath, planBadge, lvl, prov, activeAgents, cx, metricRows) {
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
      .gap(10)
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
              .child(
                div()
                  .px(6)
                  .py(2)
                  .rounded(4)
                  .bg(t.surface)
                  .border(1)
                  .border_color(t.border)
                  .child(
                    h_flex()
                      .gap(4)
                      .items_center()
                      .child(div().size(6).rounded(3).bg(lvl.color))
                      .child(
                        div()
                          .text_size(10.5)
                          .font_semibold()
                          .text_color(lvl.textColor)
                          .child(isStale ? "Stale" : lvl.label)
                      )
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
      // Metrics
      .child(
        v_flex()
          .gap(8)
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
    const peak = this.getPeakUsage();
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
                          .child("Agent Quota Tracker")
                      )
                  )
                  .child(
                    div()
                      .text_size(11)
                      .text_color(t.dim)
                      .child("Observability across Claude, Codex, Antigravity & OpenCode")
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
      // Glanceable Stats Strip
      .child(
        h_flex()
          .px(18)
          .py(8)
          .bg(t.surface)
          .border_b(1)
          .border_color(t.border)
          .gap(20)
          .items_center()
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().size(6).rounded(3).bg(t.done))
              .child(div().text_size(11).text_color(t.muted).child("4 Tracked Providers"))
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
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(
                div()
                  .size(6)
                  .rounded(3)
                  .bg(statusLevel(t, peak.peak).color)
              )
              .child(
                div()
                  .text_size(11)
                  .text_color(t.muted)
                  .child(`Peak Quota: ${peak.peak}% (${peak.name || "None"})`)
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
