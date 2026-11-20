import { View, div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, run, theme, settings, shared, watchFolder, checking, props } from "herdr";
// git.js / repo.js come from the repo's shared/ folder: install.ps1 copies them in (mods can't import across folders).
import { LOG_FORMAT, SHOW_FORMAT, ICON, firstLine, parseLog, ago, splitSubject, parseWorktrees, parseShow, samePath, defaultBase, mergedBranches, logRefs } from "./git.js";
import { repoCwd, remoteKey, gitIn } from "./repo.js";

const LIMIT = 300;
// Fixed palette, not the terminal's ANSI colors: themes often mute those until adjacent lanes blur together.
// Matches agent-home's graphite-cyan theme (cyan accent, no purple); warm and cool alternate so neighbours differ.
const LANES = ["#5cc8d6", "#e5c07b", "#7aa7ff", "#f08a7e", "#8fc98a", "#e58fb0"];
const laneColor = (p) => LANES[((p + 1) >> 1) % LANES.length];
// Graph geometry: px per --graph text column, commit row height, connector-only row height.
const CW = 7, ROW = 22, LINK = 12, DETAIL_ROW = 22;
const FADE = Array.from({ length: 12 }, (_, i) => Math.round((255 * (i + 1)) / 13).toString(16).padStart(2, "0"));
// Only ref moves change the graph; index, objects, logs and FETCH_HEAD churn on every IDE poll or gc.
const REF_CHANGE = /[\\/](HEAD|packed-refs)$|[\\/]refs[\\/]/;

// One row of the commit detail (parseShow kinds). Message rows use the UI font; file and code rows use mono.
// Code rows keep the changes mod's diff look.
// git --stat's bar in 5 cells: length by the file's share of the biggest change, green/red by its own mix.
function statBar(add, del, max, t) {
  const a = +add || 0, d = +del || 0, n = a + d ? Math.max(1, Math.round((5 * (a + d)) / max)) : 0, g = n && Math.round((n * a) / (a + d));
  return h_flex().w(38).flex_none().gap(2).children([0, 1, 2, 3, 4].map((i) =>
    div().w(6).h(6).rounded(1).bg(i < g ? t.ansi2 : i < n ? t.ansi1 : t.border)));
}

function diffRow({ kind, old, new: next, hash, text, add, del, max }, t, mono) {
  const row = () => h_flex().w_full().h(DETAIL_ROW).flex_none().px(14).items_center();
  const num = (n) => div().w(32).flex_none().text_right().text_color(t.dim).child(n === undefined ? "" : String(n));
  if (kind === "gap") return row();
  if (kind === "title") return row().text_size(13.5).font_semibold().child(div().truncate().child(text));
  if (kind === "meta") return row().gap(8).text_size(11.5).text_color(t.dim)
    .when(Boolean(hash), (e) => e.child(div().font_family(mono).text_color(t.accent).child(hash))).child(text);
  if (kind === "body") return row().text_size(12).text_color(t.muted).child(text);
  if (kind === "trailer") return row().text_size(11).text_color(t.dim).child(text);
  if (kind === "stat" || kind === "files") return row().gap(6).font_family(mono).text_size(11.5)
    .child(div().w(36).flex_none().text_right().text_color(add === "0" ? t.dim : t.ansi2).child(add === "-" ? "" : `+${add}`))
    .child(div().w(36).flex_none().text_right().text_color(del === "0" ? t.dim : t.ansi1).child(del === "-" ? "bin" : `−${del}`))
    .child(kind === "stat" ? statBar(add, del, max, t) : div().w(38).flex_none())
    .child(div().flex_1().min_w(0).truncate().when(kind === "files", (e) => e.font_semibold()).child(text));
  if (kind === "file") return row().bg(t.raised).border_t(1).border_color(t.border).font_family(mono).text_size(11.5).font_semibold().child(text);
  if (kind === "@") return row().bg(t.ansi4 + "14").font_family(mono).text_size(11).text_color(t.dim).child(div().truncate().child(text));
  return h_flex().w_full().h(DETAIL_ROW).flex_none().gap(8).items_center().font_family(mono).text_size(11)
    .when(kind === "+", (e) => e.bg(t.ansi2 + "30")).when(kind === "-", (e) => e.bg(t.ansi1 + "30"))
    .child(h_flex().h_full().flex_none().items_center().gap(4).pr(6).bg(t.background + "a0").child(num(old)).child(num(next)))
    .child(div().w(10).flex_none().text_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : t.dim).child(kind === " " ? "" : kind))
    .child(div().flex_1().min_w(0).truncate().text_color(kind === "" ? t.muted : t.foreground).child(text));
}

