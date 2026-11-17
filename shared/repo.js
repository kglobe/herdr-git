import { spaces, panes, focused, exec } from "herdr";
import { READ } from "./git.js";

// A read-only git runner for one folder: every call gets READ.
export const gitIn = (cwd) => (args) => exec("git", [...READ, ...args], { cwd });

// The folder to show: the focused terminal's, or `prev` while a mod pane (git-graph itself) has focus
// and `prev` is still a terminal's in the focused tab, else the first terminal in that tab. A mod pane's cwd is null, so the changes mod's location()
// would jump to the space folder when you click into the graph.
// shortcut: spaces on another machine show nothing; add `on` to every exec when they're needed.
export function repoCwd(prev) {
  const f = focused(), space = spaces().find((s) => s.active);
  if (!f || space?.machine) return null;
  if (f.pane === null) return f.terminal?.includes("/") ? null : f.cwd ?? null;
  const pane = panes().find((p) => p.pane === f.pane);
  if (pane && !pane.mod) return pane.cwd ?? f.cwd ?? null;
  const terminals = panes().filter((p) => p.tab === f.tab && !p.mod);
  return terminals.find((p) => p.cwd === prev)?.cwd ?? terminals[0]?.cwd ?? null;
}

export const remoteKey = (root) => `git-remote:${root}`;
