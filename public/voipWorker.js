// public/voipWorker.js
// Simple worker: down/up sample + convert float32 <-> int16
// messages:
// { inc: false, inData: Float32Array, inSampleRate, outSampleRate, outBitDepth, outChunkSize }
// { inc: true, inDataBuf: ArrayBuffer, inSampleRate, outSampleRate, inBitDepth, outChunkSize, p }

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

// very simple linear resample (not high quality, but OK for demo)
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
    // incoming audio from server: ArrayBuffer with int16 (bitDepth 16) usually
    const inBuf = d.inDataBuf;
    const inBit = d.inBitDepth || 16;
    let floatIn;
    if (inBit === 16) {
      floatIn = int16ToFloat32Buffer(inBuf);
    } else {
      // fallback: assume Float32
      floatIn = new Float32Array(inBuf);
    }
    // resample to outSampleRate (soundcard)
    const out = resampleLinear(floatIn, d.inSampleRate, d.outSampleRate);
    // apply simple scaling if p provided (normalization)
    if (d.p) {
      for (let i=0;i<out.length;i++) out[i] = out[i] / d.p;
    }
    // send back Float32Array buffer
    self.postMessage({ kind: 'inc', sid: d.sid, buffer: out.buffer }, [out.buffer]);
  } else {
    // outgoing mic data: Float32Array in inData
    const floatIn = d.inData;
    const resampled = resampleLinear(floatIn, d.inSampleRate, d.outSampleRate);
    // optionally remove silence: quick VAD
    let energy = 0;
    for (let i = 0; i < resampled.length; i++) energy += Math.abs(resampled[i]);
    const mean = energy / resampled.length;
    if (mean < (d.minGain || 0.0005)) {
      // silence -> send null
      self.postMessage({ kind: 'silent' });
      return;
    }
    // convert to int16 and return ArrayBuffer
    const ab = floatTo16BitPCM(resampled);
    self.postMessage({ kind: 'out', buffer: ab, p: 1 }, [ab]);
  }
});
