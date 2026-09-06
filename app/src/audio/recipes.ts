/**
 * Synthesized, gritty noir-style sound effects. No samples: every sound is built
 * from a cached white-noise buffer, oscillators, biquad filters and gain envelopes.
 * Every voice self-terminates (`start(when)` / `stop(when + duration)`), so nothing leaks.
 */

export type SfxKind =
  | "shot:pistol"
  | "shot:rifle"
  | "shot:shotgun"
  | "empty"
  | "reload"
  | "switch"
  | "pickup:spawn"
  | "pickup:health"
  | "pickup:ammo"
  | "weapon:drop"
  | "weapon:pickup"
  | "crate:hit"
  | "crate:break"
  | "grenade:throw"
  | "grenade:explode"
  | "hit:taken"
  | "hit:marker"
  | "hit:other"
  | "kill"
  | "death:self"
  | "death:other";

/** Exponential ramps cannot reach 0, so envelopes decay to this instead. */
const EPS = 0.0001;
/** Random pitch / playback-rate spread per voice (fraction), so rapid fire is not machine-like. */
const JITTER = 0.06;
/** Seconds of white noise kept per context; voices start at a random offset into it. */
const NOISE_SECONDS = 2;
/** Extra seconds a source keeps running past the end of its envelope before `stop()`. */
const TAIL = 0.01;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

function jitter(): number {
  return 1 + (Math.random() * 2 - 1) * JITTER;
}

interface Envelope {
  /** Peak linear gain. */
  gain: number;
  /** Seconds of linear attack; defaults to a near-instant 2 ms. */
  attack?: number;
  /** Seconds from `when` until the envelope has decayed to silence. */
  duration: number;
}

/** GainNode with a linear attack to `gain` and an exponential decay to `EPS` at `when + duration`. */
function envelope(ctx: AudioContext, out: AudioNode, when: number, env: Envelope): GainNode {
  const node = ctx.createGain();
  const attack = Math.min(env.attack ?? 0.002, env.duration * 0.5);
  node.gain.setValueAtTime(0, when);
  node.gain.linearRampToValueAtTime(env.gain, when + attack);
  node.gain.exponentialRampToValueAtTime(EPS, when + env.duration);
  node.connect(out);
  return node;
}

interface NoiseSpec extends Envelope {
  filter: BiquadFilterType;
  /** Filter cutoff / centre in Hz at `when`. */
  frequency: number;
  /** Optional cutoff to sweep to (exponentially) by the end of the envelope. */
  frequencyEnd?: number;
  q?: number;
}

/** Filtered white-noise burst. Returns its duration in seconds. */
function noise(ctx: AudioContext, out: AudioNode, when: number, spec: NoiseSpec): number {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.playbackRate.value = jitter();

  const filter = ctx.createBiquadFilter();
  filter.type = spec.filter;
  filter.Q.value = spec.q ?? 1;
  filter.frequency.setValueAtTime(spec.frequency, when);
  if (spec.frequencyEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(spec.frequencyEnd, when + spec.duration);
  }

  src.connect(filter).connect(envelope(ctx, out, when, spec));
  src.start(when, Math.random() * (NOISE_SECONDS - 1));
  src.stop(when + spec.duration + TAIL);
  return spec.duration;
}

interface ToneSpec extends Envelope {
  type: OscillatorType;
  frequency: number;
  /** Optional frequency to sweep to (exponentially) by the end of the envelope. */
  frequencyEnd?: number;
}

/** Single oscillator voice with a pitch jitter. Returns its duration in seconds. */
function tone(ctx: AudioContext, out: AudioNode, when: number, spec: ToneSpec): number {
  const osc = ctx.createOscillator();
  osc.type = spec.type;
  const pitch = jitter();
  osc.frequency.setValueAtTime(spec.frequency * pitch, when);
  if (spec.frequencyEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(spec.frequencyEnd * pitch, when + spec.duration);
  }
  osc.connect(envelope(ctx, out, when, spec));
  osc.start(when);
  osc.stop(when + spec.duration + TAIL);
  return spec.duration;
}

/** Low sine sweep: the body of shots, impacts and explosions. */
function thump(
  ctx: AudioContext,
  out: AudioNode,
  when: number,
  from: number,
  to: number,
  duration: number,
  gain: number
): number {
  return tone(ctx, out, when, { type: "sine", frequency: from, frequencyEnd: to, duration, gain });
}

/** Short bandpassed noise tick: mechanical clicks and clatter. */
function click(
  ctx: AudioContext,
  out: AudioNode,
  when: number,
  frequency: number,
  duration: number,
  gain: number,
  q = 3
): number {
  return noise(ctx, out, when, { filter: "bandpass", frequency, q, duration, gain });
}

/** Chime note with a slightly detuned upper partial for a metallic edge. */
function chime(
  ctx: AudioContext,
  out: AudioNode,
  when: number,
  frequency: number,
  duration: number,
  gain: number,
  type: OscillatorType,
  partialRatio: number,
  partialGain: number
): number {
  tone(ctx, out, when, { type, frequency, duration, gain, attack: 0.005 });
  tone(ctx, out, when, {
    type: "sine",
    frequency: frequency * partialRatio,
    duration: duration * 0.6,
    gain: gain * partialGain,
    attack: 0.005,
  });
  return duration;
}

/**
 * Schedule the sound for `kind` into `out`, starting at AudioContext time `when`.
 * Returns the voice's total duration in seconds so callers can release bookkeeping
 * (the sound is fully silent by `when + duration`).
 */
