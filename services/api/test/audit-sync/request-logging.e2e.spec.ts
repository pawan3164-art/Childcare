import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';

/**
 * Proves the Stage 0 observability requirement end-to-end (see /CLAUDE.md):
 * every request logs entry/exit/duration automatically, with no per-route
 * opt-in. Spawns the real app (not a mocked logger) and inspects its stdout.
 */
describe('Observability: every request logs entry/exit/duration', () => {
  const TEST_PORT = 4010;
  let proc: ChildProcessWithoutNullStreams;
  let output = '';

  beforeAll((done) => {
    const apiRoot = path.resolve(__dirname, '..', '..');
    // Spawn node directly (no npx/shell wrapper) so proc.kill() in afterAll
    // actually terminates the process — a shell:true wrapper on Windows
    // leaves the real node process orphaned and Jest hangs waiting for it.
    proc = spawn(
      process.execPath,
      ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', 'src/main.ts'],
      {
        cwd: apiRoot,
        env: { ...process.env, PORT: String(TEST_PORT) },
      },
    );

    proc.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    const deadline = Date.now() + 20000;
    const poll = () => {
      fetch(`http://localhost:${TEST_PORT}/health`)
        .then(() => done())
        .catch(() => {
          if (Date.now() > deadline) {
            done(new Error(`API did not start within deadline. Output so far:\n${output}`));
          } else {
            setTimeout(poll, 300);
          }
        });
    };
    poll();
  }, 25000);

  afterAll(() => {
    proc.kill();
  });

  it('logs the health check request with method, path, status and duration', async () => {
    output = '';
    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 300)); // let the log line flush

    expect(output).toMatch(/GET \/health 200 - \d+ms/);
  });
});
