// public/voipWorker.js
// Handles audio resampling + int16 <-> float32 conversion

function floatTo16BitPCM(float32Array) {
  const l = float32Array.length;
  const buf = new ArrayBuffer(l * 2);
  const view = new DataView(buf);
  for (let i = 0; i < l; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buf;
}

function int16ToFloat32Buffer(ab) {
  const view = new DataView(ab);
  const l = view.byteLength / 2;
  const out = new Float32Array(l);
  for (let i = 0; i < l; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s / 0x8000;
  }
  return out;
}

// linear resampling
function resampleLinear(src, srcRate, dstRate) {
  if (srcRate === dstRate) return src;
  const ratio = srcRate / dstRate;
  const dstLength = Math.round(src.length / ratio);
  const dst = new Float32Array(dstLength);
  for (let i = 0; i < dstLength; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, src.length - 1);
    const frac = idx - i0;
    dst[i] = (1 - frac) * src[i0] + frac * src[i1];
  }
  return dst;
}

self.addEventListener('message', (e) => {
  const d = e.data;
  if (d.inc) {
    // === Incoming audio from server ===
    let floatIn = d.inBitDepth === 16
      ? int16ToFloat32Buffer(d.inDataBuf)
      : new Float32Array(d.inDataBuf);

    const out = resampleLinear(floatIn, d.inSampleRate, d.outSampleRate);

    // normalize if p provided
    if (d.p) {
      const gain = 1 / d.p;
      for (let i = 0; i < out.length; i++) out[i] *= gain;
    }

    // return as transferable buffer
    self.postMessage(
      { kind: 'inc', sid: d.sid, buffer: out.buffer },
      [out.buffer]
    );

  } else {
    // === Outgoing mic data ===
    const resampled = resampleLinear(d.inData, d.inSampleRate, d.outSampleRate);

    // quick silence detection
    let energy = 0;
    for (let i = 0; i < resampled.length; i++) energy += Math.abs(resampled[i]);
    const mean = energy / resampled.length;

    if (mean < (d.minGain || 0.0005)) {
      self.postMessage({ kind: 'silent' });
      return;
    }

    const ab = floatTo16BitPCM(resampled);
    self.postMessage({ kind: 'out', buffer: ab, p: mean }, [ab]);
  }
});
