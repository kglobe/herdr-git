import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, focused, exec, run, theme, shared, setShared, nextCommand, checking } from "herdr";
// git.js / repo.js come from the repo's shared/ folder: install.ps1 copies them in (mods can't import across folders).
import { firstLine, remoteKind, remoteData, summary, defaultBase, mergedBranches } from "./git.js";
import { repoCwd, remoteKey, gitIn } from "./repo.js";

const CLI = {
  github: [["gh", ["pr", "list", "--json", "number,title,headRefName,isDraft,reviewDecision,statusCheckRollup,url"]],
    ["gh", ["run", "list", "-L", "20", "--json", "headBranch,status,conclusion,displayTitle,url"]]],
  gitlab: [["glab", ["mr", "list", "-F", "json"]], ["glab", ["ci", "list", "-P", "20", "-F", "json"]]],
};

// Always shown in the status row, so it owns the remote (gh / glab) data that git-graph reads from shared:
// one fetcher, every 60 s while a git-graph pane exists in the window, else every 120 s.
export default class GitStatus extends View {
  init(_props, cx) {
    this.ticks = 0;
    if (checking()) return;
    cx.timer.every(60000, (cx) => {
      this.ticks++;
      this.refresh(cx, this.ticks % 2 === 0 || panes().some((p) => p.mod === "git-graph"));
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "open") this.open();
        if (c === "refresh") this.refresh(cx, true);
      }
    });
  }

  // Focuses the tab's git-graph pane, or splits one off the focused pane. Never toggles it closed.
  open() {
    const f = focused();
    if (!f) return;
    const graph = panes().find((p) => p.tab === f.tab && p.mod === "git-graph");
    if (graph) return run("pane.focus", { pane: graph.pane });
    const pane = f.pane ?? panes().find((p) => p.tab === f.tab)?.pane;
    run("pane.split", { direction: "right", mod: "git-graph", ...(pane ? { pane } : {}) });
  }

  refresh(cx, remote) {
    if (checking()) return;
    // A refresh asked for mid-load (the 重新整理 button) runs once that load ends instead of being dropped.
    if (this.loading) { this.again ||= remote; return; }
    const cwd = this.context = this.cwd;
    if (!cwd) { this.root = null; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await gitIn(cwd)(["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"]);
        if (cwd !== this.cwd) return;
        if (top.code !== 0) { this.root = null; return; }
        const [root, branch] = top.stdout.trim().split("\n");
        const git = gitIn(root);
        const base = await defaultBase(git);
        this.deletable = base ? (await mergedBranches(git, base, branch)).length : 0;
        const moved = root !== this.root;
        this.root = root; this.branch = branch;
        if (remote || moved) await this.fetchRemote(root, git);
      } catch { /* exec couldn't start (git missing): show nothing */ }
      finally {
        this.loading = false; cx.notify();
        if (this.again) { this.again = false; this.refresh(cx, true); }
      }
    });
  }

  async fetchRemote(root, git) {
    const url = await git(["remote", "get-url", "origin"]);
    if (url.code !== 0) return this.store(root, { kind: null, error: "沒有 origin 遠端" });
    const hosts = await git(["config", "--get-all", "herdr.gitlab-host"]);
    const kind = remoteKind(url.stdout.trim(), hosts.code === 0 ? hosts.stdout.split("\n").map((h) => h.trim()).filter(Boolean) : []);
    if (!kind) return this.store(root, { kind: null, error: "不支援的遠端" });
    const cli = CLI[kind][0][0];
    try {
      const [pr, ci] = await Promise.all(CLI[kind].map(([cmd, args]) => exec(cmd, args, { cwd: root, timeout: 20000 })));
      const bad = [pr, ci].find((r) => r.code !== 0);
      if (bad) return this.store(root, { kind, error: `${cli}：${firstLine(bad.stderr || bad.stdout)}` });
      this.store(root, { kind, ...remoteData(kind, JSON.parse(pr.stdout), JSON.parse(ci.stdout)) });
    } catch (e) {
      this.store(root, { kind, error: `${cli}：${firstLine(String(e))}` });
    }
  }

  // setShared writes a file and re-renders every mod: only when the data changed.
  store(root, data) {
    if (JSON.stringify(shared(remoteKey(root)) ?? null) !== JSON.stringify(data)) setShared(remoteKey(root), data);
  }

  render(cx) {
    this.cwd = repoCwd(this.cwd);
    if (this.cwd !== this.context) this.refresh(cx, false);
    const t = theme(), bar = h_flex().size_full().px(14).items_center().justify_end().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8);
    if (!this.root) return bar;
    const text = summary(shared(remoteKey(this.root)), this.branch, this.deletable);
    return bar.child(div().id("git-status").cursor_pointer().text_color(text?.includes("✗") ? t.ansi1 : text ? t.muted : t.dim)
      .hover((s) => s.text_color(t.foreground)).on_click(() => this.open()).child(text ?? "git"));
  }
}
