import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLog, remoteKind, ciState, remoteData, summary, showRows, parseShow, samePath, parseWorktrees } from "../shared/git.js";

const US = "\x1f";

test("parseLog splits graph, fields and refs; graph-only lines keep the graph", () => {
  const text = [
    `* ${US}a1b2c3d${US}fix(hooks): gate${US}HEAD -> main, origin/main, tag: v1${US}Wayne${US}2 hours ago${US}a1b2c3dfull`,
    `| * ${US}9f8e7d6${US}wip${US}${US}Wayne${US}3 days ago${US}9f8e7d6full`,
    "|/  ",
  ].join("\n");
  assert.deepEqual(parseLog(text), [
    { graph: "* ", hash: "a1b2c3d", subject: "fix(hooks): gate", refs: ["HEAD -> main", "origin/main", "tag: v1"], author: "Wayne", when: "2 hours ago", full: "a1b2c3dfull" },
    { graph: "| * ", hash: "9f8e7d6", subject: "wip", refs: [], author: "Wayne", when: "3 days ago", full: "9f8e7d6full" },
    { graph: "|/" },
  ]);
});

test("remoteKind picks the CLI by host, null for others", () => {
  assert.equal(remoteKind("https://github.com/kglobe/herdr-notify-win.git"), "github");
  assert.equal(remoteKind("git@github.com:kglobe/x.git"), "github");
  assert.equal(remoteKind("https://git.example.com/team/app"), "gitlab");
  assert.equal(remoteKind("ssh://git@git.example.com:2222/team/x.git"), "gitlab");
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
