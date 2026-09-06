import * as THREE from "three";
import { attenuationGain, screenPan } from "./spatial";
import { synthesize, type SfxKind } from "./recipes";

/** Concurrent voices before the oldest is cut off. */
const MAX_VOICES = 32;
/** Minimum seconds between two plays of the same kind, so stacked fire does not clip. */
const MIN_INTERVAL = 0.025;
/** Seconds past a voice's synthesized duration before its nodes are released. */
const RELEASE_PAD = 0.05;
const MASTER_GAIN = 0.8;

interface Voice {
  gain: GainNode;
  panner: StereoPannerNode;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Client-only sound effect player. `play()` is a no-op until `unlock()` has run
 * from a user gesture and the context is running, so it is safe to call from
 * anywhere, including Node tests. Owns no DOM UI.
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private camera: THREE.Camera | null = null;
  private listener: THREE.Object3D | null = null;
  private voices: Voice[] = [];
  private lastPlayed = new Map<SfxKind, number>();

  /**
   * Lazily create the AudioContext and master chain (gain -> compressor -> destination)
   * and resume it. Call from a user gesture. Also installs window `pointerdown` /
   * `keydown` listeners (once) that resume the context whenever it is suspended again,
   * e.g. after the tab was backgrounded.
   */
  unlock(): void {
    if (typeof window === "undefined" || typeof AudioContext === "undefined") return;
    if (!this.ctx) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;
      master.connect(compressor).connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;

      const resume = (): void => this.resume();
      window.addEventListener("pointerdown", resume, { passive: true });
      window.addEventListener("keydown", resume, { passive: true });
    }
    this.resume();
  }

  /** The camera used for panning and the object whose position sounds attenuate from. */
  setListener(camera: THREE.Camera, listener: THREE.Object3D): void {
    this.camera = camera;
    this.listener = listener;
  }

  /**
   * Play `kind`. With `worldPos` the voice is attenuated by distance from the listener
   * (skipped entirely when inaudible) and panned by screen position; without it, it plays
   * at full gain, centred.
   */
  play(kind: SfxKind, worldPos?: THREE.Vector3): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== "running") return;

    let gain = 1;
    let pan = 0;
    if (worldPos && this.camera && this.listener) {
      gain = attenuationGain(worldPos.distanceTo(this.listener.position));
      if (gain <= 0) return;
      pan = screenPan(worldPos, this.camera);
    }

    const now = ctx.currentTime;
    const last = this.lastPlayed.get(kind);
    if (last !== undefined && now - last < MIN_INTERVAL) return;
    this.lastPlayed.set(kind, now);

    while (this.voices.length >= MAX_VOICES) this.release(this.voices[0]);

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    voiceGain.connect(panner).connect(master);

    const duration = synthesize(ctx, kind, voiceGain, now);
    const voice: Voice = {
      gain: voiceGain,
      panner,
      timer: setTimeout(() => this.release(voice), (duration + RELEASE_PAD) * 1000),
    };
    this.voices.push(voice);
  }

  private resume(): void {
    if (this.ctx?.state === "suspended") {
      this.ctx.resume().catch(() => {
        // Autoplay policy refused; the next gesture will try again.
      });
    }
  }

  /** Cut the voice (if still live) and drop its nodes so the graph can collect them. */
  private release(voice: Voice): void {
    const index = this.voices.indexOf(voice);
    if (index === -1) return;
    this.voices.splice(index, 1);
    clearTimeout(voice.timer);
    voice.gain.disconnect();
    voice.panner.disconnect();
  }
}

export const sfx = new Sfx();
