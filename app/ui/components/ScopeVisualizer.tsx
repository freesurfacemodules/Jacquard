import { useCallback, useEffect, useRef } from "react";
import { usePatch, ScopeSnapshot } from "../state/PatchContext";

interface ScopeVisualizerProps {
  nodeId: string;
  defaultScale: number;
  defaultTime: number;
  initialSnapshot: ScopeSnapshot;
  sampleRate: number;
}

const VIEW_WIDTH = 220;
const VIEW_HEIGHT = 120;
const MAX_POINTS = 512;
const TARGET_REFRESH_HZ = 90;
const REFRESH_INTERVAL_MS = 1000 / TARGET_REFRESH_HZ;
const MAX_VERTICAL_LINES = 20;
const MAX_HORIZONTAL_LINES = 9;
const EPSILON = 1e-6;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

type PlotData = {
  signalVertices: Float32Array;
  gridVertices: Float32Array;
  signalVertexCount: number;
  gridVertexCount: number;
  triggered: boolean;
  hold: boolean;
};

type GLResources = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  positionLoc: number;
  colorLoc: WebGLUniformLocation | null;
  signalBuffer: WebGLBuffer;
  gridBuffer: WebGLBuffer;
};

function buildPlotData(
  snapshot: ScopeSnapshot,
  fallbackScale: number,
  fallbackTime: number,
  sampleRate: number
): PlotData {
  const sampleInterval = snapshot.sampleInterval > 0 ? snapshot.sampleInterval : 1 / Math.max(1, sampleRate);
  const scale = snapshot.scale && Number.isFinite(snapshot.scale) ? Math.abs(snapshot.scale) : fallbackScale;
  const requestedTime = snapshot.requestedTime && Number.isFinite(snapshot.requestedTime) ? snapshot.requestedTime : fallbackTime;
  const safeScale = clamp(scale, 0.1, 20);
  const triggered = (snapshot.mode ?? 0) !== 0;
  const hold = (snapshot.mode ?? 0) === 2;
  const samples = snapshot.samples ?? new Float32Array(0);
  const available = samples.length;
  if (available === 0) {
    return {
      signalVertices: new Float32Array(0),
      gridVertices: new Float32Array(0),
      signalVertexCount: 0,
      gridVertexCount: 0,
      triggered,
      hold
    };
  }

  const step = Math.max(1, Math.floor(available / MAX_POINTS));
  const lastIndex = available - 1;
  const vertexCount = Math.floor(available / step) + 1;
  const signalVertices = new Float32Array(vertexCount * 2);
  let cursor = 0;
  for (let i = 0; i < available; i += step) {
    const sample = clamp(samples[i], -safeScale, safeScale);
    const x = lastIndex > 0 ? i / lastIndex : 0;
    const y = 0.5 - sample / (safeScale * 2);
    const clipX = x * 2 - 1;
    const clipY = 1 - clamp(y, 0, 1) * 2;
    signalVertices[cursor++] = clipX;
    signalVertices[cursor++] = clipY;
  }
  if (cursor < signalVertices.length) {
    const finalSample = clamp(samples[lastIndex], -safeScale, safeScale);
    const y = 0.5 - finalSample / (safeScale * 2);
    signalVertices[cursor++] = 1;
    signalVertices[cursor++] = 1 - clamp(y, 0, 1) * 2;
  }

  const gridVertices: number[] = [];
  const maxVolts = Math.ceil(safeScale);
  const horizontalStep = Math.max(1, Math.ceil(maxVolts / MAX_HORIZONTAL_LINES));
  for (let volt = -maxVolts; volt <= maxVolts; volt += horizontalStep) {
    const y = 0.5 - volt / (safeScale * 2);
    const clipY = 1 - clamp(y, 0, 1) * 2;
    gridVertices.push(-1, clipY, 1, clipY);
  }

  const coverage = snapshot.coverage && Number.isFinite(snapshot.coverage)
    ? snapshot.coverage
    : samples.length * sampleInterval;
  const timeSpan = Math.max(requestedTime, coverage, samples.length * sampleInterval, EPSILON);
  const totalMs = timeSpan * 1000;
  const verticalDivisions = Math.max(1, Math.min(MAX_VERTICAL_LINES, Math.round(totalMs)));
  const stepMs = totalMs / verticalDivisions;
  for (let i = 0; i <= verticalDivisions; i++) {
    const ms = stepMs * i;
    const clipX = clamp(ms / totalMs, 0, 1) * 2 - 1;
    gridVertices.push(clipX, -1, clipX, 1);
  }

  return {
    signalVertices,
    gridVertices: Float32Array.from(gridVertices),
    signalVertexCount: cursor / 2,
    gridVertexCount: gridVertices.length / 2,
    triggered,
    hold
  };
}

