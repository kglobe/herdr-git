import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, focused, exec, run, theme, shared, setShared, nextCommand, checking } from "herdr";
// git.js / repo.js come from the repo's shared/ folder: install.ps1 copies them in (mods can't import across folders).
import { firstLine, remoteKind, remoteData, issueRows, summary, defaultBase, mergedBranches, fetchError, fetchDue, fetchResult, fetchStopped } from "./git.js";
import { repoCwd, remoteKey, gitIn } from "./repo.js";

const CLI = {
  github: [["gh", ["pr", "list", "--json", "number,title,headRefName,isDraft,reviewDecision,statusCheckRollup,url"]],
    ["gh", ["run", "list", "-L", "20", "--json", "headBranch,status,conclusion,displayTitle,url"]],
    ["gh", ["issue", "list", "--json", "number,title,labels,assignees,url"]]],
  // glab issue list spells it -O: there -F picks details / ids / urls.
  gitlab: [["glab", ["mr", "list", "-F", "json"]], ["glab", ["ci", "list", "-P", "20", "-F", "json"]], ["glab", ["issue", "list", "-O", "json"]]],
};

// Always shown in the status row, so it owns the remote (gh / glab) data that git-graph reads from shared:
// one fetcher, every 60 s while a git-graph pane exists in the window, else every 120 s.
export default class GitStatus extends View {
  init(_props, cx) {
    this.ticks = 0;
    this.fetches = new Map();
    if (checking()) return;
    cx.timer.every(60000, (cx) => {
      this.ticks++;
      this.refresh(cx, this.ticks % 2 === 0 || panes().some((p) => p.mod === "git-graph"));
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "open") this.open();
        // The 重新整理 button: also fetches now, restarting an auto-fetch that stopped after 3 failures.
        if (c === "refresh") { this.forceFetch = true; this.refresh(cx, true); }
      }
    });
  }

  // Toggles the tab's git-graph pane: closes it, or splits one off the focused pane.
  open() {
    const f = focused();
    if (!f) return;
    const graph = panes().find((p) => p.tab === f.tab && p.mod === "git-graph");
    if (graph) return run("pane.close", { pane: graph.pane });
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
        // Cleared here, not in the command handler: a refresh already running may be for another repo.
        if (this.forceFetch) { this.forceFetch = false; this.fetches.delete(root); }
        const due = panes().some((p) => p.mod === "git-graph") && fetchDue(this.fetches.get(root), Date.now());
        await Promise.all([due && this.fetch(root, git), (remote || moved) && this.fetchRemote(root, git)]);
      } catch { /* exec couldn't start (git missing): show nothing */ }
      finally {
        this.loading = false; cx.notify();
        if (this.again) { this.again = false; this.refresh(cx, true); }
      }
    });
  }

  // `git fetch origin` so the graph shows remote commits. Nothing here can answer a prompt, so none may appear:
  // no GCM window, SSH in batch mode (keeping the user's own ssh command), no auto gc holding locks.
  // exec, not gitIn: this writes refs (READ's --no-optional-locks is for reads) and needs a timeout.
  async fetch(root, git) {
    // No origin: fetchRemote already says so; count it as a quiet success so it isn't retried every tick.
    if ((await git(["remote", "get-url", "origin"])).code !== 0) return this.fetches.set(root, fetchResult(undefined, null, Date.now()));
    const ssh = (await git(["config", "core.sshCommand"])).stdout.trim() || "ssh";
    const r = await exec("git", ["-c", "credential.interactive=never", "-c", `core.sshCommand=${ssh} -o BatchMode=yes -o ConnectTimeout=10`,
      "-c", "gc.auto=0", "-c", "maintenance.auto=false", "fetch", "--quiet", "origin"], { cwd: root, timeout: 30000 })
      .catch((e) => ({ code: 1, stderr: String(e) }));
    const error = r.code ? fetchError(r.stderr || r.stdout) : null;
    this.fetches.set(root, fetchResult(this.fetches.get(root), error, Date.now()));
  }

  async fetchRemote(root, git) {
    const url = await git(["remote", "get-url", "origin"]);
    if (url.code !== 0) return this.store(root, { kind: null, error: "沒有 origin 遠端" });
    const hosts = await git(["config", "--get-all", "herdr.gitlab-host"]);
    const kind = remoteKind(url.stdout.trim(), hosts.code === 0 ? hosts.stdout.split("\n").map((h) => h.trim()).filter(Boolean) : []);
    if (!kind) return this.store(root, { kind: null, error: "不支援的遠端" });
    const cli = CLI[kind][0][0];
    try {
      const [pr, ci, issue] = await Promise.all(CLI[kind].map(([cmd, args]) => exec(cmd, args, { cwd: root, timeout: 20000 })));
      const bad = [pr, ci].find((r) => r.code !== 0);
      if (bad) return this.store(root, { kind, error: `${cli}：${firstLine(bad.stderr || bad.stdout)}` });
      // Issues can be switched off per repo: that failure must not hide the PRs.
      const issues = issue.code === 0 ? { issues: issueRows(kind, JSON.parse(issue.stdout)) } : { issues: [], issueError: `${cli}：${firstLine(issue.stderr || issue.stdout)}` };
      this.store(root, { kind, ...remoteData(kind, JSON.parse(pr.stdout), JSON.parse(ci.stdout)), ...issues });
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
    const f = this.fetches.get(this.root);
    const text = summary(shared(remoteKey(this.root)), this.branch, this.deletable, fetchStopped(f) ? f.error : null);
    return bar.child(div().id("git-status").cursor_pointer().text_color(text?.includes("✗") ? t.ansi1 : text ? t.muted : t.dim)
      .hover((s) => s.text_color(t.foreground)).on_click(() => this.open()).child(text ?? "git"));
  }
}
