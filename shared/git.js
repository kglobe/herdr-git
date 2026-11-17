// Pure helpers shared by git-graph and git-status (no herdr imports, so node tests can load them).

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie), as in the changes mod.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const US = "\x1f";
export const LOG_FORMAT = `--format=${US}%h${US}%s${US}%D${US}%an${US}%ar${US}%H`;
export const ICON = { ok: "✓", fail: "✗", run: "●", none: "–" };

export function parseLog(text) {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const at = line.indexOf(US);
    if (at < 0) return { graph: line.trimEnd() };
    const [hash, subject, refs, author, when, full] = line.slice(at + 1).split(US);
    return { graph: line.slice(0, at), hash, subject, refs: refs ? refs.split(", ") : [], author, when, full };
  });
}

const HOSTS = { "github.com": "github", "git.example.com": "gitlab" };
export function remoteKind(url) {
  const host = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)/i.exec(url ?? "")?.[1]?.toLowerCase();
  return HOSTS[host] ?? null;
}

const GL = { success: "ok", failed: "fail", running: "run", pending: "run", created: "run", preparing: "run", waiting_for_resource: "run", scheduled: "run" };
const CONTEXT = { success: "ok", failure: "fail", error: "fail", pending: "run", expected: "run" };
const FAILED = ["failure", "timed_out", "startup_failure", "action_required"];
const RANK = ["none", "ok", "run", "fail"];

// One CI state from a GitLab pipeline status, a gh run / check run, or a gh statusCheckRollup array.
export function ciState(x) {
  if (typeof x === "string") return GL[x] ?? "none";
  if (Array.isArray(x)) return x.map(ciState).reduce((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a), "none");
  if (x?.state) return CONTEXT[x.state.toLowerCase()] ?? "none";
  const status = (x?.status ?? "").toLowerCase(), conclusion = (x?.conclusion ?? "").toLowerCase();
  if (status !== "completed") return "run";
  return conclusion === "success" ? "ok" : FAILED.includes(conclusion) ? "fail" : "none";
}

const words = (s) => (s ?? "").toLowerCase().replace(/_/g, " ");

// gh pr list + gh run list, or glab mr list + glab ci list, in one shape.
export function remoteData(kind, prs, runs) {
  if (kind === "github") return {
    prs: prs.map((p) => ({ id: `#${p.number}`, title: p.title, branch: p.headRefName, draft: Boolean(p.isDraft), ci: ciState(p.statusCheckRollup ?? []), review: words(p.reviewDecision), url: p.url })),
    pipelines: runs.map((r) => ({ ref: r.headBranch, ci: ciState(r), title: r.displayTitle ?? "", url: r.url })),
  };
  const pipelines = runs.map((p) => ({ ref: p.ref, ci: ciState(p.status), title: "", url: p.web_url }));
  return {
    prs: prs.map((m) => ({
      id: `!${m.iid}`, title: m.title, branch: m.source_branch, draft: Boolean(m.draft), review: words(m.detailed_merge_status), url: m.web_url,
      ci: (pipelines.find((p) => p.ref === `refs/merge-requests/${m.iid}/head`) ?? pipelines.find((p) => p.ref === m.source_branch))?.ci ?? "none",
    })),
    pipelines,
  };
}

// The status-bar text: only what the spaces sidebar doesn't show. Null when there's nothing to say.
export function summary(remote, branch, deletable) {
  const pr = remote?.prs?.find((p) => p.branch === branch), pipe = remote?.pipelines?.find((p) => p.ref === branch);
  const parts = [
    pr && `${remote.kind === "github" ? "PR" : "MR"} ${pr.id} ${ICON[pr.ci]}`,
    pipe && `CI ${ICON[pipe.ci]}`,
    deletable > 0 && `${deletable} 分支可刪`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// `git show --stat -p` rows, numbered inside hunks only (the changes mod's diffRows numbers every line).
export function showRows(lines) {
  let old = 0, next = 0, hunk = false;
  return lines.map((line) => {
    if (line.startsWith("diff ")) hunk = false;
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; hunk = true; return { kind: "@", text: line }; }
    const kind = line[0];
    if (hunk && kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (hunk && kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (hunk && kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: untab(line) || " " };
  });
}

export function parseWorktrees(text) {
  return text.split("\n\n").map((block) => ({ path: /^worktree (.+)$/m.exec(block)?.[1], branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? "(detached)" }))
    .filter((w) => w.path);
}

const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
export const samePath = (a, b) => Boolean(a && b) && norm(a) === norm(b);

// origin/HEAD, else main, else master: what "merged" is measured against. Null if none exists.
export async function defaultBase(git) {
  const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim();
  for (const name of ["main", "master"]) if ((await git(["rev-parse", "--verify", "--quiet", name])).code === 0) return name;
  return null;
}

// Local branches merged into base, minus base itself and the checked-out one.
export async function mergedBranches(git, base, current) {
  const r = await git(["branch", "--merged", base, "--format=%(refname:short)"]);
  const short = base.replace(/^origin\//, "");
  return r.code === 0 ? r.stdout.split("\n").map((s) => s.trim()).filter((b) => b && b !== short && b !== current) : [];
}
