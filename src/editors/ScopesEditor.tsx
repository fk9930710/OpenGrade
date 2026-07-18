import React, { useEffect, useState } from "react";
import { getImageUrl, subscribeToImageUrl } from "../core/imageState";

type ScopePoint = {
  x: number;
  y: number;
  opacity: number;
};

type WaveformPoint = {
  x: number;
  y: number;
  opacity: number;
};

type ParadePoint = WaveformPoint & {
  channel: "red" | "green" | "blue";
};

type ScopeAnalysis = {
  histogram: {
    luma: number[];
    red: number[];
    green: number[];
    blue: number[];
    max: number;
  };
  hueHistogram: {
    bins: number[];
    max: number;
  };
  waveform: WaveformPoint[];
  parade: ParadePoint[];
  vectors: ScopePoint[];
  averageSkinAngle: number | null;
  stats: {
    meanRgb: [number, number, number];
    meanLuma: number;
    minLuma: number;
    maxLuma: number;
    clippedShadows: number;
    clippedHighlights: number;
  };
};

export function ScopesEditor() {
  const [mode, setMode] = useState<"waveform" | "parade" | "vectorscope" | "histogram" | "hue">("waveform");
  const [scopeData, setScopeData] = useState<ScopeAnalysis | null>(null);
  const processedUrl = React.useSyncExternalStore(
    subscribeToImageUrl,
    getImageUrl,
    getImageUrl,
  );

  useEffect(() => {
    let cancelled = false;
    analyzeScopeImage(processedUrl)
      .then((data) => {
        if (!cancelled) setScopeData(data);
      })
      .catch(() => {
        if (!cancelled) setScopeData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [processedUrl]);

  return (
    <div className="scopes-editor">
      <div className="scope-tabs">
        <button className={mode === "waveform" ? "active" : ""} onClick={() => setMode("waveform")}>Waveform</button>
        <button className={mode === "parade" ? "active" : ""} onClick={() => setMode("parade")}>RGB Parade</button>
        <button className={mode === "vectorscope" ? "active" : ""} onClick={() => setMode("vectorscope")}>Vectorscope</button>
        <button className={mode === "histogram" ? "active" : ""} onClick={() => setMode("histogram")}>Histogram</button>
        <button className={mode === "hue" ? "active" : ""} onClick={() => setMode("hue")}>Hue</button>
      </div>
      {scopeData ? (
        <>
          {mode === "waveform" && <WaveformScope data={scopeData} />}
          {mode === "parade" && <ParadeScope data={scopeData} />}
          {mode === "vectorscope" && <Vectorscope data={scopeData} />}
          {mode === "histogram" && <HistogramScope data={scopeData} />}
          {mode === "hue" && <HueHistogramScope data={scopeData} />}
          <ScopeStats data={scopeData} />
        </>
      ) : (
        <div className="scope-empty">Import an image to populate scopes</div>
      )}
    </div>
  );
}

function ScopeStats({ data }: { data: ScopeAnalysis }) {
  const [r, g, b] = data.stats.meanRgb;
  return (
    <div className="scope-stats">
      <span>Luma {Math.round(data.stats.meanLuma * 100)}%</span>
      <span>RGB {Math.round(r * 255)} / {Math.round(g * 255)} / {Math.round(b * 255)}</span>
      <span>Min {Math.round(data.stats.minLuma * 100)}%</span>
      <span>Max {Math.round(data.stats.maxLuma * 100)}%</span>
      <span>Clip S {data.stats.clippedShadows.toFixed(2)}%</span>
      <span>Clip H {data.stats.clippedHighlights.toFixed(2)}%</span>
    </div>
  );
}

function WaveformScope({ data }: { data: ScopeAnalysis }) {
  return (
    <div className="scope-panel waveform-scope">
      <div className="scope-grid" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {data.waveform.map((point, index) => (
          <circle
            className="waveform-point"
            cx={point.x}
            cy={point.y}
            key={index}
            r="0.34"
            style={{ opacity: point.opacity }}
          />
        ))}
      </svg>
      <span className="scope-max">100</span><span className="scope-mid">50</span><span className="scope-min">0</span>
    </div>
  );
}

function ParadeScope({ data }: { data: ScopeAnalysis }) {
  return (
    <div className="scope-panel parade-scope">
      <div className="scope-grid parade-grid" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {data.parade.map((point, index) => (
          <circle
            className={`parade-point ${point.channel}`}
            cx={point.x}
            cy={point.y}
            key={index}
            r="0.34"
            style={{ opacity: point.opacity }}
          />
        ))}
      </svg>
      <div className="parade-labels"><span>R</span><span>G</span><span>B</span></div>
      <span className="scope-max">100</span><span className="scope-mid">50</span><span className="scope-min">0</span>
    </div>
  );
}

function HistogramScope({ data }: { data: ScopeAnalysis }) {
  const bins = data.histogram.luma.length;
  const barWidth = 100 / bins;
  const max = Math.max(data.histogram.max, 1);

  function bars(items: number[], className: string) {
    return items.map((value, index) => {
      const height = (value / max) * 92;
      return (
        <rect
          className={className}
          height={height}
          key={`${className}-${index}`}
          width={barWidth + 0.15}
          x={index * barWidth}
          y={100 - height}
        />
      );
    });
  }

  return (
    <div className="scope-panel histogram-scope">
      <div className="scope-grid" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {bars(data.histogram.red, "hist-red")}
        {bars(data.histogram.green, "hist-green")}
        {bars(data.histogram.blue, "hist-blue")}
        {bars(data.histogram.luma, "hist-luma")}
      </svg>
      <span className="scope-max">100</span><span className="scope-mid">50</span><span className="scope-min">0</span>
    </div>
  );
}

function HueHistogramScope({ data }: { data: ScopeAnalysis }) {
  const bins = data.hueHistogram.bins.length;
  const max = Math.max(data.hueHistogram.max, 1);
  return (
    <div className="scope-panel hue-histogram-scope">
      <div className="hue-histogram-bg" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {data.hueHistogram.bins.map((value, index) => {
          const width = 100 / bins;
          const height = (value / max) * 88;
          return (
            <rect
              className="hue-hist-bar"
              height={height}
              key={index}
              width={width + 0.1}
              x={index * width}
              y={96 - height}
            />
          );
        })}
      </svg>
      <div className="hue-hist-labels"><span>R</span><span>Y</span><span>G</span><span>C</span><span>B</span><span>M</span><span>R</span></div>
    </div>
  );
}

function Vectorscope({ data }: { data: ScopeAnalysis }) {
  return (
    <div className="scope-panel vectorscope">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <circle className="vector-ring outer" cx="50" cy="50" r="43" />
        <circle className="vector-ring inner" cx="50" cy="50" r="22" />
        <line className="vector-axis" x1="7" y1="50" x2="93" y2="50" />
        <line className="vector-axis" x1="50" y1="7" x2="50" y2="93" />
        <line className="skin-tone-line" x1="50" y1="50" x2="68" y2="11" />
        <text className="vector-label" x="70" y="12">SKIN</text>
        {data.vectors.map((point, index) => (
          <circle
            className="vector-point"
            cx={point.x}
            cy={point.y}
            key={index}
            r="0.55"
            style={{ opacity: point.opacity }}
          />
        ))}
      </svg>
      <div className="scope-readout">
        <span>{data.vectors.length} samples</span>
        <span>{data.averageSkinAngle === null ? "skin angle --" : `avg hue ${Math.round(data.averageSkinAngle)}°`}</span>
      </div>
    </div>
  );
}

async function analyzeScopeImage(url: string | null): Promise<ScopeAnalysis | null> {
  if (!url) return null;
  const image = await loadImage(url);
  const maxSide = 180;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const bins = 64;
  const histogram = {
    luma: Array.from({ length: bins }, () => 0),
    red: Array.from({ length: bins }, () => 0),
    green: Array.from({ length: bins }, () => 0),
    blue: Array.from({ length: bins }, () => 0),
    max: 1,
  };
  const hueBins = 72;
  const hueHistogram = {
    bins: Array.from({ length: hueBins }, () => 0),
    max: 1,
  };
  const vectors: ScopePoint[] = [];
  const waveform: WaveformPoint[] = [];
  const parade: ParadePoint[] = [];
  const sampleStep = Math.max(1, Math.floor((width * height) / 1400));
  const vectorStep = Math.max(1, Math.floor((width * height) / 900));
  let sampleIndex = 0;
  let angleTotal = 0;
  let angleCount = 0;
  let rTotal = 0;
  let gTotal = 0;
  let bTotal = 0;
  let lumaTotal = 0;
  let minLuma = 1;
  let maxLuma = 0;
  let clippedShadows = 0;
  let clippedHighlights = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index] / 255;
    const g = pixels[index + 1] / 255;
    const b = pixels[index + 2] / 255;
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const pixelNumber = index / 4;
    const px = pixelNumber % width;
    const rBin = Math.min(bins - 1, Math.floor(r * bins));
    const gBin = Math.min(bins - 1, Math.floor(g * bins));
    const bBin = Math.min(bins - 1, Math.floor(b * bins));
    const lBin = Math.min(bins - 1, Math.floor(luma * bins));
    histogram.red[rBin] += 1;
    histogram.green[gBin] += 1;
    histogram.blue[bBin] += 1;
    histogram.luma[lBin] += 1;
    rTotal += r;
    gTotal += g;
    bTotal += b;
    lumaTotal += luma;
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
    if (luma <= 0.01) clippedShadows += 1;
    if (luma >= 0.99) clippedHighlights += 1;

    const [hue, saturation] = rgbToHsvUnit(r, g, b);
    if (saturation > 0.02) {
      const hueBin = Math.min(hueBins - 1, Math.floor(hue * hueBins));
      hueHistogram.bins[hueBin] += saturation;
    }

    if (sampleIndex % sampleStep === 0) {
      const x = clamp((px / Math.max(1, width - 1)) * 100, 0, 100);
      waveform.push({
        x,
        y: clamp(100 - luma * 100, 0, 100),
        opacity: clamp(0.14 + luma * 0.32, 0.14, 0.5),
      });
      const channelWidth = 100 / 3;
      parade.push(
        {
          channel: "red",
          x: clamp((px / Math.max(1, width - 1)) * channelWidth, 0, channelWidth),
          y: clamp(100 - r * 100, 0, 100),
          opacity: 0.34,
        },
        {
          channel: "green",
          x: clamp(channelWidth + (px / Math.max(1, width - 1)) * channelWidth, channelWidth, channelWidth * 2),
          y: clamp(100 - g * 100, 0, 100),
          opacity: 0.34,
        },
        {
          channel: "blue",
          x: clamp(channelWidth * 2 + (px / Math.max(1, width - 1)) * channelWidth, channelWidth * 2, 100),
          y: clamp(100 - b * 100, 0, 100),
          opacity: 0.34,
        },
      );
    }

    if (sampleIndex % vectorStep === 0) {
      const cb = (b - luma) * 0.564;
      const cr = (r - luma) * 0.713;
      const x = clamp(50 + cb * 86, 4, 96);
      const y = clamp(50 - cr * 86, 4, 96);
      const saturation = Math.sqrt(cb * cb + cr * cr);
      vectors.push({ x, y, opacity: clamp(0.18 + saturation * 2.6, 0.18, 0.82) });
      const angle = Math.atan2(50 - y, x - 50) * 180 / Math.PI;
      if (saturation > 0.035) {
        angleTotal += angle < 0 ? angle + 360 : angle;
        angleCount += 1;
      }
    }
    sampleIndex += 1;
  }

  histogram.max = Math.max(...histogram.luma, ...histogram.red, ...histogram.green, ...histogram.blue, 1);
  hueHistogram.max = Math.max(...hueHistogram.bins, 1);
  const pixelCount = width * height;
  return {
    histogram,
    hueHistogram,
    waveform,
    parade,
    vectors,
    averageSkinAngle: angleCount ? angleTotal / angleCount : null,
    stats: {
      meanRgb: [rTotal / pixelCount, gTotal / pixelCount, bTotal / pixelCount],
      meanLuma: lumaTotal / pixelCount,
      minLuma,
      maxLuma,
      clippedShadows: (clippedShadows / pixelCount) * 100,
      clippedHighlights: (clippedHighlights / pixelCount) * 100,
    },
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rgbToHsvUnit(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > Number.EPSILON) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  const saturation = max <= Number.EPSILON ? 0 : delta / max;
  return [hue, saturation, max];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}
