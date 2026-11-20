import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLog, ago, splitSubject, remoteKind, ciState, remoteData, issueRows, summary, showRows, parseShow, samePath, parseWorktrees, fetchError, fetchDue, fetchResult, FETCH_EVERY, logRefs } from "../shared/git.js";

const US = "\x1f";

test("parseLog splits graph, fields and refs; graph-only lines keep the graph", () => {
  const text = [
    `* ${US}a1b2c3d${US}fix(hooks): gate${US}HEAD -> main, origin/main, tag: v1${US}Wayne${US}1700000000${US}a1b2c3dfull`,
    `| * ${US}9f8e7d6${US}wip${US}${US}Wayne${US}1699990000${US}9f8e7d6full`,
    "|/  ",
  ].join("\n");
  assert.deepEqual(parseLog(text), [
    { graph: "* ", hash: "a1b2c3d", subject: "fix(hooks): gate", refs: ["HEAD -> main", "origin/main", "tag: v1"], author: "Wayne", when: "1700000000", full: "a1b2c3dfull" },
    { graph: "| * ", hash: "9f8e7d6", subject: "wip", refs: [], author: "Wayne", when: "1699990000", full: "9f8e7d6full" },
    { graph: "|/" },
  ]);
});

test("ago writes commit seconds as 剛剛 / m / h / d, like the Agents list", () => {
  const now = 1_000_000;
  assert.equal(ago(now - 30, now), "剛剛");
  assert.equal(ago(now - 5 * 60, now), "5m");
  assert.equal(ago(now - 3 * 3600, now), "3h");
  assert.equal(ago(now - 2 * 86400 - 5, now), "2d");
});

test("splitSubject separates a conventional-commit prefix, else leaves the subject whole", () => {
  assert.deepEqual(splitSubject("feat(herdr): 加 Repos 面板"), ["feat(herdr): ", "加 Repos 面板"]);
  assert.deepEqual(splitSubject("fix!: drop node 18"), ["fix!: ", "drop node 18"]);
  assert.deepEqual(splitSubject("Merge branch 'main'"), ["", "Merge branch 'main'"]);
  assert.deepEqual(splitSubject("wip"), ["", "wip"]);
});

test("remoteKind picks the CLI by host, null for others", () => {
  assert.equal(remoteKind("https://github.com/kglobe/herdr-notify-win.git"), "github");
  assert.equal(remoteKind("git@github.com:kglobe/x.git"), "github");
  assert.equal(remoteKind("https://gitlab.com/a/b.git"), "gitlab");
  assert.equal(remoteKind("https://git.example.com/team/app", ["git.example.com"]), "gitlab");
  assert.equal(remoteKind("ssh://git@Git.Example.com:2222/team/x.git", ["git.example.com"]), "gitlab");
  assert.equal(remoteKind("https://git.example.com/team/app"), null);
  assert.equal(remoteKind("https://bitbucket.org/a/b.git"), null);
  assert.equal(remoteKind(""), null);
});

test("ciState folds gh runs, gh rollups and gitlab pipelines to ok/fail/run/none", () => {
  assert.equal(ciState({ status: "completed", conclusion: "success" }), "ok");
  assert.equal(ciState({ status: "completed", conclusion: "failure" }), "fail");
  assert.equal(ciState({ status: "in_progress", conclusion: "" }), "run");
  assert.equal(ciState({ status: "completed", conclusion: "cancelled" }), "none");
  assert.equal(ciState(null), "none");
  assert.equal(ciState([null]), "none");
  assert.equal(ciState("success"), "ok");
  assert.equal(ciState("failed"), "fail");
  assert.equal(ciState("running"), "run");
  assert.equal(ciState("pending"), "run");
  assert.equal(ciState("canceled"), "none");
  assert.equal(ciState([]), "none");
  assert.equal(ciState([{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "PENDING" }]), "run");
  assert.equal(ciState([{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "FAILURE" }, { state: "PENDING" }]), "fail");
  assert.equal(ciState([{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "SUCCESS" }]), "ok");
});

test("remoteData normalizes GitHub PRs and runs", () => {
  const prs = [{ number: 12, title: "feat", headRefName: "wayne/x", isDraft: true, reviewDecision: "CHANGES_REQUESTED", statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }], url: "https://github.com/a/b/pull/12" }];
  const runs = [{ headBranch: "wayne/x", status: "completed", conclusion: "success", displayTitle: "feat", url: "https://github.com/a/b/actions/runs/1" }];
  assert.deepEqual(remoteData("github", prs, runs), {
    prs: [{ id: "#12", title: "feat", branch: "wayne/x", draft: true, ci: "fail", review: "changes requested", url: "https://github.com/a/b/pull/12" }],
    pipelines: [{ ref: "wayne/x", ci: "ok", title: "feat", url: "https://github.com/a/b/actions/runs/1" }],
  });
});

