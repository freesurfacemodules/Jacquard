import { useMemo } from "react";
import { usePatch } from "../state/PatchContext";

interface BreadcrumbSegment {
  id: string | null;
  label: string;
}

export function SubpatchBreadcrumb(): JSX.Element | null {
  const { activeSubpatchPath, rootGraph, exitSubpatch } = usePatch();

  const segments = useMemo<BreadcrumbSegment[]>(() => {
    const subpatches = rootGraph.subpatches ?? {};
    const entries: BreadcrumbSegment[] = [
      { id: null, label: "Patch" }
    ];
    for (const id of activeSubpatchPath) {
      const name = subpatches[id]?.name ?? "Subpatch";
      entries.push({ id, label: name });
    }
    return entries;
  }, [activeSubpatchPath, rootGraph]);

  if (segments.length <= 1) {
    return null;
  }

  const handleCrumbClick = (index: number) => {
    const levels = activeSubpatchPath.length - index;
    if (levels > 0) {
      exitSubpatch(levels);
    }
  };

  return (
    <nav className="subpatch-breadcrumb" aria-label="Subpatch navigation">
      <ol>
        {segments.map((segment, index) => {
          const isActive = index === segments.length - 1;
          return (
            <li key={segment.id ?? "root"}>
              {isActive ? (
                <span className="subpatch-breadcrumb__current">{segment.label}</span>
              ) : (
                <button type="button" onClick={() => handleCrumbClick(index)}>
                  {segment.label}
                </button>
              )}
              {index < segments.length - 1 ? <span className="subpatch-breadcrumb__divider">›</span> : null}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="subpatch-breadcrumb__exit"
        onClick={() => exitSubpatch(1)}
      >
        Exit
      </button>
    </nav>
  );
}