export function synthesize(ctx: AudioContext, kind: SfxKind, out: AudioNode, when: number): number {
  switch (kind) {
    case "shot:pistol": {
      noise(ctx, out, when, { filter: "bandpass", frequency: 1800, q: 0.8, duration: 0.06, gain: 0.7 });
      return thump(ctx, out, when, 90, 50, 0.12, 0.6);
    }
    case "shot:rifle": {
      noise(ctx, out, when, { filter: "bandpass", frequency: 2600, q: 0.9, duration: 0.04, gain: 0.6 });
      return thump(ctx, out, when, 110, 60, 0.08, 0.4);
    }
    case "shot:shotgun": {
      noise(ctx, out, when, { filter: "highpass", frequency: 2500, duration: 0.03, gain: 0.5 });
      noise(ctx, out, when, { filter: "lowpass", frequency: 900, frequencyEnd: 300, duration: 0.18, gain: 0.9 });
      return thump(ctx, out, when, 55, 35, 0.25, 0.8);
    }
    case "empty":
      return click(ctx, out, when, 3500, 0.012, 0.35, 2);
    case "reload": {
      click(ctx, out, when, 2500, 0.02, 0.4);
      return 0.06 + click(ctx, out, when + 0.06, 2000, 0.025, 0.35);
    }
    case "switch":
      return click(ctx, out, when, 1500, 0.03, 0.25, 2);
    case "pickup:spawn": {
      tone(ctx, out, when, { type: "sine", frequency: 2400, frequencyEnd: 1200, duration: 0.12, gain: 0.2 });
      return noise(ctx, out, when, {
        filter: "bandpass",
        frequency: 3000,
        frequencyEnd: 1200,
        q: 6,
        duration: 0.12,
        gain: 0.35,
      });
    }
    case "pickup:health": {
      chime(ctx, out, when, 523.25, 0.25, 0.3, "triangle", 2, 0.15);
      return 0.12 + chime(ctx, out, when + 0.12, 659.25, 0.3, 0.3, "triangle", 2, 0.15);
    }
    case "pickup:ammo": {
      chime(ctx, out, when, 880, 0.18, 0.25, "triangle", 2.76, 0.4);
      return 0.09 + chime(ctx, out, when + 0.09, 1108.73, 0.22, 0.25, "triangle", 2.76, 0.4);
    }
    case "weapon:drop": {
      thump(ctx, out, when, 140, 80, 0.08, 0.35);
      click(ctx, out, when, 1800, 0.05, 0.5, 4);
      click(ctx, out, when + 0.07, 2400, 0.04, 0.35, 4);
      return 0.16 + click(ctx, out, when + 0.16, 1500, 0.04, 0.25, 4);
    }
    case "weapon:pickup": {
      click(ctx, out, when, 1200, 0.04, 0.4, 2);
      return 0.09 + click(ctx, out, when + 0.09, 2000, 0.03, 0.5);
    }
    case "crate:hit": {
      noise(ctx, out, when, { filter: "lowpass", frequency: 500, duration: 0.08, gain: 0.5 });
      return thump(ctx, out, when, 160, 90, 0.1, 0.4);
    }
    case "crate:break": {
      noise(ctx, out, when, { filter: "bandpass", frequency: 1200, q: 1, duration: 0.12, gain: 0.6 });
      thump(ctx, out, when, 120, 70, 0.15, 0.5);
      return noise(ctx, out, when, {
        filter: "lowpass",
        frequency: 1500,
        frequencyEnd: 400,
        duration: 0.45,
        gain: 0.3,
        attack: 0.02,
      });
    }
    case "grenade:throw":
      return noise(ctx, out, when, {
        filter: "bandpass",
        frequency: 400,
        frequencyEnd: 1600,
        q: 1.5,
        duration: 0.25,
        gain: 0.25,
        attack: 0.08,
      });
    case "grenade:explode": {
      noise(ctx, out, when, { filter: "highpass", frequency: 2000, duration: 0.04, gain: 0.6 });
      thump(ctx, out, when, 60, 35, 0.5, 0.9);
      return noise(ctx, out, when, {
        filter: "lowpass",
        frequency: 500,
        frequencyEnd: 120,
        duration: 0.6,
        gain: 1,
        attack: 0.005,
      });
    }
    case "hit:taken": {
      noise(ctx, out, when, { filter: "lowpass", frequency: 300, duration: 0.1, gain: 0.5 });
      return thump(ctx, out, when, 100, 60, 0.12, 0.5);
    }
    case "hit:marker":
      return tone(ctx, out, when, { type: "triangle", frequency: 1500, duration: 0.04, gain: 0.3 });
    case "hit:other": {
      noise(ctx, out, when, { filter: "lowpass", frequency: 350, duration: 0.08, gain: 0.25 });
      return thump(ctx, out, when, 90, 60, 0.08, 0.25);
    }
    case "kill": {
      tone(ctx, out, when, { type: "triangle", frequency: 147, duration: 0.2, gain: 0.35, attack: 0.005 });
      return 0.1 + tone(ctx, out, when + 0.1, { type: "triangle", frequency: 196, duration: 0.25, gain: 0.35, attack: 0.005 });
    }
    case "death:self": {
      tone(ctx, out, when, { type: "triangle", frequency: 300, frequencyEnd: 60, duration: 0.6, gain: 0.35, attack: 0.01 });
      noise(ctx, out, when + 0.35, { filter: "lowpass", frequency: 250, duration: 0.15, gain: 0.6 });
      return 0.35 + thump(ctx, out, when + 0.35, 70, 40, 0.25, 0.6);
    }
    case "death:other": {
      noise(ctx, out, when, { filter: "lowpass", frequency: 300, duration: 0.12, gain: 0.4 });
      return thump(ctx, out, when, 80, 45, 0.15, 0.4);
    }
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled SfxKind: ${String(unhandled)}`);
    }
  }
}