test("remoteData matches GitLab MR pipelines by merge-request ref, else by branch", () => {
  const mrs = [
    { iid: 3361, title: "help", source_branch: "feat/help", draft: false, detailed_merge_status: "not_approved", web_url: "https://g/mr/3361" },
    { iid: 7, title: "old", source_branch: "feat/old", draft: false, detailed_merge_status: "mergeable", web_url: "https://g/mr/7" },
    { iid: 8, title: "none", source_branch: "feat/none", draft: true, detailed_merge_status: "draft_status", web_url: "https://g/mr/8" },
  ];
  const pipes = [
    { ref: "main", status: "success", web_url: "https://g/p/3" },
    { ref: "refs/merge-requests/3361/head", status: "running", web_url: "https://g/p/2" },
    { ref: "feat/old", status: "failed", web_url: "https://g/p/1" },
  ];
  const data = remoteData("gitlab", mrs, pipes);
  assert.deepEqual(data.prs.map((p) => [p.id, p.ci, p.review, p.draft]), [["!3361", "run", "not approved", false], ["!7", "fail", "mergeable", false], ["!8", "none", "draft status", true]]);
  assert.deepEqual(data.pipelines[0], { ref: "main", ci: "ok", title: "", url: "https://g/p/3" });
});

test("issueRows normalizes GitHub and GitLab issues", () => {
  assert.deepEqual(issueRows("github", [{ number: 5, title: "bug", labels: [{ name: "bug" }, { name: "ui" }], assignees: [{ login: "wayne" }], url: "https://github.com/a/b/issues/5" }]),
    [{ id: "#5", title: "bug", labels: "bug, ui", who: "wayne", url: "https://github.com/a/b/issues/5" }]);
  assert.deepEqual(issueRows("gitlab", [{ iid: 9, title: "slow", labels: ["perf"], assignees: [], web_url: "https://g/issues/9" }]),
    [{ id: "#9", title: "slow", labels: "perf", who: "", url: "https://g/issues/9" }]);
});

test("summary lists only what the sidebar lacks; null when nothing to say", () => {
  const remote = { kind: "gitlab", prs: [{ id: "!12", branch: "wayne/x", ci: "fail" }], pipelines: [{ ref: "wayne/x", ci: "run" }] };
  assert.equal(summary(remote, "wayne/x", 2), "MR !12 ✗ · CI ● · 2 分支可刪");
  assert.equal(summary({ kind: "github", prs: [], pipelines: [] }, "main", 1), "1 分支可刪");
  assert.equal(summary({ kind: "github", prs: [{ id: "#3", branch: "a", ci: "ok" }], pipelines: [] }, "a", 0), "PR #3 ✓");
  assert.equal(summary(null, "main", 0), null);
  assert.equal(summary({ kind: "gitlab", error: "glab：401" }, "main", 3), "3 分支可刪");
});

test("parseWorktrees reads porcelain blocks; detached ones say so", () => {
  const text = "worktree D:/GitHub/x\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/Users/u/.herdr/worktrees/x/wayne/y\nHEAD def\ndetached\n\n";
  assert.deepEqual(parseWorktrees(text), [{ path: "D:/GitHub/x", branch: "main" }, { path: "C:/Users/u/.herdr/worktrees/x/wayne/y", branch: "(detached)" }]);
});

test("showRows numbers hunk lines, turns diff --git into a file header and drops index/---/+++", () => {
  const rows = showRows(["diff --git a/a.js b/a.js", "index 1..2 100644", "--- a/a.js", "+++ b/a.js", "@@ -3,2 +3,2 @@ def f():", " keep", "-old", "+new"]);
  assert.deepEqual(rows.map((r) => [r.kind, r.old, r.new, r.text]),
    [["gap", undefined, undefined, " "], ["file", undefined, undefined, "a.js"], ["@", undefined, undefined, "@@ -3 +3 @@  def f():"], [" ", 3, 3, "keep"], ["-", 4, undefined, "old"], ["+", undefined, 4, "new"]]);
});

