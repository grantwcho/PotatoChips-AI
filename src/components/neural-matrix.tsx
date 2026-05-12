"use client";

import { useEffect, useRef } from "react";

type NodePoint = {
  x: number;
  y: number;
  layer: number;
  order: number;
  radius: number;
};

type BandAnchor = {
  x: number;
  centerY: number;
  spread: number;
  topY: number;
  bottomY: number;
};

type Edge = {
  from: number;
  to: number;
  phase: number;
};

type ForecastPath = {
  nodeIndices: number[];
  emphasis: number;
  phase: number;
};

type NeuralGeometry = {
  nodes: NodePoint[];
  edges: Edge[];
  layerNodes: number[][];
  forecastPaths: ForecastPath[];
  edgesByLayer: number[][];
};

type SignalPulse = {
  waveId: number;
  edgeIndex: number;
  elapsed: number;
  duration: number;
};

type ForwardPassResult = {
  nodeActivations: Float32Array[];
  edgeSignals: Float32Array[];
};

type ForwardPassWave = {
  waveId: number;
  elapsed: number;
  layerDuration: number;
  forwardPass: ForwardPassResult;
};

type WaveTemplate = {
  delay: number;
  layerDuration: number;
  forwardPass: ForwardPassResult;
};

type GlowState = {
  intensity: number;
};

type CanvasMetrics = {
  width: number;
  height: number;
  dpr: number;
};

const LAYER_SIZES = [1, 7, 9, 11, 13, 14, 13, 11, 10];
const BAND_CENTER_RATIOS = [0.63, 0.59, 0.54, 0.48, 0.51, 0.42, 0.45, 0.34, 0.27] as const;
const BAND_SPREAD_RATIOS = [0.11, 0.15, 0.2, 0.28, 0.39, 0.52, 0.65, 0.77, 0.88] as const;
const FANOUT_BY_LAYER = [5, 5, 4, 4, 3, 3, 2, 2] as const;

const FORECAST_PATH_COUNT = 18;
const WAVE_TEMPLATE_COUNT = 10;
const LEFT_PADDING = 18;
const RIGHT_PADDING = 18;
const TOP_PADDING = 56;
const BOTTOM_PADDING = 88;
const NODE_Y_JITTER = 14;

const MIN_WAVE_DELAY = 1600;
const MAX_WAVE_DELAY = 3200;
const MIN_EDGE_DURATION = 784;
const MAX_EDGE_DURATION = 1056;
const INITIAL_WAVE_DELAY = 520;
const MAX_ACTIVE_WAVES = 1;
const MAX_CANVAS_DPR = 1.5;
const EDGE_GLOW_SHADOW_BLUR = 3;
const PULSE_SHADOW_BLUR = 4;
const NOISE_WEIGHTS = [12.9898, 78.233, 37.719, 24.357, 91.113, 53.791] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fract(value: number) {
  return value - Math.floor(value);
}

function deterministicUnit(...values: number[]) {
  let accumulator = 0;

  for (let index = 0; index < values.length; index += 1) {
    accumulator +=
      values[index] *
      (NOISE_WEIGHTS[index % NOISE_WEIGHTS.length] * (1 + index * 0.113));
  }

  return fract(Math.sin(accumulator) * 43758.5453123);
}

function deterministicCentered(...values: number[]) {
  return deterministicUnit(...values) * 2 - 1;
}

