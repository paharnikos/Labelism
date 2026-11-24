import { useMemo, useState } from 'react';
import type { DatasetImage, LabelClass, ReviewStatus, SplitType } from '../types/annotation';
import { resolveTaxonomy } from '../utils/geometry';

interface AnalyticsViewProps {
  projectName: string;
  images: DatasetImage[];
  classes: LabelClass[];
}

export default function AnalyticsView({ projectName, images, classes }: AnalyticsViewProps) {
  const [groupMode, setGroupMode] = useState<'class' | 'object'>('object');

  const stats = useMemo(() => {
    const manualAnns = images.flatMap((img) =>
      img.annotations.filter((a) => a.source !== 'ai_suggestion')
    );
    const totalImages = images.length;
    const captionedImages = images.filter((i) => i.caption.trim().length > 0).length;
    const verifiedImages = images.filter((i) => i.status === 'verified').length;

    const geomCounts = { bbox: 0, polygon: 0, polyline: 0, keypoint: 0 };
    const classCounts = new Map<string, { label: string; color: string; count: number }>();
    const objectCounts = new Map<string, { label: string; color: string; count: number }>();

    for (const c of classes) {
      classCounts.set(c.id, { label: c.name, color: c.color, count: 0 });
      for (const o of c.objects) {
        objectCounts.set(`${c.id}::${o.id}`, {
          label: `${c.name} / ${o.name}`,
          color: o.color,
          count: 0,
        });
      }
    }

    for (const ann of manualAnns) {
      geomCounts[ann.type] += 1;
      const tax = resolveTaxonomy(classes, ann.classId, ann.objectId);
      const cRow = classCounts.get(ann.classId);
      if (cRow) cRow.count += 1;
      const oKey = `${ann.classId}::${ann.objectId}`;
      const oRow = objectCounts.get(oKey);
      if (oRow) {
        oRow.count += 1;
      } else {
        objectCounts.set(oKey, { label: tax.fullLabel, color: tax.color, count: 1 });
      }
    }

    const splitCounts: Record<SplitType, number> = { train: 0, val: 0, test: 0 };
    const statusCounts: Record<ReviewStatus, number> = {
      unlabeled: 0,
      in_progress: 0,
      labeled: 0,
      verified: 0,
    };
    for (const img of images) {
      splitCounts[img.split] += 1;
      statusCounts[img.status] += 1;
    }

    return {
      totalImages,
      totalAnnotations: manualAnns.length,
      captionedImages,
      verifiedImages,
      captionRate: totalImages ? Math.round((captionedImages / totalImages) * 100) : 0,
      verifiedRate: totalImages ? Math.round((verifiedImages / totalImages) * 100) : 0,
      avgPerImage: totalImages ? (manualAnns.length / totalImages).toFixed(1) : '0.0',
      geomCounts,
      splitCounts,
      statusCounts,
      byClass: Array.from(classCounts.values()).sort((a, b) => b.count - a.count),
      byObject: Array.from(objectCounts.values()).sort((a, b) => b.count - a.count),
    };
  }, [images, classes]);

  const distributionRows = groupMode === 'class' ? stats.byClass : stats.byObject;
  const maxBarCount = Math.max(1, ...distributionRows.map((r) => r.count));

  return (
    <div className="flex-1 overflow-y-auto bg-[#0B0D10] p-6">
      <div className="max-w-[1200px] mx-auto space-y-6">
        <div className="border-b border-[#232834] pb-5">
          <h1 className="text-xl font-semibold text-[#E8ECF2] tracking-tight">
            Dataset Analytics
          </h1>
          <p className="text-xs text-[#8B95A5] mt-1">
            Live class/object balance, geometry distribution, and caption coverage for{' '}
            <span className="text-[#CBD5E1]">{projectName}</span>.
          </p>
        </div>

        {/* 4-Column KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#12151B] border border-[#232834] rounded-lg p-4">
            <div className="text-xs text-[#8B95A5]">Total Images</div>
            <div className="mt-2 text-2xl font-display font-semibold font-mono tabular-nums text-[#E8ECF2]">
              {stats.totalImages}
            </div>
            <div className="mt-1 text-[11px] text-[#64748B] font-mono tabular-nums">
              {stats.avgPerImage} labels / image
            </div>
          </div>

          <div className="bg-[#12151B] border border-[#232834] rounded-lg p-4">
            <div className="text-xs text-[#8B95A5]">Confirmed Annotations</div>
            <div className="mt-2 text-2xl font-display font-semibold font-mono tabular-nums text-[#E8ECF2]">
              {stats.totalAnnotations}
            </div>
            <div className="mt-1 text-[11px] text-[#64748B] font-mono tabular-nums">
              {classes.length} classes ·{' '}
              {classes.reduce((acc, c) => acc + c.objects.length, 0)} objects
            </div>
          </div>

          <div className="bg-[#12151B] border border-[#232834] rounded-lg p-4">
            <div className="text-xs text-[#8B95A5]">Caption Coverage</div>
            <div className="mt-2 text-2xl font-display font-semibold font-mono tabular-nums text-[#E8ECF2]">
              {stats.captionRate}%
            </div>
            <div className="mt-1 text-[11px] text-[#64748B] font-mono tabular-nums">
              {stats.captionedImages} of {stats.totalImages} captioned
            </div>
          </div>

          <div className="bg-[#12151B] border border-[#232834] rounded-lg p-4">
            <div className="text-xs text-[#8B95A5]">Verified Images</div>
            <div className="mt-2 text-2xl font-display font-semibold font-mono tabular-nums text-[#22C55E]">
              {stats.verifiedRate}%
            </div>
            <div className="mt-1 text-[11px] text-[#64748B] font-mono tabular-nums">
              {stats.verifiedImages} of {stats.totalImages} verified
            </div>
          </div>
        </div>

        {/* Two-Column Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Taxonomy Distribution */}
          <section className="lg:col-span-2 bg-[#12151B] border border-[#232834] rounded-lg p-5">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="text-sm font-semibold text-[#E8ECF2]">
                  Taxonomy Balance
                </h2>
                <p className="text-xs text-[#8B95A5] mt-0.5">
                  Detect underrepresented classes or objects before training.
                </p>
              </div>
              <div className="flex items-center gap-1 p-0.5 bg-[#0B0D10] border border-[#232834] rounded-md">
                <button
                  type="button"
                  onClick={() => setGroupMode('class')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    groupMode === 'class'
                      ? 'bg-[#181C24] text-white'
                      : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                  }`}
                >
                  By Class
                </button>
                <button
                  type="button"
                  onClick={() => setGroupMode('object')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    groupMode === 'object'
                      ? 'bg-[#181C24] text-white'
                      : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                  }`}
                >
                  By Object
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {distributionRows.map((row) => {
                const widthPct = Math.round((row.count / maxBarCount) * 100);
                const sharePct = stats.totalAnnotations
                  ? Math.round((row.count / stats.totalAnnotations) * 100)
                  : 0;

                return (
                  <div key={row.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-[#E8ECF2] truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: row.color }}
                        />
                        <span className="truncate">{row.label}</span>
                      </span>
                      <span className="font-mono tabular-nums text-[#8B95A5] shrink-0">
                        <strong className="text-[#E8ECF2] font-medium">{row.count}</strong> ({sharePct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-sm bg-[#0B0D10] overflow-hidden">
                      <div
                        className="h-full rounded-sm transition-all duration-300"
                        style={{
                          width: `${row.count > 0 ? Math.max(2, widthPct) : 0}%`,
                          backgroundColor: row.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right Column: Geometry, Splits, Status */}
          <div className="space-y-4">
            <section className="bg-[#12151B] border border-[#232834] rounded-lg p-5">
              <h2 className="text-sm font-semibold text-[#E8ECF2] mb-3.5">
                Geometry Breakdown
              </h2>
              <div className="space-y-2.5 text-xs">
                {(
                  [
                    ['Bounding Boxes', stats.geomCounts.bbox],
                    ['Polygon Segmentations', stats.geomCounts.polygon],
                    ['Polylines / Lines', stats.geomCounts.polyline],
                    ['Keypoints', stats.geomCounts.keypoint],
                  ] as const
                ).map(([label, count]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between py-1 border-b border-[#232834]/60 last:border-0"
                  >
                    <span className="text-[#CBD5E1]">{label}</span>
                    <span className="font-mono tabular-nums text-[#E8ECF2] font-medium">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-[#12151B] border border-[#232834] rounded-lg p-5">
              <h2 className="text-sm font-semibold text-[#E8ECF2] mb-3.5">
                Dataset Splits
              </h2>
              <div className="space-y-2.5 text-xs">
                {(
                  [
                    ['Train', stats.splitCounts.train, '#38BDF8'],
                    ['Validation', stats.splitCounts.val, '#FBBF24'],
                    ['Test', stats.splitCounts.test, '#A78BFA'],
                  ] as const
                ).map(([label, count, color]) => {
                  const pct = stats.totalImages
                    ? Math.round((count / stats.totalImages) * 100)
                    : 0;
                  return (
                    <div key={label} className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[#CBD5E1]">{label}</span>
                        <span className="font-mono tabular-nums text-[#8B95A5]">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-sm bg-[#0B0D10] overflow-hidden">
                        <div
                          className="h-full rounded-sm"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="bg-[#12151B] border border-[#232834] rounded-lg p-5">
              <h2 className="text-sm font-semibold text-[#E8ECF2] mb-3.5">
                Review Pipeline
              </h2>
              <div className="space-y-2 text-xs">
                {(
                  [
                    ['Verified', stats.statusCounts.verified, 'text-[#22C55E]'],
                    ['Labeled', stats.statusCounts.labeled, 'text-[#38BDF8]'],
                    ['In Progress', stats.statusCounts.in_progress, 'text-[#F59E0B]'],
                    ['Unlabeled', stats.statusCounts.unlabeled, 'text-[#8B95A5]'],
                  ] as const
                ).map(([label, count, cls]) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className={cls}>{label}</span>
                    <span className="font-mono tabular-nums text-[#E8ECF2]">{count}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