test("parseShow splits header, message, trailers, numstat and patch", () => {
  const text = "abc1234\x1fWayne\x1f2026-11-17 12:04\x1ffix: x\n\nwhy\n\nCo-Authored-By: C <c@x>\n\x1e\n2\t1\ta.js\n-\t-\timg.png\n\ndiff --git a/a.js b/a.js\n@@ -1 +1 @@\n-a\n+b\n";
  assert.deepEqual(parseShow(text).map((r) => r.kind),
    ["title", "meta", "body", "files", "stat", "stat", "trailer", "gap", "file", "@", "-", "+"]);
  const rows = parseShow(text);
  assert.deepEqual([rows[1].hash, rows[1].text], ["abc1234", "Wayne · 2026-11-17 12:04"]);
  assert.deepEqual([rows[3].add, rows[3].del, rows[3].text], ["2", "1", "2 個檔案"]);
  assert.deepEqual([rows[4].add, rows[4].del, rows[4].text, rows[4].max], ["2", "1", "a.js", 3]);
});

test("samePath ignores slash direction, case and trailing slash", () => {
  assert.equal(samePath("D:/GitHub/x", "d:\\github\\x\\"), true);
  assert.equal(samePath("D:/GitHub/x", "D:/GitHub/y"), false);
  assert.equal(samePath(null, "D:/x"), false);
});

test("fetchError names auth and network failures, else says fetch failed", () => {
  assert.equal(fetchError("remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://x/'"), "授權失敗：remote: HTTP Basic: Access denied");
  assert.equal(fetchError("git@x: Permission denied (publickey).\nfatal: Could not read from remote repository."), "授權失敗：git@x: Permission denied (publickey).");
  assert.equal(fetchError("fatal: could not read Username for 'https://x': terminal prompts disabled"), "授權失敗：fatal: could not read Username for 'https://x': terminal prompts disabled");
  assert.equal(fetchError("fatal: unable to access 'https://x/': Could not resolve host: x"), "連不到遠端：fatal: unable to access 'https://x/': Could not resolve host: x");
  assert.equal(fetchError("ssh: connect to host x port 22: Connection timed out"), "連不到遠端：ssh: connect to host x port 22: Connection timed out");
  assert.equal(fetchError("fatal: couldn't find remote ref main"), "fetch 失敗：fatal: couldn't find remote ref main");
  assert.equal(fetchError("fatal: 'origin' does not appear to be a git repository\nfatal: Could not read from remote repository."), "fetch 失敗：fatal: 'origin' does not appear to be a git repository");
});

test("summary appends a stopped fetch's error next to the PR and CI badges", () => {
  const remote = { kind: "github", prs: [{ id: "#7", branch: "f", ci: "ok" }], pipelines: [] };
  assert.equal(summary(remote, "f", 0, "授權失敗：x"), "PR #7 ✓ · ✗ 授權失敗：x，按 Git 面板的重新整理重試");
  assert.equal(summary(null, "f", 0, "連不到遠端：y"), "✗ 連不到遠端：y，按 Git 面板的重新整理重試");
  assert.equal(summary(remote, "f", 0, null), "PR #7 ✓");
});

test("auto-fetch runs every 5 min, stops after 3 straight failures, a success resets", () => {
  const t0 = 1_000_000;
  assert.equal(fetchDue(undefined, t0), true);
  let s = fetchResult(undefined, "x", t0);
  assert.equal(fetchDue(s, t0 + FETCH_EVERY - 1), false);
  assert.equal(fetchDue(s, t0 + FETCH_EVERY), true);
  s = fetchResult(s, "x", t0 + FETCH_EVERY);
  s = fetchResult(s, "y", t0 + 2 * FETCH_EVERY);
  assert.deepEqual(s, { at: t0 + 2 * FETCH_EVERY, fails: 3, error: "y" });
  assert.equal(fetchDue(s, t0 + 10 * FETCH_EVERY), false);
  assert.deepEqual(fetchResult({ at: 0, fails: 2, error: "x" }, null, t0), { at: t0, fails: 0, error: null });
});

test("logRefs picks the graph's refs: all or current branch, with or without remotes", () => {
  assert.deepEqual(logRefs(true, true, "main"), ["--all"]);
  // Remote refs off: also drop their labels, or origin/main still shows on local commits.
  assert.deepEqual(logRefs(true, false, "main"), ["--branches", "--tags", "HEAD", "--decorate-refs-exclude=refs/remotes"]);
  assert.deepEqual(logRefs(false, true, "main"), ["HEAD", "--remotes=*/main"]);
  assert.deepEqual(logRefs(false, false, "main"), ["HEAD", "--decorate-refs-exclude=refs/remotes"]);
  // Detached HEAD has no branch name to match on the remote.
  assert.deepEqual(logRefs(false, true, ""), ["HEAD"]);
});