function gaussianFromDeterministic(unitA: number, unitB: number) {
  const u1 = Math.max(unitA, 1e-10);
  const u2 = Math.max(unitB, 1e-10);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function getNodeRatio(order: number, size: number) {
  return size <= 1 ? 0.5 : order / (size - 1);
}

function createBandAnchors(width: number, height: number): BandAnchor[] {
  const startX = LEFT_PADDING;
  const usableWidth = Math.max(width - startX - RIGHT_PADDING, 320);
  const bandGap = usableWidth / Math.max(LAYER_SIZES.length - 1, 1);
  const innerHeight = Math.max(height - TOP_PADDING - BOTTOM_PADDING, 260);

  return Array.from({ length: LAYER_SIZES.length }, (_, layer) => {
    const spread = innerHeight * (BAND_SPREAD_RATIOS[layer] ?? 0.4);
    const centerY = TOP_PADDING + innerHeight * (BAND_CENTER_RATIOS[layer] ?? 0.5);

    return {
      x: startX + layer * bandGap,
      centerY,
      spread,
      topY: centerY - spread / 2,
      bottomY: centerY + spread / 2,
    };
  });
}

function buildNodes(
  width: number,
  height: number,
  widthSeed: number,
  heightSeed: number
) {
  const bandAnchors = createBandAnchors(width, height);
  const nodes: NodePoint[] = [];
  const layerNodes: number[][] = [];

  for (let layer = 0; layer < LAYER_SIZES.length; layer += 1) {
    const size = LAYER_SIZES[layer];
    const anchor = bandAnchors[layer];
    const jitteredSlots =
      size === 1
        ? [0.5]
        : Array.from({ length: size }, (_, order) =>
            clamp(
              (order + 0.5) / size +
                deterministicCentered(widthSeed, heightSeed, layer + 1, order + 1) *
                  (0.06 + 0.18 / Math.max(size, 3)),
              0.03,
              0.97
            )
          ).sort((left, right) => left - right);
    const nodeIndices: number[] = [];

    for (let order = 0; order < size; order += 1) {
      const ratio = jitteredSlots[order] ?? getNodeRatio(order, size);
      const x = clamp(anchor.x, LEFT_PADDING, width - RIGHT_PADDING);
      const y =
        size === 1
          ? clamp(anchor.centerY, TOP_PADDING * 0.55, height - BOTTOM_PADDING)
          : clamp(
              anchor.topY +
                (anchor.bottomY - anchor.topY) * ratio +
                Math.sin(layer * 0.74 + order * 1.06) * NODE_Y_JITTER,
              TOP_PADDING * 0.55,
              height - BOTTOM_PADDING
            );

      nodeIndices.push(nodes.length);
      nodes.push({
        x,
        y,
        layer,
        order,
        radius:
          layer === 0 || layer === LAYER_SIZES.length - 1
            ? 6
            : 5 + ((layer + order) % 4) * 0.22,
      });
    }

    nodeIndices.sort((left, right) => nodes[left].y - nodes[right].y);
    nodeIndices.forEach((nodeIndex, order) => {
      nodes[nodeIndex].order = order;
    });
    layerNodes.push(nodeIndices);
  }

  return { nodes, layerNodes };
}

function buildForecastPaths(
  nodes: NodePoint[],
  layerNodes: number[][],
  widthSeed: number,
  heightSeed: number
): ForecastPath[] {
  const firstLayer = layerNodes[0] ?? [];

  if (firstLayer.length === 0) {
    return [];
  }

  return Array.from({ length: FORECAST_PATH_COUNT }, (_, pathIndex) => {
    const nodeIndices = [firstLayer[pathIndex % firstLayer.length]];
    const startRatio = getNodeRatio(pathIndex % firstLayer.length, firstLayer.length);
    let targetRatio = startRatio;
    let localTilt = deterministicCentered(widthSeed, heightSeed, pathIndex + 1, 1.13);

    for (let layer = 1; layer < layerNodes.length; layer += 1) {
      const band = layerNodes[layer] ?? [];
      const progress = layer / Math.max(layerNodes.length - 1, 1);
      const volatility = 0.04 + progress * 0.16;
      const upwardDrift = 0.012 + progress * 0.022;

      localTilt = clamp(
        localTilt * 0.3 +
          deterministicCentered(widthSeed, heightSeed, pathIndex + 1, layer + 1, 2.17) *
            0.95,
        -1,
        1
      );

      const jaggedShock = localTilt * (0.022 + progress * 0.065);
      targetRatio = clamp(
        targetRatio -
          upwardDrift +
          jaggedShock +
          deterministicCentered(
            widthSeed,
            heightSeed,
            pathIndex + 1,
            layer + 1,
            3.71
          ) *
            volatility *
            0.5,
        0.02,
        0.98
      );

      if (layer === layerNodes.length - 1) {
        const minimumLift = Math.min(0.18, Math.max(0, startRatio - 0.06));
        targetRatio = Math.min(targetRatio, startRatio - minimumLift);
      }

      const selectedNode =
        band
          .map((nodeIndex) => ({
            nodeIndex,
            score:
              Math.abs(targetRatio - getNodeRatio(nodes[nodeIndex].order, band.length)) +
              deterministicUnit(
                widthSeed,
                heightSeed,
                pathIndex + 1,
                layer + 1,
                nodeIndex + 1
              ) *
                0.035,
          }))
          .sort((left, right) => left.score - right.score)[0]?.nodeIndex ??
        band[Math.floor(band.length / 2)];

      if (typeof selectedNode === "number") {
        nodeIndices.push(selectedNode);
      }
    }

    return {
      nodeIndices,
      emphasis: pathIndex < 3 ? 0.95 : pathIndex < 7 ? 0.8 : 0.62,
      phase: pathIndex * 0.37,
    };
  });
}

function buildEdges(
  nodes: NodePoint[],
  layerNodes: number[][],
  widthSeed: number,
  heightSeed: number
) {
  const edges: Edge[] = [];

  for (let layer = 0; layer < layerNodes.length - 1; layer += 1) {
    const currentLayer = layerNodes[layer];
    const nextLayer = layerNodes[layer + 1];
    const fanout =
      layer === 0
        ? nextLayer.length
        : Math.min(FANOUT_BY_LAYER[layer] ?? 2, nextLayer.length);

    for (const fromIndex of currentLayer) {
      const source = nodes[fromIndex];
      const sourceRatio = getNodeRatio(source.order, currentLayer.length);
      const targets = nextLayer
        .map((toIndex) => {
          const target = nodes[toIndex];
          const targetRatio = getNodeRatio(target.order, nextLayer.length);
          const continuity = 1 - Math.abs(sourceRatio - targetRatio);
          const upwardBias = (sourceRatio - targetRatio) * 0.24;

          return {
            toIndex,
            score:
              continuity * 1.3 +
              upwardBias +
              deterministicUnit(
                widthSeed,
                heightSeed,
                layer + 1,
                fromIndex + 1,
                toIndex + 1
              ) *
                0.2,
          };
        })
        .sort((left, right) => right.score - left.score)
        .slice(0, fanout);

      for (const { toIndex } of targets) {
        edges.push({
          from: fromIndex,
          to: toIndex,
          phase: fromIndex * 0.17 + toIndex * 0.09 + layer * 0.41,
        });
      }
    }
  }

  return edges;
}

function buildNetwork(width: number, height: number): NeuralGeometry {
  const widthSeed = Math.max(1, Math.round(width));
  const heightSeed = Math.max(1, Math.round(height));
  const { nodes, layerNodes } = buildNodes(width, height, widthSeed, heightSeed);
  const edges = buildEdges(nodes, layerNodes, widthSeed, heightSeed);
  const edgesByLayer: number[][] = Array.from(
    { length: LAYER_SIZES.length - 1 },
    () => []
  );

  for (let index = 0; index < edges.length; index += 1) {
    edgesByLayer[nodes[edges[index].from].layer].push(index);
  }

  return {
    nodes,
    edges,
    layerNodes,
    forecastPaths: buildForecastPaths(nodes, layerNodes, widthSeed, heightSeed),
    edgesByLayer,
  };
}

function getTrendColor() {
  return { red: 244, green: 238, blue: 228 };
}

function getTrendRgba(alpha: number) {
  const { red, green, blue } = getTrendColor();
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function createGlowState(intensity = 0): GlowState {
  return { intensity };
}

function setGlowState(glows: GlowState[], index: number, intensity: number) {
  const current = glows[index] ?? createGlowState();

  if (current.intensity >= intensity) {
    return;
  }

  glows[index] = createGlowState(intensity);
}

function drawPulseSegment(
  context: CanvasRenderingContext2D,
  geometry: NeuralGeometry,
  pulse: SignalPulse,
  signal = 1
) {
  const edge = geometry.edges[pulse.edgeIndex];

  if (!edge) {
    return;
  }

  const from = geometry.nodes[edge.from];
  const to = geometry.nodes[edge.to];
  const progress = Math.max(0, Math.min(1, pulse.elapsed / pulse.duration));
  const opacity = (0.24 + Math.sin(progress * Math.PI) * 0.6) * signal;
  const currentX = from.x + (to.x - from.x) * progress;
  const currentY = from.y + (to.y - from.y) * progress;

  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(currentX, currentY);
  context.strokeStyle = getTrendRgba(opacity);
  context.lineWidth = 1.9;
  context.shadowBlur = PULSE_SHADOW_BLUR;
  context.shadowColor = getTrendRgba(0.12 + opacity * 0.24);
  context.stroke();
  context.shadowBlur = 0;
}

function softenGlow(intensity: number) {
  return Math.pow(clamp(intensity, 0, 1), 1.35);
}

function initializeWeights(layerSizes: number[]) {
  const weights: Float32Array[] = [];
  const biases: Float32Array[] = [];

  for (let layer = 0; layer < layerSizes.length - 1; layer += 1) {
    const fanIn = layerSizes[layer];
    const fanOut = layerSizes[layer + 1];
    const std = Math.sqrt(2 / fanIn);
    const weightMatrix = new Float32Array(fanIn * fanOut);

    for (let index = 0; index < weightMatrix.length; index += 1) {
      weightMatrix[index] =
        gaussianFromDeterministic(
          deterministicUnit(layer + 1, index + 1, fanIn, fanOut, 0.17),
          deterministicUnit(layer + 1, index + 1, fanIn, fanOut, 0.73)
        ) * std;
    }

    weights.push(weightMatrix);
    biases.push(new Float32Array(fanOut));
  }

  return { weights, biases };
}

function buildWaveInput(inputSize: number, waveIndex: number) {
  const input = new Float32Array(inputSize);

  for (let index = 0; index < inputSize; index += 1) {
    const harmonic = (Math.sin((waveIndex + 1) * 0.91 + index * 1.13) + 1) * 0.5;
    const accent = (Math.cos((waveIndex + 1) * 0.47 - index * 0.79) + 1) * 0.5;
    const sparkle = deterministicUnit(waveIndex + 1, index + 1, 19.7) * 0.18;
    input[index] = 0.24 + harmonic * 0.44 + accent * 0.22 + sparkle;
  }

  return input;
}

function computeForwardPass(
  weights: Float32Array[],
  biases: Float32Array[],
  layerSizes: number[],
  input: Float32Array
): ForwardPassResult {
  const raw: Float32Array[] = [input];
  const nodeActivations: Float32Array[] = [];
  const edgeSignals: Float32Array[] = [];

  let maxInput = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] > maxInput) {
      maxInput = input[index];
    }
  }

  const normalizedInput = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    normalizedInput[index] = maxInput > 1e-8 ? input[index] / maxInput : 0;
  }
  nodeActivations.push(normalizedInput);

  for (let layer = 0; layer < weights.length; layer += 1) {
    const fanIn = layerSizes[layer];
    const fanOut = layerSizes[layer + 1];
    const weightMatrix = weights[layer];
    const biasVector = biases[layer];
    const previousLayer = raw[layer];

    const signalMatrix = new Float32Array(fanIn * fanOut);
    let maxSignal = 0;
    for (let sourceIndex = 0; sourceIndex < fanIn; sourceIndex += 1) {
      for (let targetIndex = 0; targetIndex < fanOut; targetIndex += 1) {
        const signal = Math.abs(
          weightMatrix[sourceIndex * fanOut + targetIndex] * previousLayer[sourceIndex]
        );
        signalMatrix[sourceIndex * fanOut + targetIndex] = signal;
        if (signal > maxSignal) {
          maxSignal = signal;
        }
      }
    }
    if (maxSignal > 1e-8) {
      for (let index = 0; index < signalMatrix.length; index += 1) {
        signalMatrix[index] /= maxSignal;
      }
    }
    edgeSignals.push(signalMatrix);

    const output = new Float32Array(fanOut);
    for (let targetIndex = 0; targetIndex < fanOut; targetIndex += 1) {
      let sum = biasVector[targetIndex];
      for (let sourceIndex = 0; sourceIndex < fanIn; sourceIndex += 1) {
        sum +=
          weightMatrix[sourceIndex * fanOut + targetIndex] *
          previousLayer[sourceIndex];
      }
      output[targetIndex] = Math.max(0, sum);
    }
    raw.push(output);

    let maxActivation = 0;
    for (let index = 0; index < fanOut; index += 1) {
      if (output[index] > maxActivation) {
        maxActivation = output[index];
      }
    }

    const normalizedOutput = new Float32Array(fanOut);
    for (let index = 0; index < fanOut; index += 1) {
      normalizedOutput[index] = maxActivation > 1e-8 ? output[index] / maxActivation : 0;
    }
    nodeActivations.push(normalizedOutput);
  }

  return { nodeActivations, edgeSignals };
}

