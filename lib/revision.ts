import fs from "node:fs";
import path from "node:path";

export type Revision = {
  commit: string;
  short: string;
  branch: string;
  main: string | null;
  onMain: boolean;
  dirty: boolean;
  deployedAt: string;
};

export const REPO_URL = "https://github.com/JoeProAI/blast-door";

let cached: Revision | null | undefined;

// deploy/deploy.sh writes .revision.json next to the app before the VM builds it.
export function readRevision(file = process.env.BLASTDOOR_REVISION_FILE || path.join(process.cwd(), ".revision.json")): Revision | null {
  try {
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof r.commit !== "string" || !/^[0-9a-f]{40}$/.test(r.commit)) return null;
    return {
      commit: r.commit,
      short: r.commit.slice(0, 7),
      branch: String(r.branch ?? ""),
      main: typeof r.main === "string" && /^[0-9a-f]{40}$/.test(r.main) ? r.main : null,
      onMain: r.onMain === true,
      dirty: r.dirty === true,
      deployedAt: String(r.deployedAt ?? ""),
    };
  } catch {
    return null;
  }
}

export function revision(): Revision | null {
  if (cached === undefined) cached = readRevision();
  return cached;
}