export function ScopeVisualizer({
  nodeId,
  defaultScale,
  defaultTime,
  initialSnapshot,
  sampleRate
}: ScopeVisualizerProps): JSX.Element {
  const { subscribeScopeSnapshot } = usePatch();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resourcesRef = useRef<GLResources | null>(null);
  const pendingDataRef = useRef<PlotData | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastRenderTimeRef = useRef<number>(0);
  const defaultsRef = useRef({ scale: defaultScale, time: defaultTime });

  const requestFrame = useCallback(() => {
    if (frameRef.current != null) {
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const canvas = canvasRef.current;
      const pending = pendingDataRef.current;
      if (!canvas || !pending) {
        return;
      }
      const now = typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
      if (now - lastRenderTimeRef.current < REFRESH_INTERVAL_MS) {
        requestFrame();
        return;
      }

      let resources = resourcesRef.current;
      if (!resources) {
        const context =
          canvas.getContext("webgl", {
            antialias: false,
            preserveDrawingBuffer: false,
            desynchronized: true
          }) ??
          canvas.getContext("experimental-webgl", {
            antialias: false,
            preserveDrawingBuffer: false,
            desynchronized: true
          });
        if (!(context instanceof WebGLRenderingContext)) {
          return;
        }
        const gl = context;

        const compileShader = (type: number, source: string): WebGLShader => {
          const shader = gl.createShader(type);
          if (!shader) {
            throw new Error("Failed to create shader");
          }
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compile error: ${info ?? "unknown"}`);
          }
          return shader;
        };

        const vertexShader = compileShader(
          gl.VERTEX_SHADER,
          "attribute vec2 a_position;\nvoid main() { gl_Position = vec4(a_position, 0.0, 1.0); }"
        );
        const fragmentShader = compileShader(
          gl.FRAGMENT_SHADER,
          "precision mediump float;\nuniform vec4 u_color;\nvoid main() { gl_FragColor = u_color; }"
        );
        const program = gl.createProgram();
        if (!program) {
          throw new Error("Failed to create program");
        }
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          const info = gl.getProgramInfoLog(program);
          gl.deleteProgram(program);
          throw new Error(`Program link error: ${info ?? "unknown"}`);
        }
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        const positionLoc = gl.getAttribLocation(program, "a_position");
        const colorLoc = gl.getUniformLocation(program, "u_color");
        const signalBuffer = gl.createBuffer();
        const gridBuffer = gl.createBuffer();
        if (!signalBuffer || !gridBuffer) {
          throw new Error("Failed to create buffers");
        }

        resources = {
          gl,
          program,
          positionLoc,
          colorLoc,
          signalBuffer,
          gridBuffer
        };
        resourcesRef.current = resources;
      }

      const { gl, program, positionLoc, colorLoc, signalBuffer, gridBuffer } = resources;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }

      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);

      if (pending.gridVertexCount > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, pending.gridVertices, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
        if (colorLoc) {
          gl.uniform4f(colorLoc, 0.25, 0.35, 0.4, 1.0);
        }
        gl.drawArrays(gl.LINES, 0, pending.gridVertexCount);
      }

      if (pending.signalVertexCount > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, signalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, pending.signalVertices, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
        if (colorLoc) {
          if (pending.hold) {
            gl.uniform4f(colorLoc, 0.85, 0.6, 0.2, 1.0);
          } else if (pending.triggered) {
            gl.uniform4f(colorLoc, 0.0, 0.8, 0.4, 1.0);
          } else {
            gl.uniform4f(colorLoc, 0.75, 0.75, 0.75, 1.0);
          }
        }
        gl.drawArrays(gl.LINE_STRIP, 0, pending.signalVertexCount);
      }

      lastRenderTimeRef.current = now;
    });
  }, []);

  const updateFromSnapshot = useCallback(
    (snapshot: ScopeSnapshot) => {
      pendingDataRef.current = buildPlotData(snapshot, defaultsRef.current.scale, defaultsRef.current.time, sampleRate);
      requestFrame();
    },
    [requestFrame, sampleRate]
  );

  useEffect(() => {
    defaultsRef.current = { scale: defaultScale, time: defaultTime };
  }, [defaultScale, defaultTime]);

  useEffect(() => {
    updateFromSnapshot(initialSnapshot);
  }, [initialSnapshot, updateFromSnapshot]);

  useEffect(() => {
    const unsubscribe = subscribeScopeSnapshot(nodeId, updateFromSnapshot);
    return unsubscribe;
  }, [nodeId, subscribeScopeSnapshot, updateFromSnapshot]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      const resources = resourcesRef.current;
      if (resources) {
        const { gl, program, signalBuffer, gridBuffer } = resources;
        gl.deleteBuffer(signalBuffer);
        gl.deleteBuffer(gridBuffer);
        gl.deleteProgram(program);
      }
      resourcesRef.current = null;
    };
  }, []);

  return (
    <div className="scope-visualizer" aria-label="Oscilloscope">
      <canvas
        ref={canvasRef}
        className="scope-visualizer__canvas"
        width={VIEW_WIDTH}
        height={VIEW_HEIGHT}
        style={{ width: `${VIEW_WIDTH}px`, height: `${VIEW_HEIGHT}px` }}
      />
    </div>
  );
}
