import { execSync } from 'node:child_process';

console.log('Probing Spark host (flak3dd)...');

try {
  const hostInfo = execSync("ssh -o ConnectTimeout=5 flak3dd 'hostname && whoami && nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader'", { encoding: 'utf8' });
  console.log('Remote host info:\n' + hostInfo);
} catch (err) {
  console.error('SSH connection error:', err.message);
  process.exit(1);
}

try {
  const models = execSync("ssh flak3dd 'curl -s http://127.0.0.1:8000/v1/models || echo NOT_READY'", { encoding: 'utf8' });
  console.log('v1/models response:\n' + models);
} catch (err) {
  console.log('Curl error:', err.message);
}

try {
  const containers = execSync("ssh flak3dd 'docker ps --format \"table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\" || true'", { encoding: 'utf8' });
  console.log('Docker containers:\n' + containers);
} catch (err) {
  console.log('Docker ps error:', err.message);
}

try {
  const gpuProcs = execSync("ssh flak3dd 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv || true'", { encoding: 'utf8' });
  console.log('GPU compute processes:\n' + gpuProcs);
} catch (err) {
  console.log('GPU query error:', err.message);
}

try {
  const logs = execSync("ssh flak3dd 'docker logs --tail 25 gpt-oss-120b-abliterated 2>&1 || true'", { encoding: 'utf8' });
  console.log('Recent container logs:\n' + logs);
} catch (err) {
  console.log('Logs error:', err.message);
}
