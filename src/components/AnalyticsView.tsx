import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Layers, ArrowUpRight, Sun, Moon, Loader2, CheckCircle2 } from 'lucide-react';
import type {
  AnnotationType,
  DatasetImage,
  LabelClass,
  ReviewStatus,
  SplitType,
} from '../types/annotation';
import { resolveTaxonomy } from '../utils/geometry';
import {
  analyzeProjectImageLighting,
  type ImageLuminanceMetrics,
} from '../utils/imageMetrics';

interface AnalyticsViewProps {
  projectName: string;
  images: DatasetImage[];
  imageUrls?: Record<string, string>;
  classes: LabelClass[];
  onOpenImage?: (imageId: string) => void;
}

const GEOMETRY_META: Array<{ id: AnnotationType; label: string; color: string }> = [
  { id: 'bbox', label: 'Bounding Box', color: '#38BDF8' },
  { id: 'polygon', label: 'Polygon', color: '#34D399' },
  { id: 'polyline', label: 'Polyline', color: '#FBBF24' },
  { id: 'keypoint', label: 'Keypoint', color: '#F472B6' },
];

function formatPct(part: number, total: number): string {
  if (!total) return '0%';
  const raw = (part / total) * 100;
  return `${raw % 1 === 0 ? raw.toFixed(0) : raw.toFixed(1)}%`;
}

