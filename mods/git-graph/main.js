import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, run, theme, settings, shared, watchFolder, checking } from "herdr";
// git.js / repo.js come from the repo's shared/ folder: install.ps1 copies them in (mods can't import across folders).
import { LOG_FORMAT, ICON, firstLine, parseLog, parseWorktrees, showRows, samePath, defaultBase, mergedBranches } from "./git.js";
import { repoCwd, remoteKey, gitIn } from "./repo.js";

const LIMIT = 300;
const LANES = ["ansi4", "ansi2", "ansi3", "ansi5", "ansi6", "ansi1"];
// Only ref moves change the graph; index, objects, logs and FETCH_HEAD churn on every IDE poll or gc.
const REF_CHANGE = /[\\/](HEAD|packed-refs)$|[\\/]refs[\\/]/;

// Same look as the changes mod's diff rows.
function diffRow({ kind, number, text }, t) {
  if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
  return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
    .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
    .child(div().flex_1().min_w(0).truncate().child(text));
}

// Read-only view of the focused repo: commit graph (local) and PR/MR + CI (remote data that git-status fetches).
export default class GitGraph extends View {
  init(_props, cx) {
    this.tab = "graph"; this.rows = []; this.detail = []; this.detailWidth = 300;
    this.unpushed = new Set(); this.merged = new Set(); this.remotes = []; this.trees = []; this.wide = false;
    if (checking()) return;
    // Debounce: a burst of .git changes (a commit, a fetch) sets dirty; this reloads at most every 2 s.
    cx.timer.every(2000, (cx) => { if (this.dirty) this.refresh(cx); });
  }