// Read-only view of the focused repo: commit graph (local) and PR/MR + CI (remote data that git-status fetches).
export default class GitGraph extends View {
  // props().tab: the tab to start on (agent-home's Repos panel opens this on "issue").
  init(_props, cx) {
    this.tab = props()?.tab ?? "graph"; this.rows = []; this.detail = []; this.detailWidth = 300;
    this.unpushed = new Set(); this.merged = new Set(); this.remotes = []; this.trees = []; this.wide = false;
    this.all = true; this.showRemotes = true;
    if (checking()) return;
    // Debounce: a burst of .git changes (a commit, a fetch) sets dirty; this reloads at most every 2 s.
    cx.timer.every(2000, (cx) => { if (this.dirty) this.refresh(cx); });
  }

  // The common dir, so a linked worktree (whose .git is a file) still sees commits and ref moves.
  watch(dir, cx) {
    if (this.watched === dir) return;
    this.watching?.cancel();
    this.watched = dir;
    if (!dir) return;
    cx.spawn(async () => {
      try {
        while (this.watched === dir) {
          this.watching = watchFolder(dir);
          const paths = await this.watching;
          if (this.watched === dir && paths.some((p) => samePath(p, dir) || REF_CHANGE.test(p))) this.dirty = true;
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (checking()) return;
    // A load already running may use stale args (filter, cwd): the 2 s timer reloads after it.
    if (this.loading) { this.dirty = true; return; }
    const cwd = this.context = this.cwd;
    this.dirty = false;
    if (!cwd) { this.root = null; this.rows = []; this.error = null; this.watch(null, cx); return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await gitIn(cwd)(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--abbrev-ref", "HEAD"]);
        if (cwd !== this.cwd) return;
        if (top.code !== 0) { this.root = null; this.rows = []; this.error = "不是 git repo"; this.watch(null, cx); return; }
        const [root, common, head] = top.stdout.trim().split("\n");
        const git = gitIn(root), current = head === "HEAD" ? "" : head;
        const [log, remotes, trees, base] = await Promise.all([
          git(["log", "--graph", ...logRefs(this.all, this.showRemotes, current), "--date-order", "-n", String(LIMIT), LOG_FORMAT]),
          git(["remote"]), git(["worktree", "list", "--porcelain"]), defaultBase(git)]);
        if (log.code !== 0) throw new Error(firstLine(log.stderr));
        const names = remotes.stdout.split("\n").filter(Boolean);
        // Without a remote every commit would read as unpushed: mark nothing then.
        const [ahead, merged] = await Promise.all([
          names.length ? git(["log", "--branches", "--not", "--remotes", "--format=%H", "-n", String(LIMIT)]) : null,
          base ? mergedBranches(git, base, current) : []]);
        if (cwd !== this.cwd) return;
        if (root !== this.root) { this.open = null; this.detail = []; }
        Object.assign(this, {
          root, branch: current, rows: parseLog(log.stdout), remotes: names, merged: new Set(merged), trees: parseWorktrees(trees.stdout), error: null,
          unpushed: new Set(ahead?.stdout.split("\n").filter(Boolean) ?? []),
        });
        this.watch(common, cx);
      } catch (e) { if (cwd === this.cwd) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  pick(hash, cx) {
    this.open = this.open === hash ? null : hash;
    this.detail = [];
    cx.notify();
    if (!this.open) return;
    const root = this.root;
    cx.spawn(async (cx) => {
      const r = await gitIn(root)(["show", SHOW_FORMAT, "--date=format-local:%Y-%m-%d %H:%M", "--numstat", "-p", "--diff-merges=first-parent", "--no-color", "--no-ext-diff", "--no-textconv", hash]).catch(() => null);
      if (this.open !== hash) return;
      const rows = r?.code === 0 ? parseShow(r.stdout).slice(0, 3000) : [{ kind: "meta", text: "無法讀取這個 commit" }];
      this.detail = rows.map((row) => (row.text.length > 4000 ? { ...row, text: row.text.slice(0, 4000) + "…" } : row));
      this.detailWidth = Math.max(300, ...this.detail.map((row) => (row.text.length + 1) * 7 + 100));
      cx.notify();
    });
  }

  // An open space for that checkout, else a new space there.
  gotoTree(path) {
    const space = spaces().find((s) => !s.machine && samePath(s.folder, path));
    if (space) run("space.select", { id: space.id });
    else run("space.new", { folder: path });
  }

  render(cx) {
    this.cwd = repoCwd(this.cwd);
    if (this.cwd !== this.context) this.refresh(cx);
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    const button = (id, label, on, action) => div().id(id).px(8).h(24).flex().items_center().rounded(6).cursor_pointer()
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover)).on_click(action).child(label);
    const tab = (id, label) => button(`tab-${id}`, label, this.tab === id, (_e, cx) => { this.tab = id; cx.notify(); });
    const filter = (id, label, on, set) => button(`filter-${id}`, label, on, (_e, cx) => { if (set()) { this.refresh(cx); cx.notify(); } });
    return v_flex().id("git-graph").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12.5)
      .on_size_change((size, cx) => { this.width = size.width; const wide = size.width >= 720; if (wide !== this.wide) { this.wide = wide; cx.notify(); } })
      .child(h_flex().h(38).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border)
        .child(tab("graph", "Graph")).child(tab("pr", "PR/MR")).child(tab("issue", "Issue"))
        .when(this.tab === "graph", (e) => e.child(div().w(1).h(16).mx(4).bg(t.border))
          // set() returns whether anything changed, so clicking the active choice runs no git.
          .child(filter("all", "所有分支", this.all, () => !this.all && (this.all = true)))
          .child(filter("current", "目前分支", !this.all, () => this.all && !(this.all = false)))
          .child(filter("remotes", this.showRemotes ? "✓ 遠端" : "遠端", this.showRemotes, () => { this.showRemotes = !this.showRemotes; return true; })))
        .child(div().flex_1())
        .child(div().min_w(0).truncate().text_color(t.dim).child(this.root?.split(/[\\/]/).pop() ?? ""))
        .when(Boolean(this.root), (e) => e.child(this.refChip(this.branch ? `HEAD -> ${this.branch}` : "HEAD", t, t.accent)))
        .child(div().id("git-refresh").size(24).flex().items_center().justify_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { run("git-status.refresh"); if (this.tab === "graph") this.refresh(cx); })
          .child(svg("mods/git-graph/refresh.svg").size(14).text_color(t.muted))))
      .child(this.tab === "graph" ? this.graphView(t, mono) : this.prView(t));
  }

  graphView(t, mono) {
    const view = v_flex().flex_1().min_h(0);
    if (!this.rows.length) return view.child(div().p(12).text_color(t.dim).child(this.error ?? (this.loading ? "載入中…" : "沒有資料夾")));
    // One graph width for every row, so subjects start at the same x.
    const gw = Math.max(...this.rows.map((r) => r.graph.length)) * CW;
    return view
      .when(this.trees.length > 1, (el) => el.child(h_flex().id("git-trees").flex_none().overflow_x_scroll().px(10).py(6).gap(6).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .child(div().flex_none().text_color(t.dim).child("worktree"))
        .children(this.trees.map((w, i) => {
          const here = samePath(w.path, this.root);
          return div().id(`tree-${i}`).flex_none().px(6).rounded(5).border_1().border_color(here ? t.accent : t.border).text_color(here ? t.foreground : t.muted)
            .when(!here, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.gotoTree(w.path))).child(w.branch);
        }))))
      .child(div().flex_1().min_h(0).relative()
        // Virtual: drawing all 300 rows' graph paths in one render overran the script's time limit ("interrupted").
        .child(v_virtual_list("git-log", this.rows.length, this.rows.map((r) => r.hash ? ROW : LINK), (i) => this.rows[i].full || `link-${i}`,
          (range) => { const now = Date.now() / 1000; return this.rows.slice(range.start, range.end).map((_r, k) => this.logRow(range.start + k, t, mono, gw, now)); })
          .size_full().on_item_click((key, cx) => { if (!key.startsWith("link-")) this.pick(key, cx); }))
        .child(Scrollbar.vertical("git-log").absolute().inset_0()))
      .when(Boolean(this.open), (el) => el.child(div().flex_1().min_h(0).relative().border_t(1).border_color(t.accent).bg(t.chrome)
        .child(div().id("git-show-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.detailWidth).h_full().pt(6).child(v_virtual_list("git-show", this.detail.length, DETAIL_ROW, (i) => String(i),
            (range) => this.detail.slice(range.start, range.end).map((row) => diffRow(row, t, mono))).size_full())))
        // Wider than the pane: fade the right edge so the cut-off reads as "scrolls sideways".
        // bg() takes only a color: thin strips of rising alpha stand in for a gradient (wide ones show as steps).
        .when(this.detailWidth > (this.width ?? Infinity), (e) => e.child(h_flex().absolute().top_0().bottom_0().right_0()
          .children(FADE.map((a) => div().w(3).h_full().bg(t.chrome + a)))))
        .child(Scrollbar.vertical("git-show").viewport_from_layout().absolute().inset_0())
        .child(div().id("git-show-close").absolute().top(4).right(16).size(22).flex().items_center().justify_center().rounded(6).cursor_pointer()
          .bg(t.chrome).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.pick(this.open, cx)).child("✕"))));
  }

  // Draws the --graph text of row i as lane-colored lines: | straight, / \ as S-curves, _ along the bottom, * a dot.
  graphCell(i, t, width) {
    const g = this.rows[i].graph, up = this.rows[i - 1]?.graph ?? "", down = this.rows[i + 1]?.graph ?? "";
    const h = this.rows[i].hash ? ROW : LINK, x = (p) => p * CW + CW / 2;
    const strokes = new Map(), dots = [];
    const color = laneColor;
    const line = (p) => { const c = color(p); if (!strokes.has(c)) strokes.set(c, PathBuilder.stroke(2)); return strokes.get(c); };
    for (let p = 0; p < g.length; p++) {
      const ch = g[p];
      if (ch === "|") line(p).move_to(x(p), 0).line_to(x(p), h);
      else if (ch === "/") line(p).move_to(x(p + 1), 0).cubic_bezier_to(x(p - 1), h, x(p + 1), h / 2, x(p - 1), h / 2);
      else if (ch === "\\") line(p).move_to(x(p - 1), 0).cubic_bezier_to(x(p + 1), h, x(p - 1), h / 2, x(p + 1), h / 2);
      else if (ch === "_") line(p).move_to(x(p - 1), h).line_to(x(p + 1), h);
      else if (ch === "*") {
        // Half lines only where the neighbor rows connect, so branch tips and roots end at the dot.
        if ("|*".includes(up[p] ?? " ") || up[p - 1] === "\\" || up[p + 1] === "/") line(p).move_to(x(p), 0).line_to(x(p), h / 2);
        if ("|*".includes(down[p] ?? " ") || down[p - 1] === "/" || down[p + 1] === "\\") line(p).move_to(x(p), h / 2).line_to(x(p), h);
        // Unpushed commits get a hollow dot.
        const hollow = this.unpushed.has(this.rows[i].full);
        // Merge commits (a second parent opens to the right on the next row) get a bigger dot.
        const s = down[p + 1] === "\\" ? 14 : 10;
        dots.push(div().absolute().left(x(p) - s / 2).top(h / 2 - s / 2).w(s).h(s).rounded_full().border_2()
          .border_color(hollow ? color(p) : t.background).bg(hollow ? t.background : color(p)));
      }
    }
    return div().relative().flex_none().w(width).h(h)
      .children([...strokes].map(([c, b]) => window.paint_path(b.build(), c).absolute().top(0).left(0).size_full()))
      .children(dots);
  }

  logRow(i, t, mono, width, now) {
    const r = this.rows[i], graph = this.graphCell(i, t, width);
    // Same transparent left border as commit rows, or link-row lines sit 2px left of the dots.
    if (!r.hash) return h_flex().w_full().h(LINK).flex_none().px(10).border_l(2).border_color("#00000000").child(graph);
    const small = (text, color) => div().flex_none().text_size(11).text_color(color).child(text);
    // The label once per branch tip; the rest of the unpushed run shows only as hollow dots.
    const tip = r.refs.some((ref) => !ref.startsWith("tag: ") && !this.remotes.some((rm) => ref.replace("HEAD -> ", "").startsWith(`${rm}/`)));
    // Every row starts with feat(x): / fix(x): — faint, so the eye lands on what changed.
    const [prefix, rest] = splitSubject(r.subject);
    return h_flex().w_full().h(ROW).flex_none().px(10).gap(8).items_center().cursor_pointer()
      .border_l(2).border_color(this.open === r.full ? t.accent : "#00000000")
      .when(this.open === r.full, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .child(graph)
      .when(this.wide, (e) => e.child(div().flex_none().font_family(mono).text_size(11.5).text_color(t.dim).child(r.hash)))
      .child(h_flex().flex_1().min_w(0)
        .when(Boolean(prefix), (e) => e.child(div().flex_none().text_color(t.muted).child(prefix)))
        .child(div().min_w(0).truncate().child(rest)))
      .children(r.refs.filter((ref) => !ref.endsWith("/HEAD")).map((ref) => this.refChip(ref, t, laneColor(r.graph.indexOf("*")))))
      .when(tip && this.unpushed.has(r.full), (e) => e.child(small("↑ 未push", t.working)))
      // Time always (narrow panes too), author only when there's room.
      .when(this.wide, (e) => e.child(small(r.author, t.muted).w(90).truncate()))
      .child(small(ago(+r.when, now), t.muted).w(28).text_right());
  }

  refChip(ref, t, lane) {
    const head = ref.startsWith("HEAD -> ") || ref === "HEAD", tag = ref.startsWith("tag: "), name = ref.replace(/^(HEAD -> |tag: )/, "");
    const remote = !tag && this.remotes.some((r) => name.startsWith(`${r}/`)), gone = !tag && !remote && this.merged.has(name);
    // Chips take their lane's color so the eye can follow label to line; HEAD is filled, remotes and tags stay faint.
    // HEAD's fill already marks it: no frame on top, or it's one more bright box beside the focus frame.
    return div().flex_none().px(5).rounded(4).border_1().text_size(11)
      .when(head, (e) => e.bg(lane + "33"))
      .border_color(head ? "#00000000" : tag ? t.border : remote ? lane + "66" : lane)
      .text_color(head ? t.foreground : remote || tag ? t.dim : gone ? t.muted : lane)
      .child(gone ? `${name} · 已合併，可刪` : tag ? `tag ${name}` : name);
  }

  prView(t) {
    const data = this.root ? shared(remoteKey(this.root)) : null;
    const note = !this.root ? this.error ?? "不是 git repo" : !data ? "載入中…" : data.error;
    if (note) return div().p(12).text_color(t.dim).child(note);
    const word = data.kind === "github" ? "PR" : "MR", mine = data.pipelines.filter((p) => p.ref === this.branch).slice(0, 5);
    const ci = (s) => div().w(14).flex_none().text_color({ ok: t.ansi2, fail: t.ansi1, run: t.working, none: t.dim }[s]).child(ICON[s]);
    const row = (id, url) => h_flex().id(id).h(28).flex_none().px(10).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => /^https?:\/\//i.test(url ?? "") && cx.open_url(url));
    const section = (text) => div().px(10).pt(10).pb(4).text_size(11).text_color(t.dim).child(text);
    const empty = (text) => div().px(10).py(4).text_color(t.dim).child(text);
    // ?? []: shared data stored before issues were fetched has no list yet.
    const issues = data.issues ?? [];
    if (this.tab === "issue") return v_flex().id("git-issue").flex_1().min_h(0).p(6).overflow_y_scrollbar()
      .child(section(`Issue · ${issues.length}`))
      .children(issues.map((p) => row(`issue-${p.id}`, p.url)
        .child(div().w(56).flex_none().text_color(t.dim).child(p.id))
        .child(div().flex_1().min_w(0).truncate().child(p.title))
        .child(div().max_w(200).flex_none().truncate().text_size(11).text_color(t.muted).child(p.labels))
        .child(div().w(130).flex_none().truncate().text_size(11).text_color(t.dim).child(p.who))))
      .when(!issues.length, (e) => e.child(empty(data.issueError ?? "沒有開著的 issue")));
    return v_flex().id("git-pr").flex_1().min_h(0).p(6).overflow_y_scrollbar()
      .child(section(`${word} · ${data.prs.length}`))
      .children(data.prs.map((p) => row(`pr-${p.id}`, p.url).child(ci(p.ci))
        .child(div().w(56).flex_none().text_color(t.dim).child(p.id))
        .child(div().flex_1().min_w(0).truncate().child(p.draft ? `[Draft] ${p.title}` : p.title))
        .child(div().max_w(200).flex_none().truncate().text_size(11).text_color(p.branch === this.branch ? t.accent : t.muted).child(p.branch))
        .child(div().w(130).flex_none().truncate().text_size(11).text_color(t.dim).child(p.review))))
      .when(!data.prs.length, (e) => e.child(empty(`沒有開著的 ${word}`)))
      .child(section(`CI · ${this.branch || "HEAD"}`))
      .children(mine.map((p, i) => row(`ci-${i}`, p.url).child(ci(p.ci)).child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(p.title || p.ref))))
      .when(!mine.length, (e) => e.child(empty("這個分支最近沒有 pipeline")));
  }
}
