import type { Clock, IdGen, Store } from "@emos/core";

export interface ImportUnit {
  key: string;
  entity: string;
  describe: string;
  apply(store: Store, ctx: ImportCtx): { entityId: string; created: boolean };
}

export interface ImportCtx {
  ids: IdGen;
  clock: Clock;
  timeZone: string;
  selfPersonId: string;
  selfName: string;
  personByName(name: string): string | null;
  goalBySlug(slug: string): string | null;
  unparseable(file: string, line: number, reason: string): void;
}

export interface SourceFs {
  read(p: string): string;
  list(glob: string): string[];
  mtime(p: string): Date;
}

export interface Importer {
  name: string;
  collect(root: string, fs: SourceFs, ctx: ImportCtx): ImportUnit[];
}

export interface ImportReportCounts {
  total: number;
  created: number;
  existing: number;
}

class DryRunAbort extends Error {
  constructor(public counts: ImportReportCounts) {
    super("dry run rollback");
  }
}

export function runUnits(
  store: Store,
  units: ImportUnit[],
  ctx: ImportCtx,
  dryRun: boolean,
): ImportReportCounts {
  function applyAll(): ImportReportCounts {
    const counts: ImportReportCounts = { total: units.length, created: 0, existing: 0 };
    for (const unit of units) {
      const cached = store.importKeys.get(unit.key);
      if (cached) {
        counts.existing++;
        continue;
      }
      const { entityId, created } = unit.apply(store, ctx);
      store.importKeys.set(unit.key, unit.entity, entityId);
      if (created) counts.created++;
    }
    return counts;
  }

  if (dryRun) {
    try {
      store.transaction(() => {
        const counts = applyAll();
        throw new DryRunAbort(counts);
      });
    } catch (err) {
      if (err instanceof DryRunAbort) return err.counts;
      throw err;
    }
    // Unreachable, but satisfies the compiler.
    return { total: units.length, created: 0, existing: 0 };
  }

  return store.transaction(applyAll);
}
