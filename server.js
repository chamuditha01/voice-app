const mediasoup = require('mediasoup');
const io = require('socket.io')(3001);

let worker, router, producerTransport, consumerTransport;

(async () => {
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({ mediaCodecs: [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 }
  ]});
})();

io.on('connection', socket => {
  socket.on('createTransport', async () => {
    const transport = await router.createWebRtcTransport({ listenIps: ['0.0.0.0'], enableUdp: true, enableTcp: true });
    socket.emit('transportCreated', {
      id: transport.id,
      iceParameters: transport.iceParameters,
      dtlsParameters: transport.dtlsParameters
    });
  });

  socket.on('connectTransport', async (dtlsParameters) => {
    await producerTransport.connect({ dtlsParameters });
  });

  socket.on('produce', async (kind, rtpParameters) => {
    await producerTransport.produce({ kind, rtpParameters });
  });
});
