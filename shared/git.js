// Pure helpers shared by git-graph and git-status (no herdr imports, so node tests can load them).

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie), as in the changes mod.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const US = "\x1f";
export const LOG_FORMAT = `--format=${US}%h${US}%s${US}%D${US}%an${US}%ct${US}%H`;
export const ICON = { ok: "✓", fail: "✗", run: "●", none: "–" };
export const firstLine = (s) => (s ?? "").trim().split("\n")[0].slice(0, 160);

export function parseLog(text) {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const at = line.indexOf(US);
    if (at < 0) return { graph: line.trimEnd() };
    const [hash, subject, refs, author, when, full] = line.slice(at + 1).split(US);
    return { graph: line.slice(0, at), hash, subject, refs: refs ? refs.split(", ") : [], author, when, full };
  });
}

// Unix seconds (%ct) as 剛剛 / Nm / Nh / Nd, as the Agents list writes it.
export function ago(seconds, now) {
  const d = now - seconds;
  if (d < 60) return "剛剛";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

// "feat(scope): text" → ["feat(scope): ", "text"], so the repeated prefix can be drawn faint.
export function splitSubject(s) {
  const m = /^\w+(\([^)]*\))?!?: /.exec(s);
  return m ? [m[0], s.slice(m[0].length)] : ["", s];
}

// gitlabHosts: self-hosted GitLab hosts, from `git config --get-all herdr.gitlab-host`.
export function remoteKind(url, gitlabHosts = []) {
  const host = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)/i.exec(url ?? "")?.[1]?.toLowerCase();
  if (host === "github.com") return "github";
  return host && (host === "gitlab.com" || gitlabHosts.some((h) => h.toLowerCase() === host)) ? "gitlab" : null;
}

const GL = { success: "ok", failed: "fail", running: "run", pending: "run", created: "run", preparing: "run", waiting_for_resource: "run", scheduled: "run" };
const CONTEXT = { success: "ok", failure: "fail", error: "fail", pending: "run", expected: "run" };
const FAILED = ["failure", "timed_out", "startup_failure", "action_required"];
const RANK = ["none", "ok", "run", "fail"];

// One CI state from a GitLab pipeline status, a gh run / check run, or a gh statusCheckRollup array.
export function ciState(x) {
  if (!x) return "none";
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
export function summary(remote, branch, deletable, fetchErr) {
  const pr = remote?.prs?.find((p) => p.branch === branch), pipe = remote?.pipelines?.find((p) => p.ref === branch);
  const parts = [
    pr && `${remote.kind === "github" ? "PR" : "MR"} ${pr.id} ${ICON[pr.ci]}`,
    pipe && `CI ${ICON[pipe.ci]}`,
    deletable > 0 && `${deletable} 分支可刪`,
    fetchErr && `${ICON.fail} ${fetchErr}，按 Git 面板的重新整理重試`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// Text draws a tab as nothing: pad each to the next 4-column stop. Copied from the changes mod.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Patch lines that only repeat what the file header and line numbers already say.
const NOISE = /^(index |--- |\+\+\+ |(new|deleted) file mode|old mode|new mode|similarity index|rename (from|to) )/;

// Patch rows, numbered (old and new side) inside hunks only (the changes mod's diffRows numbers every line).
// "diff --git" becomes a file header; a hunk header keeps only its function context.
export function showRows(lines) {
  let old = 0, next = 0, hunk = false;
  return lines.flatMap((line) => {
    const file = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (file) { hunk = false; return [{ kind: "gap", text: " " }, { kind: "file", text: file[1] }]; }
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; hunk = true; return { kind: "@", text: `@@ -${old} +${next} @@  ${untab(match[3])}`.trimEnd() }; }
    if (!hunk && NOISE.test(line)) return [];
    const kind = line[0];
    if (!hunk || !"-+ ".includes(kind)) return { kind: "", text: untab(line) || " " };
    return { kind, old: kind === "+" ? undefined : old++, new: kind === "-" ? undefined : next++, text: untab(line.slice(1)) || " " };
  });
}

const RS = "\x1e";
export const SHOW_FORMAT = `--format=%h${US}%an${US}%ad${US}%B${RS}`;

// `git show SHOW_FORMAT --date=... --numstat -p` → detail rows: title, meta, message body, per-file +/- counts, then the patch.
export function parseShow(text) {
  const at = text.indexOf(RS);
  const [hash, author, date, ...msg] = text.slice(0, at).split(US);
  const [subject, ...body] = msg.join(US).trim().split("\n");
  const lines = text.slice(at + 1).replace(/^\n+/, "").replace(/\n$/, "").split("\n");
  const cut = lines.findIndex((l) => l.startsWith("diff "));
  const stat = (cut < 0 ? lines : lines.slice(0, cut)).filter(Boolean).map((l) => {
    const [add, del, ...path] = l.split("\t");
    return { kind: "stat", add, del, text: path.join("\t") };
  });
  // Binary files count "-": they add nothing to the totals or the bar scale.
  const sum = (key) => stat.reduce((n, s) => n + (+s[key] || 0), 0);
  const max = Math.max(1, ...stat.map((s) => (+s.add || 0) + (+s.del || 0)));
  for (const s of stat) s.max = max;
  if (stat.length) stat.unshift({ kind: "files", add: String(sum("add")), del: String(sum("del")), text: `${stat.length} 個檔案` });
  const message = body.join("\n").trim();
  const prose = message ? message.split("\n").map((l) => ({ kind: /^[\w-]+-by: /i.test(l) ? "trailer" : "body", text: untab(l) || " " })) : [];
  // Trailers (Co-Authored-By…) go after the file list: they say least about what changed.
  return [
    { kind: "title", text: subject || " " }, { kind: "meta", hash, text: `${author} · ${date}` },
    ...prose.filter((r) => r.kind === "body").filter((r, i, a) => a.slice(i).some((x) => x.text.trim())), ...stat, ...prose.filter((r) => r.kind === "trailer"),
    ...showRows(cut < 0 ? [] : lines.slice(cut)),
  ];
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

// Background fetch: auth is checked first because a denied SSH key also says "Could not read from remote repository".
const FETCH_ERRORS = [
  [/authentication failed|access denied|permission denied|could not read (username|password)|terminal prompts disabled|host key verification failed|\b40[13]\b/i, "授權失敗"],
  [/could not resolve host|timed out|connection (refused|reset)|failed to connect|network is unreachable/i, "連不到遠端"],
];
export const fetchError = (stderr) => `${FETCH_ERRORS.find(([re]) => re.test(stderr))?.[1] ?? "fetch 失敗"}：${firstLine(stderr)}`;

// Per-repo auto-fetch state { at, fails, error }: due every FETCH_EVERY, stopped after 3 straight failures
// (until the state is cleared); `error` is null on success.
export const FETCH_EVERY = 5 * 60000;
export const fetchStopped = (s) => s?.fails >= 3;
export const fetchDue = (s, now) => !s || (!fetchStopped(s) && now - s.at >= FETCH_EVERY);
export const fetchResult = (s, error, now) => ({ at: now, fails: error ? (s?.fails ?? 0) + 1 : 0, error });