export default function AnalyticsView({
  projectName,
  images,
  imageUrls = {},
  classes,
  onOpenImage,
}: AnalyticsViewProps) {
  const [groupMode, setGroupMode] = useState<'class' | 'object'>('object');
  const [densityMode, setDensityMode] = useState<'class' | 'geometry'>('class');
  const [densitySort, setDensitySort] = useState<'highest' | 'lowest' | 'name'>('highest');
  const [showAllDensityRows, setShowAllDensityRows] = useState(false);
  const [hoveredImageId, setHoveredImageId] = useState<string | null>(null);
  const [lightingMetrics, setLightingMetrics] = useState<ImageLuminanceMetrics[]>([]);
  const [analyzingLighting, setAnalyzingLighting] = useState(false);
  const [outlierFilter, setOutlierFilter] = useState<'all' | 'darker' | 'lighter'>('all');

  useEffect(() => {
    let cancelled = false;
    if (images.length === 0) {
      setLightingMetrics([]);
      setAnalyzingLighting(false);
      return;
    }

    setAnalyzingLighting(true);
    void analyzeProjectImageLighting(images, imageUrls, () => cancelled).then((measured) => {
      if (cancelled) return;
      setLightingMetrics(measured);
      setAnalyzingLighting(false);
    });

    return () => {
      cancelled = true;
    };
  }, [images, imageUrls]);

  const lightingSummary = useMemo(() => {
    if (lightingMetrics.length === 0) {
      return {
        analyzedCount: 0,
        avgBrightness: 0,
        avgContrast: 0,
        minBrightness: 0,
        maxBrightness: 0,
        threshold: 12,
        outliers: [] as Array<
          ImageLuminanceMetrics & { delta: number; direction: 'darker' | 'lighter' }
        >,
        darkerCount: 0,
        lighterCount: 0,
      };
    }

    const n = lightingMetrics.length;
    const avgBrightness =
      lightingMetrics.reduce((acc, m) => acc + m.brightness, 0) / n;
    const avgContrast =
      lightingMetrics.reduce((acc, m) => acc + m.contrast, 0) / n;
    const minBrightness = Math.min(...lightingMetrics.map((m) => m.brightness));
    const maxBrightness = Math.max(...lightingMetrics.map((m) => m.brightness));

    const variance =
      lightingMetrics.reduce((acc, m) => acc + (m.brightness - avgBrightness) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);
    // Flag images deviating meaningfully from project average (>= 12% or 1.15 standard deviations)
    const threshold = Math.round(Math.max(12, stdDev * 1.15) * 10) / 10;

    const outliers = lightingMetrics
      .map((m) => {
        const delta = Math.round((m.brightness - avgBrightness) * 10) / 10;
        if (delta <= -threshold) {
          return { ...m, delta, direction: 'darker' as const };
        }
        if (delta >= threshold) {
          return { ...m, delta, direction: 'lighter' as const };
        }
        return null;
      })
      .filter(
        (
          item
        ): item is ImageLuminanceMetrics & {
          delta: number;
          direction: 'darker' | 'lighter';
        } => item !== null
      )
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    return {
      analyzedCount: n,
      avgBrightness: Math.round(avgBrightness * 10) / 10,
      avgContrast: Math.round(avgContrast * 10) / 10,
      minBrightness,
      maxBrightness,
      threshold,
      outliers,
      darkerCount: outliers.filter((o) => o.direction === 'darker').length,
      lighterCount: outliers.filter((o) => o.direction === 'lighter').length,
    };
  }, [lightingMetrics]);

  const filteredOutliers = useMemo(() => {
    if (outlierFilter === 'all') return lightingSummary.outliers;
    return lightingSummary.outliers.filter((o) => o.direction === outlierFilter);
  }, [lightingSummary.outliers, outlierFilter]);

  const contrastDescriptor =
    lightingSummary.avgContrast < 28
      ? 'Low contrast'
      : lightingSummary.avgContrast > 58
      ? 'High contrast'
      : 'Balanced contrast';

  const stats = useMemo(() => {
    const manualAnns = images.flatMap((img) =>
      img.annotations.filter((a) => a.source !== 'ai_suggestion')
    );
    const totalImages = images.length;
    const annotatedImages = images.filter(
      (i) => i.annotations.some((a) => a.source !== 'ai_suggestion')
    ).length;
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
      if (cRow) {
        cRow.count += 1;
      } else {
        classCounts.set(ann.classId, { label: tax.className, color: tax.color, count: 1 });
      }
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

    const byClass = Array.from(classCounts.values()).sort((a, b) => b.count - a.count);
    const byObject = Array.from(objectCounts.values()).sort((a, b) => b.count - a.count);
    const topFiveClasses = byClass.filter((c) => c.count > 0).slice(0, 5);

    const splitPercentages: Record<SplitType, number> = {
      train: totalImages ? (splitCounts.train / totalImages) * 100 : 0,
      val: totalImages ? (splitCounts.val / totalImages) * 100 : 0,
      test: totalImages ? (splitCounts.test / totalImages) * 100 : 0,
    };

    const avgPerImageNum = totalImages ? manualAnns.length / totalImages : 0;

    // Per-image object type distribution for labeling density chart
    const perImageDensity = images.map((img) => {
      const confirmed = img.annotations.filter((a) => a.source !== 'ai_suggestion');
      const perClassMap = new Map<string, { key: string; label: string; color: string; count: number }>();
      const perGeomCounts: Record<AnnotationType, number> = {
        bbox: 0,
        polygon: 0,
        polyline: 0,
        keypoint: 0,
      };

      for (const ann of confirmed) {
        perGeomCounts[ann.type] += 1;
        const tax = resolveTaxonomy(classes, ann.classId, ann.objectId);
        const existing = perClassMap.get(ann.classId);
        if (existing) {
          existing.count += 1;
        } else {
          perClassMap.set(ann.classId, {
            key: ann.classId,
            label: tax.className,
            color: tax.labelClass?.color ?? tax.color,
            count: 1,
          });
        }
      }

      const classSegments = Array.from(perClassMap.values()).sort((a, b) => b.count - a.count);
      const geomSegments = GEOMETRY_META.filter((g) => perGeomCounts[g.id] > 0).map((g) => ({
        key: g.id,
        label: g.label,
        color: g.color,
        count: perGeomCounts[g.id],
      }));

      return {
        imageId: img.id,
        fileName: img.fileName,
        split: img.split,
        total: confirmed.length,
        classSegments,
        geomSegments,
      };
    });

    const maxPerImage = perImageDensity.reduce((max, row) => Math.max(max, row.total), 0);
    const highDensityThreshold =
      maxPerImage > 0
        ? Math.max(Math.ceil(avgPerImageNum * 1.25), Math.floor(avgPerImageNum) + 1)
        : Number.POSITIVE_INFINITY;
    const highDensityCount = perImageDensity.filter(
      (row) => row.total > 0 && row.total >= highDensityThreshold
    ).length;

    return {
      totalImages,
      annotatedImages,
      totalAnnotations: manualAnns.length,
      captionedImages,
      verifiedImages,
      captionRate: totalImages ? Math.round((captionedImages / totalImages) * 100) : 0,
      verifiedRate: totalImages ? Math.round((verifiedImages / totalImages) * 100) : 0,
      avgPerImage: avgPerImageNum.toFixed(1),
      avgPerImageNum,
      maxPerImage,
      highDensityThreshold,
      highDensityCount,
      geomCounts,
      splitCounts,
      splitPercentages,
      statusCounts,
      byClass,
      byObject,
      topFiveClasses,
      perImageDensity,
    };
  }, [images, classes]);

  const distributionRows = groupMode === 'class' ? stats.byClass : stats.byObject;
  const maxBarCount = Math.max(1, ...distributionRows.map((r) => r.count));

  const sortedDensityRows = useMemo(() => {
    const copy = [...stats.perImageDensity];
    if (densitySort === 'highest') {
      copy.sort((a, b) => b.total - a.total || a.fileName.localeCompare(b.fileName));
    } else if (densitySort === 'lowest') {
      copy.sort((a, b) => a.total - b.total || a.fileName.localeCompare(b.fileName));
    } else {
      copy.sort((a, b) => a.fileName.localeCompare(b.fileName));
    }
    return copy;
  }, [stats.perImageDensity, densitySort]);

  const visibleDensityRows = showAllDensityRows
    ? sortedDensityRows
    : sortedDensityRows.slice(0, 15);

  const densityLegend = useMemo(() => {
    if (densityMode === 'geometry') {
      return GEOMETRY_META.map((g) => ({
        key: g.id,
        label: g.label,
        color: g.color,
        count: stats.geomCounts[g.id],
      }));
    }
    return stats.byClass
      .filter((c) => c.count > 0)
      .map((c) => ({
        key: c.label,
        label: c.label,
        color: c.color,
        count: c.count,
      }));
  }, [densityMode, stats.byClass, stats.geomCounts]);

  const hoveredDensityRow = useMemo(
    () =>
      hoveredImageId
        ? stats.perImageDensity.find((r) => r.imageId === hoveredImageId) ?? null
        : null,
    [hoveredImageId, stats.perImageDensity]
  );

  const densityScaleMax = Math.max(1, stats.maxPerImage);
  const avgLinePct =
    stats.maxPerImage > 0
      ? Math.min(100, (stats.avgPerImageNum / densityScaleMax) * 100)
      : 0;

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

        {/* Dataset Summary Card */}
        <section
          aria-label="Dataset Summary"
          className="bg-[#12151B] border border-[#232834] rounded-lg overflow-hidden"
        >
          <div className="px-5 py-3 border-b border-[#232834] flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#38BDF8] shrink-0" />
              <h2 className="text-xs font-semibold text-[#E8ECF2] tracking-tight">
                Dataset Summary
              </h2>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-[#8B95A5]">
              {stats.annotatedImages} / {stats.totalImages} images annotated
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#232834]">
            {/* Section 1: Total Annotated Objects */}
            <div className="lg:col-span-3 p-5 flex flex-col justify-between">
              <div>
                <div className="text-[11px] font-medium text-[#8B95A5]">
                  Total Annotated Objects
                </div>
                <div className="mt-2 text-3xl font-display font-semibold font-mono tabular-nums text-[#E8ECF2]">
                  {stats.totalAnnotations.toLocaleString()}
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-[#232834]/70 space-y-1 text-[11px] font-mono tabular-nums text-[#8B95A5]">
                <div className="flex items-center justify-between">
                  <span>Avg / image</span>
                  <span className="text-[#CBD5E1]">{stats.avgPerImage}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Active classes</span>
                  <span className="text-[#CBD5E1]">
                    {stats.byClass.filter((c) => c.count > 0).length} / {classes.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Section 2: Split Percentages (train / val / test) */}
            <div className="lg:col-span-4 p-5 flex flex-col justify-between gap-4">
              <div>
                <div className="text-[11px] font-medium text-[#8B95A5]">
                  Image Split Breakdown
                </div>

                {/* Stacked proportional bar */}
                <div
                  className="mt-3 h-2.5 w-full rounded-sm bg-[#0B0D10] overflow-hidden flex"
                  aria-hidden="true"
                >
                  {stats.splitPercentages.train > 0 && (
                    <div
                      className="h-full bg-[#38BDF8] transition-all duration-300"
                      style={{ width: `${stats.splitPercentages.train}%` }}
                    />
                  )}
                  {stats.splitPercentages.val > 0 && (
                    <div
                      className="h-full bg-[#FBBF24] transition-all duration-300"
                      style={{ width: `${stats.splitPercentages.val}%` }}
                    />
                  )}
                  {stats.splitPercentages.test > 0 && (
                    <div
                      className="h-full bg-[#A78BFA] transition-all duration-300"
                      style={{ width: `${stats.splitPercentages.test}%` }}
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {(
                  [
                    { key: 'train' as SplitType, color: '#38BDF8' },
                    { key: 'val' as SplitType, color: '#FBBF24' },
                    { key: 'test' as SplitType, color: '#A78BFA' },
                  ] as const
                ).map(({ key, color }) => (
                  <div
                    key={key}
                    className="bg-[#0B0D10] border border-[#232834] rounded-md px-2.5 py-2"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#8B95A5]">
                      <span
                        className="w-2 h-2 rounded-xs shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span>{key}</span>
                    </div>
                    <div className="mt-1 text-base font-display font-semibold font-mono tabular-nums text-[#E8ECF2]">
                      {formatPct(stats.splitCounts[key], stats.totalImages)}
                    </div>
                    <div className="text-[10px] font-mono tabular-nums text-[#64748B]">
                      {stats.splitCounts[key]} img
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 3: Top 5 Most Frequently Annotated Classes */}
            <div className="lg:col-span-5 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-medium text-[#8B95A5]">
                  Top 5 Annotated Classes
                </span>
                <span className="text-[10px] font-mono text-[#64748B]">
                  Count · Share
                </span>
              </div>

              {stats.topFiveClasses.length === 0 ? (
                <div className="py-5 text-center text-xs text-[#64748B] bg-[#0B0D10] border border-[#232834] rounded-md">
                  No annotated objects yet.
                </div>
              ) : (
                <ol className="space-y-2">
                  {stats.topFiveClasses.map((cls, idx) => (
                    <li
                      key={cls.label}
                      className="flex items-center justify-between gap-3 text-xs py-1 border-b border-[#232834]/60 last:border-0"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-4 text-[11px] font-mono tabular-nums text-[#64748B] shrink-0">
                          {idx + 1}.
                        </span>
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: cls.color }}
                        />
                        <span className="text-[#E8ECF2] truncate font-medium">
                          {cls.label}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums text-[#8B95A5] shrink-0">
                        <strong className="text-[#E8ECF2] font-medium">
                          {cls.count.toLocaleString()}
                        </strong>{' '}
                        <span className="text-[11px] text-[#64748B]">
                          ({formatPct(cls.count, stats.totalAnnotations)})
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </section>

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

        {/* Per-Image Object Type Distribution & Labeling Density Chart */}
        <section
          aria-label="Object Types per Image and Labeling Density"
          className="bg-[#12151B] border border-[#232834] rounded-lg overflow-hidden"
        >
          {/* Header & Controls */}
          <div className="px-5 py-4 border-b border-[#232834] flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[#E8ECF2] flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#38BDF8] shrink-0" />
                <span>Labeling Density &amp; Object Types per Image</span>
              </h2>
              <p className="text-xs text-[#8B95A5] mt-0.5">
                Stacked object distribution per frame to spot high-density scenes and unlabeled outliers.
                {stats.maxPerImage > 0 && (
                  <span className="font-mono tabular-nums text-[#CBD5E1] ml-1.5">
                    Avg {stats.avgPerImage} · Peak {stats.maxPerImage} · {stats.highDensityCount}{' '}
                    high-density {stats.highDensityCount === 1 ? 'image' : 'images'} (
                    {`>=${stats.highDensityThreshold}`})
                  </span>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Breakdown Mode Toggle */}
              <div className="flex items-center gap-1 p-0.5 bg-[#0B0D10] border border-[#232834] rounded-md">
                <button
                  type="button"
                  onClick={() => setDensityMode('class')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    densityMode === 'class'
                      ? 'bg-[#181C24] text-white'
                      : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                  }`}
                >
                  By Object Class
                </button>
                <button
                  type="button"
                  onClick={() => setDensityMode('geometry')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    densityMode === 'geometry'
                      ? 'bg-[#181C24] text-white'
                      : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                  }`}
                >
                  By Geometry
                </button>
              </div>

              {/* Sort Order Control */}
              <select
                value={densitySort}
                onChange={(e) => setDensitySort(e.target.value as 'highest' | 'lowest' | 'name')}
                aria-label="Sort images in density chart"
                className="bg-[#0B0D10] border border-[#232834] focus:border-[#38BDF8] rounded-md px-2.5 py-1.5 text-xs text-[#CBD5E1] outline-none"
              >
                <option value="highest">Highest Density First</option>
                <option value="lowest">Lowest Density First</option>
                <option value="name">Filename (A–Z)</option>
              </select>
            </div>
          </div>

          {/* Legend & Interactive Hover Inspection Strip */}
          <div className="px-5 py-2.5 border-b border-[#232834] bg-[#0F1218] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
              {densityLegend.length === 0 ? (
                <span className="text-[#64748B]">No confirmed object types to chart yet.</span>
              ) : (
                densityLegend.map((entry) => (
                  <span key={entry.key} className="flex items-center gap-1.5 text-[#CBD5E1]">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span>{entry.label}</span>
                    <span className="font-mono tabular-nums text-[#64748B]">({entry.count})</span>
                  </span>
                ))
              )}
            </div>

            {stats.maxPerImage > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-[#8B95A5] shrink-0">
                <span className="inline-block w-3 border-t border-dashed border-[#CBD5E1]/70" />
                <span>Dataset avg ({stats.avgPerImage})</span>
              </div>
            )}
          </div>

          {/* Live Hover Breakdown Readout */}
          <div className="px-5 py-2 border-b border-[#232834]/70 bg-[#0B0D10] min-h-[34px] flex items-center justify-between gap-3 text-[11px]">
            {hoveredDensityRow ? (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[#E8ECF2] font-medium truncate">
                    {hoveredDensityRow.fileName}
                  </span>
                  <span className="text-[#64748B]" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-[#38BDF8] shrink-0">
                    {hoveredDensityRow.total}{' '}
                    {hoveredDensityRow.total === 1 ? 'object' : 'objects'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 font-mono tabular-nums text-[#8B95A5]">
                  {(densityMode === 'class'
                    ? hoveredDensityRow.classSegments
                    : hoveredDensityRow.geomSegments
                  ).length === 0 ? (
                    <span>Unlabeled image</span>
                  ) : (
                    (densityMode === 'class'
                      ? hoveredDensityRow.classSegments
                      : hoveredDensityRow.geomSegments
                    ).map((seg) => (
                      <span key={seg.key} className="flex items-center gap-1 text-[#CBD5E1]">
                        <span
                          className="w-2 h-2 rounded-xs shrink-0"
                          style={{ backgroundColor: seg.color }}
                        />
                        <span>
                          {seg.label}: {seg.count}
                        </span>
                      </span>
                    ))
                  )}
                </div>
              </>
            ) : (
              <span className="text-[#64748B]">
                Hover any image bar to inspect exact object type counts
                {onOpenImage ? ' · Click a row to open that image in Annotate.' : '.'}
              </span>
            )}
          </div>

          {/* Stacked Horizontal Bars */}
          <div className="p-5">
            {sortedDensityRows.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#64748B] bg-[#0B0D10] border border-[#232834] rounded-md">
                Import images into this project to analyze per-image labeling density.
              </div>
            ) : (
              <div className="space-y-2">
                {visibleDensityRows.map((row) => {
                  const segments =
                    densityMode === 'class' ? row.classSegments : row.geomSegments;
                  const isHighDensity =
                    row.total > 0 && row.total >= stats.highDensityThreshold;
                  const isHovered = hoveredImageId === row.imageId;

                  const RowWrapper = onOpenImage ? 'button' : 'div';

                  return (
                    <RowWrapper
                      key={row.imageId}
                      {...(onOpenImage
                        ? {
                            type: 'button' as const,
                            onClick: () => onOpenImage(row.imageId),
                          }
                        : {})}
                      onMouseEnter={() => setHoveredImageId(row.imageId)}
                      onMouseLeave={() =>
                        setHoveredImageId((curr) => (curr === row.imageId ? null : curr))
                      }
                      className={`w-full text-left flex items-center gap-3 px-2.5 py-1.5 rounded-md transition-colors ${
                        isHovered ? 'bg-[#181C24]' : 'hover:bg-[#181C24]/60'
                      } ${onOpenImage ? 'cursor-pointer' : ''}`}
                    >
                      {/* Image Filename & Split */}
                      <div className="w-40 sm:w-56 shrink-0 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs text-[#E8ECF2] font-medium truncate">
                            {row.fileName}
                          </span>
                          {onOpenImage && isHovered && (
                            <ArrowUpRight className="w-3 h-3 text-[#38BDF8] shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#64748B]">
                          <span>{row.split}</span>
                          {isHighDensity && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[#F59E0B]">High density</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Stacked Bar Track */}
                      <div className="flex-1 h-5 bg-[#0B0D10] border border-[#232834]/80 rounded-sm relative overflow-hidden flex items-stretch">
                        {segments.map((seg) => {
                          const widthPct = (seg.count / densityScaleMax) * 100;
                          return (
                            <div
                              key={seg.key}
                              title={`${seg.label}: ${seg.count}`}
                              className="h-full border-r border-[#0B0D10]/80 last:border-r-0 transition-opacity duration-150"
                              style={{
                                width: `${widthPct}%`,
                                backgroundColor: seg.color,
                                opacity: isHovered ? 1 : 0.88,
                              }}
                            />
                          );
                        })}

                        {/* Dataset Average Vertical Reference Line */}
                        {stats.maxPerImage > 0 && avgLinePct > 0 && avgLinePct < 100 && (
                          <div
                            aria-hidden="true"
                            className="absolute top-0 bottom-0 border-l border-dashed border-[#E8ECF2]/50 pointer-events-none"
                            style={{ left: `${avgLinePct}%` }}
                          />
                        )}
                      </div>

                      {/* Object Count & Distinct Types */}
                      <div className="w-20 shrink-0 text-right font-mono tabular-nums">
                        <div
                          className={`text-xs font-semibold ${
                            row.total === 0
                              ? 'text-[#64748B]'
                              : isHighDensity
                              ? 'text-[#F59E0B]'
                              : 'text-[#E8ECF2]'
                          }`}
                        >
                          {row.total}
                        </div>
                        <div className="text-[10px] text-[#64748B]">
                          {segments.length} {segments.length === 1 ? 'type' : 'types'}
                        </div>
                      </div>
                    </RowWrapper>
                  );
                })}

                {/* Scale Axis Footer */}
                <div className="pt-2 mt-2 border-t border-[#232834]/70 flex items-center gap-3 px-2.5 text-[10px] font-mono tabular-nums text-[#64748B]">
                  <div className="w-40 sm:w-56 shrink-0">
                    Showing {visibleDensityRows.length} of {sortedDensityRows.length} images
                  </div>
                  <div className="flex-1 flex items-center justify-between">
                    <span>0</span>
                    <span>{Math.round(densityScaleMax / 2)}</span>
                    <span>{densityScaleMax} objects</span>
                  </div>
                  <div className="w-20 shrink-0 text-right">Total</div>
                </div>

                {/* Expand / Collapse All Images */}
                {sortedDensityRows.length > 15 && (
                  <div className="pt-2 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setShowAllDensityRows((v) => !v)}
                      className="px-3.5 py-1.5 rounded-md bg-[#181C24] hover:bg-[#232834] border border-[#232834] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors"
                    >
                      {showAllDensityRows
                        ? 'Show Top 15 Images'
                        : `Show All ${sortedDensityRows.length} Images`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Image Brightness & Contrast Summary + Lighting Outliers Card */}
        <section
          aria-label="Image Brightness and Contrast Analysis"
          className="bg-[#12151B] border border-[#232834] rounded-lg overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-[#232834] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sun className="w-4 h-4 text-[#FBBF24] shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-[#E8ECF2] leading-tight">
                  Image Brightness &amp; Contrast
                </h2>
                <p className="text-[11px] text-[#8B95A5] mt-0.5">
                  Perceptual luminance and RMS contrast summary with exposure outliers (±
                  {lightingSummary.threshold}% from project average).
                </p>
              </div>
            </div>

            <div className="text-[11px] font-mono tabular-nums text-[#8B95A5] flex items-center gap-2 shrink-0">
              {analyzingLighting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#38BDF8]" />
                  <span>Analyzing pixel luminance…</span>
                </>
              ) : (
                <span>
                  {lightingSummary.analyzedCount} / {images.length} images analyzed
                </span>
              )}
            </div>
          </div>

          {images.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#64748B]">
              Import images into this project to measure dataset brightness and contrast levels.
            </div>
          ) : analyzingLighting && lightingSummary.analyzedCount === 0 ? (
            <div className="p-8 flex items-center justify-center gap-2 text-xs text-[#8B95A5]">
              <Loader2 className="w-4 h-4 animate-spin text-[#38BDF8]" />
              <span>Sampling brightness and contrast across project images…</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#232834]">
              {/* Left Column: Project Averages */}
              <div className="lg:col-span-4 p-5 space-y-5">
                {/* Average Brightness */}
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-medium text-[#8B95A5]">
                      Average Brightness
                    </span>
                    <span className="text-xl font-display font-semibold font-mono tabular-nums text-[#E8ECF2]">
                      {lightingSummary.avgBrightness.toFixed(1)}%
                    </span>
                  </div>
                  <div
                    className="h-2.5 w-full rounded-sm border border-[#232834] relative overflow-hidden bg-gradient-to-r from-[#07090C] via-[#64748B] to-[#E8ECF2]"
                    aria-hidden="true"
                  >
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-[#38BDF8]"
                      style={{ left: `${Math.min(99, Math.max(1, lightingSummary.avgBrightness))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-[#64748B]">
                    <span>Min {lightingSummary.minBrightness.toFixed(1)}%</span>
                    <span>Max {lightingSummary.maxBrightness.toFixed(1)}%</span>
                  </div>
                </div>

                {/* Average Contrast */}
                <div className="pt-4 border-t border-[#232834]/70 space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-medium text-[#8B95A5]">
                      Average Contrast (RMS)
                    </span>
                    <span className="text-xl font-display font-semibold font-mono tabular-nums text-[#E8ECF2]">
                      {lightingSummary.avgContrast.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-sm bg-[#0B0D10] overflow-hidden">
                    <div
                      className="h-full bg-[#38BDF8] rounded-sm transition-all duration-300"
                      style={{ width: `${Math.min(100, lightingSummary.avgContrast)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#8B95A5]">
                    <span>{contrastDescriptor}</span>
                    <span className="font-mono tabular-nums text-[#64748B]">
                      {lightingSummary.outliers.length}{' '}
                      {lightingSummary.outliers.length === 1 ? 'outlier' : 'outliers'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: Significantly Darker / Lighter Images */}
              <div className="lg:col-span-8 p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-medium text-[#CBD5E1] flex items-center gap-2">
                    <span>Significantly Darker or Lighter Images</span>
                    <span className="text-[11px] font-mono tabular-nums text-[#8B95A5]">
                      {lightingSummary.darkerCount} darker · {lightingSummary.lighterCount} lighter
                    </span>
                  </div>

                  {lightingSummary.outliers.length > 0 && (
                    <div className="flex items-center gap-1 p-0.5 bg-[#0B0D10] border border-[#232834] rounded-md">
                      {(
                        [
                          { id: 'all', label: 'All' },
                          { id: 'darker', label: 'Darker' },
                          { id: 'lighter', label: 'Lighter' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setOutlierFilter(opt.id)}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                            outlierFilter === opt.id
                              ? 'bg-[#181C24] text-white'
                              : 'text-[#8B95A5] hover:text-[#E8ECF2]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {lightingSummary.outliers.length === 0 ? (
                  <div className="p-5 rounded-md bg-[#0B0D10] border border-[#232834] flex items-center gap-3 text-xs text-[#CBD5E1]">
                    <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
                    <span>
                      Consistent exposure across the project — all {lightingSummary.analyzedCount}{' '}
                      analyzed images are within ±{lightingSummary.threshold}% of the{' '}
                      <span className="font-mono tabular-nums text-[#E8ECF2]">
                        {lightingSummary.avgBrightness.toFixed(1)}%
                      </span>{' '}
                      average brightness.
                    </span>
                  </div>
                ) : filteredOutliers.length === 0 ? (
                  <div className="p-5 rounded-md bg-[#0B0D10] border border-[#232834] text-center text-xs text-[#64748B]">
                    No images match the “{outlierFilter}” filter.
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto divide-y divide-[#232834]/70 border border-[#232834] rounded-md bg-[#0B0D10]">
                    {filteredOutliers.map((item) => {
                      const thumbUrl =
                        imageUrls[item.imageId] ||
                        images.find((i) => i.id === item.imageId)?.seedUrl ||
                        '';
                      const isDarker = item.direction === 'darker';
                      const RowEl = onOpenImage ? 'button' : 'div';

                      return (
                        <RowEl
                          key={item.imageId}
                          {...(onOpenImage
                            ? {
                                type: 'button' as const,
                                onClick: () => onOpenImage(item.imageId),
                              }
                            : {})}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                            onOpenImage ? 'hover:bg-[#181C24] cursor-pointer' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {thumbUrl ? (
                              <img
                                src={thumbUrl}
                                alt={item.fileName}
                                className="w-10 h-7 rounded-xs object-cover border border-[#232834] bg-[#07090C] shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-7 rounded-xs border border-[#232834] bg-[#12151B] shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-xs font-medium text-[#E8ECF2] truncate">
                                  {item.fileName}
                                </span>
                                {onOpenImage && (
                                  <ArrowUpRight className="w-3 h-3 text-[#64748B] shrink-0" />
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px]">
                                <span
                                  className={`flex items-center gap-1 font-medium ${
                                    isDarker ? 'text-[#818CF8]' : 'text-[#FBBF24]'
                                  }`}
                                >
                                  {isDarker ? (
                                    <Moon className="w-3 h-3 shrink-0" />
                                  ) : (
                                    <Sun className="w-3 h-3 shrink-0" />
                                  )}
                                  <span>{isDarker ? 'Darker than avg' : 'Lighter than avg'}</span>
                                </span>
                                <span className="text-[#64748B]" aria-hidden="true">
                                  ·
                                </span>
                                <span className="font-mono text-[#64748B]">{item.split}</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right font-mono tabular-nums shrink-0">
                            <div className="text-xs text-[#E8ECF2]">
                              {item.brightness.toFixed(1)}%{' '}
                              <span
                                className={`text-[11px] ${
                                  isDarker ? 'text-[#818CF8]' : 'text-[#FBBF24]'
                                }`}
                              >
                                ({item.delta > 0 ? `+${item.delta.toFixed(1)}` : item.delta.toFixed(1)}
                                %)
                              </span>
                            </div>
                            <div className="text-[10px] text-[#64748B]">
                              Contrast {item.contrast.toFixed(1)}%
                            </div>
                          </div>
                        </RowEl>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
