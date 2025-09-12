// public/app.js
const socket = io(); // connects to same origin
let room = null;
let localStream = null;
let worker = null;
let soundcardSampleRate = 48000;
const chunkSize = 1024;
const outSampleRate = 16000; // send at 16kHz
const outBitDepth = 16;

const localAudioEl = document.getElementById('localAudio');
const remotesDiv = document.getElementById('remotes');
const clientsEl = document.getElementById('clients');

document.getElementById('join').onclick = async () => {
  room = document.getElementById('room').value || 'main';
  socket.emit('join', room);
  document.getElementById('join').disabled = true;
  document.getElementById('leave').disabled = false;
  document.getElementById('talk').disabled = false;
};

document.getElementById('leave').onclick = () => {
  if (room) socket.emit('leave');
  room = null;
  document.getElementById('join').disabled = false;
  document.getElementById('leave').disabled = true;
  document.getElementById('talk').disabled = true;
  document.getElementById('stopTalking').disabled = true;
};

document.getElementById('talk').onclick = startTalking;
document.getElementById('stopTalking').onclick = stopTalking;

socket.on('connect', () => {
  console.log('Connected to signaling server.');
});

socket.on('clients', (c) => {
  clientsEl.innerText = `${c} user(s) in room`;
});

// incoming broadcasted audio
// payload: { sid, a: ArrayBuffer, s: sampleRate, b: bitDepth, p }
// We pass the binary to worker for upsample -> worker will return Float32Array buffer
socket.on('d', (payload) => {
  // payload.a may be an ArrayBuffer or TypedArray; ensure ArrayBuffer
  const ab = payload.a instanceof ArrayBuffer ? payload.a : payload.a.buffer;
  // Send to worker to decode + upsample to soundcardSampleRate
  worker.postMessage({
    inc: true,
    sid: payload.sid,
    inDataBuf: ab,
    inSampleRate: payload.s,
    outSampleRate: soundcardSampleRate,
    inBitDepth: payload.b,
    p: payload.p
  }, [ab]);
});

// worker messages
function onWorkerMessage(e) {
  const d = e.data;
  if (d.kind === 'inc') {
    // d.buffer is transferred ArrayBuffer of float32 samples at soundcardSampleRate
    const floatArr = new Float32Array(d.buffer);
    playRemoteBuffer(d.sid, floatArr);
  } else if (d.kind === 'out') {
    // outgoing encoded ArrayBuffer (int16)
    const ab = d.buffer;
    // send binary to server with metadata
    socket.volatile.emit('d', { buf: ab, sampleRate: outSampleRate, bitDepth: outBitDepth, p: d.p });
    // NOTE: Socket.IO on browser may wrap this into an object; ensure server reads payload.buf/ArrayBuffer
    // In our server we expect payload.buf as .buf; but for simplicity below we emit a small object
    // we'll instead emit a small wrapper:
    socket.volatile.emit('d', { buf: ab, sampleRate: outSampleRate, bitDepth: outBitDepth, p: d.p });
    // but our server code expects "buf" under payload.buf; to be safe we'll use the "d" handler implementation on server.
  } else if (d.kind === 'silent') {
    // don't send
  }
}

function playRemoteBuffer(sid, float32Array) {
  // Create a small AudioContext per remote or reuse a single one with mixing. For simplicity, we use one context.
  if (!playRemoteBuffer.ctx) {
    playRemoteBuffer.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = playRemoteBuffer.ctx;
  const buffer = ctx.createBuffer(1, float32Array.length, ctx.sampleRate);
  // float32Array is at ctx.sampleRate if worker used that; we made worker upsample to soundcardSampleRate,
  // which should match ctx.sampleRate. If not, a mismatch will be audible; better to set outSampleRate=ctx.sampleRate.
  buffer.getChannelData(0).set(float32Array);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
}

// start talking: capture mic -> ScriptProcessor -> send Float32 to worker -> worker returns int16 buffer
async function startTalking() {
  // init worker
  worker = new Worker('voipWorker.js');
  worker.onmessage = onWorkerMessage;

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  soundcardSampleRate = ctx.sampleRate;

  try {
    // Request mic with WebRTC audio processing enabled
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000
      }
    });

    localAudioEl.srcObject = localStream;
    localAudioEl.muted = true;

    // Create Web Audio chain
    const source = ctx.createMediaStreamSource(localStream);

    // Add a high-pass filter to cut low-frequency noise (rumble, fan, mic bumps)
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 200; // cut below 200Hz

    // ScriptProcessor to grab audio frames
    const node = ctx.createScriptProcessor(chunkSize, 1, 1);

    const minGain = 0.001; // simple VAD threshold

    node.onaudioprocess = (e) => {
      const inData = e.inputBuffer.getChannelData(0);
      const f32 = new Float32Array(inData.length);
      f32.set(inData);
      worker.postMessage({
        inc: false,
        inData: f32,
        inSampleRate: soundcardSampleRate,
        outSampleRate: outSampleRate,
        outBitDepth: outBitDepth,
        outChunkSize: chunkSize,
        minGain
      }, [f32.buffer]);
    };

    // Connect chain: mic → highpass → processor
    source.connect(highpass);
    highpass.connect(node);
    node.connect(ctx.destination);

    document.getElementById('talk').disabled = true;
    document.getElementById('stopTalking').disabled = false;
  } catch (err) {
    console.error("Microphone access denied:", err);
    alert("Microphone access required.");
  }
}


function stopTalking() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (worker) {
    worker.terminate();
    worker = null;
  }
  document.getElementById('talk').disabled = false;
  document.getElementById('stopTalking').disabled = true;
}