function buildWaveTemplates(
  weights: Float32Array[],
  biases: Float32Array[],
  layerSizes: number[]
): WaveTemplate[] {
  return Array.from({ length: WAVE_TEMPLATE_COUNT }, (_, waveIndex) => {
    const delay =
      MIN_WAVE_DELAY +
      deterministicUnit(waveIndex + 1, 11.3) * (MAX_WAVE_DELAY - MIN_WAVE_DELAY);
    const layerDuration =
      MIN_EDGE_DURATION +
      deterministicUnit(waveIndex + 1, 23.7) *
        (MAX_EDGE_DURATION - MIN_EDGE_DURATION);

    return {
      delay,
      layerDuration,
      forwardPass: computeForwardPass(
        weights,
        biases,
        layerSizes,
        buildWaveInput(layerSizes[0], waveIndex)
      ),
    };
  });
}

function drawForecastPath(
  context: CanvasRenderingContext2D,
  geometry: NeuralGeometry,
  path: ForecastPath,
  time: number,
  prefersReducedMotion: boolean
) {
  if (path.nodeIndices.length < 2) {
    return;
  }

  const shimmer = prefersReducedMotion
    ? 0
    : (Math.sin(time * 1.8 + path.phase) + 1) * 0.006;
  const opacity = 0.028 + path.emphasis * 0.018 + shimmer;

  context.beginPath();

  for (let index = 0; index < path.nodeIndices.length; index += 1) {
    const node = geometry.nodes[path.nodeIndices[index]];

    if (!node) {
      continue;
    }

    if (index === 0) {
      context.moveTo(node.x, node.y);
      continue;
    }

    context.lineTo(node.x, node.y);
  }

  context.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
  context.lineWidth = 0.58 + path.emphasis * 0.2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
}

