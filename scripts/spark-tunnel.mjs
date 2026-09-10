#!/usr/bin/env node
/**
 * Spark Port 8000 Forwarder / Tunnel
 * Forwards local http://127.0.0.1:8000 to NVIDIA DGX Spark (192.168.4.101:8000).
 * Automatically handles reconnection, streaming SSE, and bidirectional proxies.
 */
import net from 'node:net';

const LOCAL_PORT = 8000;
const REMOTE_HOST = process.env.SPARK_HOST || '192.168.4.101';
const REMOTE_PORT = 8000;

const server = net.createServer({ noDelay: true }, (clientSocket) => {
  const remoteSocket = net.connect({ host: REMOTE_HOST, port: REMOTE_PORT, noDelay: true }, () => {
    clientSocket.pipe(remoteSocket);
    remoteSocket.pipe(clientSocket);
  });

  clientSocket.on('error', () => remoteSocket.destroy());
  remoteSocket.on('error', () => clientSocket.destroy());
  clientSocket.on('close', () => remoteSocket.destroy());
  remoteSocket.on('close', () => clientSocket.destroy());
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${LOCAL_PORT} already in use. Forwarder or native service active.`);
    process.exit(0);
  }
  console.error('Server error:', err);
});

server.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`\n======================================================`);
  console.log(`⚡ Spark Port 8000 Forwarder Active`);
  console.log(`📡 Local Tunnel: http://127.0.0.1:${LOCAL_PORT}/v1`);
  console.log(`🎯 Spark Target: http://${REMOTE_HOST}:${REMOTE_PORT}/v1`);
  console.log(`======================================================\n`);
});