  // The common dir, so a linked worktree (whose .git is a file) still sees commits and ref moves.
  watch(dir, cx) {
    if (this.watched === dir) return;
    this.watching?.cancel();
    this.watched = dir;
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
    if (checking() || this.loading) return;
    const cwd = this.context = this.cwd;
    this.dirty = false;
    if (!cwd) { this.root = null; this.rows = []; this.error = null; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await gitIn(cwd)(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--abbrev-ref", "HEAD"]);
        if (cwd !== this.cwd) return;
        if (top.code !== 0) { this.root = null; this.rows = []; this.error = "不是 git repo"; return; }
        const [root, common, head] = top.stdout.trim().split("\n");
        const git = gitIn(root), current = head === "HEAD" ? "" : head;
        const [log, remotes, trees, base] = await Promise.all([
          git(["log", "--graph", "--all", "--date-order", "-n", String(LIMIT), LOG_FORMAT]),
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
      const r = await gitIn(root)(["show", "--stat", "-p", "--no-color", "--no-ext-diff", "--no-textconv", hash]).catch(() => null);
      if (this.open !== hash) return;
      const lines = r?.code === 0 ? r.stdout.replace(/\n$/, "").split("\n").slice(0, 3000) : ["無法讀取這個 commit"];
      this.detail = showRows(lines.map((l) => (l.length > 4000 ? l.slice(0, 4000) + "…" : l)));
      this.detailWidth = Math.max(300, ...this.detail.map((row) => (row.text.length + 1) * 7 + 50));
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
    return v_flex().id("git-graph").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12.5)
      .on_size_change((size, cx) => { const wide = size.width >= 720; if (wide !== this.wide) { this.wide = wide; cx.notify(); } })
      .child(h_flex().h(38).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border)
        .child(tab("graph", "Graph")).child(tab("pr", "PR/MR")).child(div().flex_1())
        .child(div().min_w(0).truncate().text_color(t.dim).child(this.root?.split(/[\\/]/).pop() ?? ""))
        .child(button("git-refresh", "重新整理", false, (_e, cx) => (this.tab === "pr" ? run("git-status.refresh") : this.refresh(cx)))))
      .child(this.tab === "graph" ? this.graphView(t, mono) : this.prView(t));
  }

  graphView(t, mono) {
    const view = v_flex().flex_1().min_h(0);
    if (!this.rows.length) return view.child(div().p(12).text_color(t.dim).child(this.error ?? (this.loading ? "載入中…" : "沒有資料夾")));
    return view
      .when(this.trees.length > 1, (el) => el.child(h_flex().flex_none().px(10).py(6).gap(6).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .child(div().flex_none().text_color(t.dim).child("worktree"))
        .children(this.trees.map((w, i) => {
          const here = samePath(w.path, this.root);
          return div().id(`tree-${i}`).flex_none().px(6).rounded(5).border_1().border_color(here ? t.accent : t.border).text_color(here ? t.foreground : t.muted)
            .when(!here, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.gotoTree(w.path))).child(w.branch);
        }))))
      .child(div().flex_1().min_h(0).relative()
        // Plain rows, as the changes mod's file list: v_virtual_list drew nothing here, and LIMIT keeps it at 300 rows.
        .child(v_flex().id("git-log").absolute().inset_0().overflow_y_scroll().children(this.rows.map((r, i) => this.logRow(r, i, t, mono))))
        .child(Scrollbar.vertical("git-log").absolute().inset_0()))
      .when(Boolean(this.open), (el) => el.child(div().flex_1().min_h(0).relative().border_t(1).border_color(t.border).font_family(mono).text_size(11)
        .child(div().id("git-show-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.detailWidth).h_full().child(v_virtual_list("git-show", this.detail.length, 20, (i) => String(i),
            (range) => this.detail.slice(range.start, range.end).map((row) => diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical("git-show").viewport_from_layout().absolute().inset_0())));
  }

  logRow(r, i, t, mono) {
    // Each 2-column lane of the --graph text gets its own color.
    const lanes = [];
    for (let c = 0; c < r.graph.length; c += 2) lanes.push(div().text_color(t[LANES[(c / 2) % LANES.length]]).child(r.graph.slice(c, c + 2).replace("*", "●")));
    const graph = h_flex().flex_none().font_family(mono).whitespace_nowrap().children(lanes);
    if (!r.hash) return h_flex().w_full().h(22).flex_none().px(10).items_center().child(graph);
    const small = (text, color) => div().flex_none().text_size(11).text_color(color).child(text);
    return h_flex().id(`c-${i}`).w_full().h(22).flex_none().px(10).gap(8).items_center().cursor_pointer()
      .when(this.open === r.full, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(r.full, cx))
      .child(graph)
      .when(this.wide, (e) => e.child(div().flex_none().font_family(mono).text_size(11.5).text_color(t.dim).child(r.hash)))
      .child(div().flex_1().min_w(0).truncate().child(r.subject))
      .children(r.refs.filter((ref) => !ref.endsWith("/HEAD")).map((ref) => this.refChip(ref, t)))
      .when(this.unpushed.has(r.full), (e) => e.child(small("⬆ 未push", t.blocked)))
      .when(this.wide, (e) => e.child(small(r.author, t.dim).w(90).truncate()).child(small(r.when, t.dim).w(100).truncate()));
  }

  refChip(ref, t) {
    const head = ref.startsWith("HEAD -> "), tag = ref.startsWith("tag: "), name = ref.replace(/^(HEAD -> |tag: )/, "");
    const remote = !tag && this.remotes.some((r) => name.startsWith(`${r}/`)), gone = !tag && !remote && this.merged.has(name);
    return div().flex_none().px(5).rounded(4).border_1().text_size(11)
      .border_color(head || ref === "HEAD" ? t.accent : t.border).text_color(remote || tag ? t.dim : gone ? t.done : t.foreground)
      .child(gone ? `${name} · 已合併，可刪` : tag ? `tag ${name}` : name);
  }

  prView(t) {
    const data = this.root ? shared(remoteKey(this.root)) : null;
    const note = !this.root ? this.error ?? "不是 git repo" : !data ? "載入中…" : data.error;
    if (note) return div().p(12).text_color(t.dim).child(note);
    const word = data.kind === "github" ? "PR" : "MR", mine = data.pipelines.filter((p) => p.ref === this.branch).slice(0, 5);
    const ci = (s) => div().w(14).flex_none().text_color({ ok: t.ansi2, fail: t.ansi1, run: t.working, none: t.dim }[s]).child(ICON[s]);
    const row = (id, url) => h_flex().id(id).h(28).flex_none().px(10).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => cx.open_url(url));
    const section = (text) => div().px(10).pt(10).pb(4).text_size(11).text_color(t.dim).child(text);
    const empty = (text) => div().px(10).py(4).text_color(t.dim).child(text);
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