const PRECOMPUTED_WEIGHTS = initializeWeights(LAYER_SIZES);
const PRECOMPUTED_WAVE_TEMPLATES = buildWaveTemplates(
  PRECOMPUTED_WEIGHTS.weights,
  PRECOMPUTED_WEIGHTS.biases,
  LAYER_SIZES
);

export function NeuralMatrix() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const visibleRef = useRef(true);
  const geometryRef = useRef<NeuralGeometry>({
    nodes: [],
    edges: [],
    layerNodes: [],
    forecastPaths: [],
    edgesByLayer: [],
  });
  const canvasMetricsRef = useRef<CanvasMetrics>({
    width: 0,
    height: 0,
    dpr: 1,
  });
  const activeWavesRef = useRef<ForwardPassWave[]>([]);
  const edgeGlowRef = useRef<GlowState[]>([]);
  const nodeGlowRef = useRef<GlowState[]>([]);
  const nextWaveAtRef = useRef(0);
  const waveIdRef = useRef(0);
  const nextWaveTemplateIndexRef = useRef(0);
  const lastTimestampRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const target = canvas.parentElement ?? canvas;
      const width = Math.max(1, Math.floor(target.clientWidth));
      const height = Math.max(1, Math.floor(target.clientHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);

      canvasMetricsRef.current = { width, height, dpr };
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      geometryRef.current = buildNetwork(width, height);
      activeWavesRef.current = [];
      edgeGlowRef.current = Array.from(
        { length: geometryRef.current.edges.length },
        () => createGlowState()
      );
      nodeGlowRef.current = Array.from(
        { length: geometryRef.current.nodes.length },
        () => createGlowState()
      );
      nextWaveTemplateIndexRef.current = 0;
      lastTimestampRef.current = 0;

      const now = performance.now();
      nextWaveAtRef.current = prefersReducedMotion
        ? Number.POSITIVE_INFINITY
        : now + INITIAL_WAVE_DELAY;
    };

    const launchWave = (now: number) => {
      const geometry = geometryRef.current;

      if (
        geometry.layerNodes.length < 2 ||
        PRECOMPUTED_WAVE_TEMPLATES.length === 0
      ) {
        nextWaveAtRef.current = now + MIN_WAVE_DELAY;
        return;
      }

      const template =
        PRECOMPUTED_WAVE_TEMPLATES[
          nextWaveTemplateIndexRef.current % PRECOMPUTED_WAVE_TEMPLATES.length
        ];

      nextWaveTemplateIndexRef.current += 1;

      activeWavesRef.current.push({
        waveId: waveIdRef.current,
        elapsed: 0,
        layerDuration: template.layerDuration,
        forwardPass: template.forwardPass,
      });
      waveIdRef.current += 1;

      nextWaveAtRef.current = now + template.delay;
    };

    resize();

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = Boolean(entry?.isIntersecting);
      },
      { threshold: 0.05 }
    );
    intersectionObserver.observe(canvas);

    const resizeObserver = new ResizeObserver(() => {
      resize();
    });
    resizeObserver.observe(canvas.parentElement ?? canvas);
    window.addEventListener("resize", resize);

    const draw = (timestamp: number) => {
      animationRef.current = requestAnimationFrame(draw);

      if (!visibleRef.current) {
        lastTimestampRef.current = timestamp;
        return;
      }

      const geometry = geometryRef.current;
      const { width, height } = canvasMetricsRef.current;

      if (width === 0 || height === 0) {
        lastTimestampRef.current = timestamp;
        return;
      }

      const dt = lastTimestampRef.current
        ? Math.min(timestamp - lastTimestampRef.current, 48)
        : 16;

      lastTimestampRef.current = timestamp;
      context.clearRect(0, 0, width, height);

      if (
        !prefersReducedMotion &&
        timestamp >= nextWaveAtRef.current &&
        activeWavesRef.current.length < MAX_ACTIVE_WAVES
      ) {
        launchWave(timestamp);
      }

      const edgeGlow = edgeGlowRef.current;
      const nodeGlow = nodeGlowRef.current;
      const edgeDecay = Math.exp(-dt / 440);
      const nodeDecay = Math.exp(-dt / 260);

      for (let index = 0; index < edgeGlow.length; index += 1) {
        edgeGlow[index].intensity *= edgeDecay;
      }

      for (let index = 0; index < nodeGlow.length; index += 1) {
        nodeGlow[index].intensity *= nodeDecay;
      }

      if (!prefersReducedMotion) {
        const numTransitions = geometry.layerNodes.length - 1;

        activeWavesRef.current = activeWavesRef.current.filter((wave) => {
          wave.elapsed += dt;
          const totalDuration = wave.layerDuration * numTransitions;

          if (wave.elapsed >= totalDuration) {
            return false;
          }

          const currentLayerFloat = (wave.elapsed / totalDuration) * numTransitions;
          const activeTransition = Math.min(
            Math.floor(currentLayerFloat),
            numTransitions - 1
          );
          const transitionProgress = clamp(
            currentLayerFloat - activeTransition,
            0,
            1
          );

          const sourceNodes = geometry.layerNodes[activeTransition] ?? [];
          for (const nodeIndex of sourceNodes) {
            const node = geometry.nodes[nodeIndex];
            const activation =
              wave.forwardPass.nodeActivations[activeTransition][node.order];

            if (activation > 0.01) {
              setGlowState(nodeGlow, nodeIndex, activation);
            }
          }

          const layerEdges = geometry.edgesByLayer[activeTransition] ?? [];
          for (const edgeIndex of layerEdges) {
            const edge = geometry.edges[edgeIndex];
            const fromNode = geometry.nodes[edge.from];
            const toNode = geometry.nodes[edge.to];
            const fanOut = LAYER_SIZES[activeTransition + 1];
            const signal =
              wave.forwardPass.edgeSignals[activeTransition][
                fromNode.order * fanOut + toNode.order
              ];
            const intensity = (0.18 + transitionProgress * 0.24) * signal;

            if (intensity > 0.01) {
              setGlowState(edgeGlow, edgeIndex, intensity);
            }
          }

          if (transitionProgress > 0.8) {
            const targetNodes = geometry.layerNodes[activeTransition + 1] ?? [];
            const ramp = clamp((transitionProgress - 0.8) / 0.2, 0, 1);

            for (const nodeIndex of targetNodes) {
              const node = geometry.nodes[nodeIndex];
              const activation =
                wave.forwardPass.nodeActivations[activeTransition + 1][node.order];

              if (activation * ramp > 0.01) {
                setGlowState(nodeGlow, nodeIndex, activation * ramp);
              }
            }
          }

          return true;
        });
      }

      const time = timestamp * 0.00035;

      for (const path of geometry.forecastPaths) {
        drawForecastPath(context, geometry, path, time, prefersReducedMotion);
      }

      for (let index = 0; index < geometry.edges.length; index += 1) {
        const edge = geometry.edges[index];
        const from = geometry.nodes[edge.from];
        const to = geometry.nodes[edge.to];
        const shimmer = prefersReducedMotion
          ? 0.11
          : 0.11 + (Math.sin(time + edge.phase) + 1) * 0.024;
        const glow = edgeGlow[index] ?? createGlowState();
        const softenedGlow = softenGlow(glow.intensity);
        const opacity = shimmer + softenedGlow * 0.38;

        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.strokeStyle = `rgba(244, 238, 228, ${opacity})`;
        context.lineWidth = 1.04 + softenedGlow * 0.5;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.stroke();

        if (glow.intensity > 0.02) {
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
          context.strokeStyle = getTrendRgba(0.1 + softenedGlow * 0.34);
          context.lineWidth = 1.04 + softenedGlow * 0.72;
          context.shadowBlur = EDGE_GLOW_SHADOW_BLUR;
          context.shadowColor = getTrendRgba(0.08 + softenedGlow * 0.18);
          context.stroke();
          context.shadowBlur = 0;
        }
      }

      if (!prefersReducedMotion) {
        const numTransitions = geometry.layerNodes.length - 1;

        for (const wave of activeWavesRef.current) {
          const totalDuration = wave.layerDuration * numTransitions;
          const currentLayerFloat = (wave.elapsed / totalDuration) * numTransitions;
          const activeTransition = Math.min(
            Math.floor(currentLayerFloat),
            numTransitions - 1
          );
          const transitionProgress = clamp(
            currentLayerFloat - activeTransition,
            0,
            1
          );
          const layerEdges = geometry.edgesByLayer[activeTransition] ?? [];

          for (const edgeIndex of layerEdges) {
            const edge = geometry.edges[edgeIndex];
            const fromNode = geometry.nodes[edge.from];
            const toNode = geometry.nodes[edge.to];
            const fanOut = LAYER_SIZES[activeTransition + 1];
            const signal =
              wave.forwardPass.edgeSignals[activeTransition][
                fromNode.order * fanOut + toNode.order
              ];

            if (signal > 0.02) {
              drawPulseSegment(
                context,
                geometry,
                {
                  waveId: wave.waveId,
                  edgeIndex,
                  elapsed: transitionProgress * wave.layerDuration,
                  duration: wave.layerDuration,
                },
                signal
              );
            }
          }
        }
      }

      for (let index = 0; index < geometry.nodes.length; index += 1) {
        const node = geometry.nodes[index];
        const glow = nodeGlow[index] ?? createGlowState();
        const softenedGlow = softenGlow(glow.intensity);

        if (glow.intensity > 0.02) {
          context.beginPath();
          context.arc(node.x, node.y, node.radius * 2.2, 0, Math.PI * 2);
          context.fillStyle = getTrendRgba(0.05 + softenedGlow * 0.16);
          context.fill();
        }

        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fillStyle =
          glow.intensity > 0.02
            ? getTrendRgba(0.26 + softenedGlow * 0.52)
            : "rgba(255, 255, 255, 0.22)";
        context.fill();
      }
    };

    animationRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationRef.current);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="pointer-events-none relative h-full min-h-[40.625rem] w-full lg:min-h-[48.875rem]">
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}
