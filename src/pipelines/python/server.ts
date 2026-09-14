import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { PythonRequest, PythonResponse, encodeRequest, isErrorResponse, parseResponseLine } from './protocol';

export class PythonServerError extends Error {}

const DEFAULT_PYTHON_CANDIDATES = ['python3', 'python'];
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface PythonServerOptions {
	/** Explicit Python executable to use. Defaults to trying `python3` then `python`. */
	pythonPath?: string;
	/** Path to the persistent server script. Defaults to the bundled server.py next to this module. */
	serverScriptPath?: string;
	cwd?: string;
	requestTimeoutMs?: number;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

/**
 * Manages a single long-lived Python child process that extracts Python
 * source files via the `ast` module. The process is started once and reused
 * across requests instead of spawning a new interpreter per file, so
 * `start()` should be called once and `stop()` when the pipeline is done
 * with it (e.g. when the extension deactivates or a workspace is closed).
 */
export class PythonServer {
	private readonly options: PythonServerOptions;
	private process: ChildProcess | undefined;
	private nextRequestId = 1;
	private readonly pending = new Map<number, PendingRequest>();
	private startPromise: Promise<void> | undefined;

	constructor(options: PythonServerOptions = {}) {
		this.options = options;
	}

	get isRunning(): boolean {
		return this.process !== undefined && !this.process.killed;
	}

	async start(): Promise<void> {
		if (this.isRunning) {
			return;
		}
		if (!this.startPromise) {
			this.startPromise = this.doStart().catch((error) => {
				this.startPromise = undefined;
				throw error;
			});
		}
		return this.startPromise;
	}

	async stop(): Promise<void> {
		const process = this.process;
		this.process = undefined;
		this.startPromise = undefined;
		this.rejectAllPending(new PythonServerError('Python server was stopped'));
		if (process && !process.killed) {
			process.kill();
		}
	}

	async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		if (!this.isRunning) {
			throw new PythonServerError('Python server is not running; call start() first');
		}

		const id = this.nextRequestId++;
		const payload: PythonRequest = { id, method, params };
		const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new PythonServerError(`Timed out waiting for response to '${method}' (id ${id})`));
			}, timeoutMs);

			this.pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeout
			});

			this.process!.stdin!.write(encodeRequest(payload), (error) => {
				if (error) {
					this.pending.delete(id);
					clearTimeout(timeout);
					reject(error);
				}
			});
		});
	}

	private async doStart(): Promise<void> {
		const scriptPath = this.options.serverScriptPath ?? path.join(__dirname, 'server.py');
		const candidates = this.options.pythonPath ? [this.options.pythonPath] : DEFAULT_PYTHON_CANDIDATES;

		let lastError: Error | undefined;
		for (const candidate of candidates) {
			try {
				await this.spawnWith(candidate, scriptPath);
				return;
			} catch (error) {
				lastError = error as Error;
			}
		}

		throw new PythonServerError(
			`Unable to start the Python extraction server. Tried: ${candidates.join(', ')}. ${lastError ? `Last error: ${lastError.message}` : ''}`
		);
	}

	private spawnWith(command: string, scriptPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const child = spawn(command, [scriptPath], { cwd: this.options.cwd });
			let settled = false;

			const fail = (error: Error): void => {
				if (settled) {
					return;
				}
				settled = true;
				child.kill();
				reject(error);
			};

			child.once('error', fail);

			child.stdin?.on('error', () => {
				/* swallowed: EPIPE while the process is exiting is expected and surfaced via 'exit' instead */
			});

			const lines = readline.createInterface({ input: child.stdout! });
			lines.on('line', (line) => this.handleLine(line));

			child.once('exit', (code) => {
				this.process = undefined;
				this.startPromise = undefined;
				this.rejectAllPending(
					new PythonServerError(`Python extraction server exited unexpectedly (code ${code})`)
				);
				if (!settled) {
					fail(new PythonServerError(`Python extraction server exited before startup completed (code ${code})`));
				}
			});

			this.process = child;

			this.request('ping')
				.then(() => {
					if (!settled) {
						settled = true;
						resolve();
					}
				})
				.catch(fail);
		});
	}

	private handleLine(line: string): void {
		let response: PythonResponse | undefined;
		try {
			response = parseResponseLine(line);
		} catch {
			return;
		}
		if (!response) {
			return;
		}

		const pending = this.pending.get(response.id);
		if (!pending) {
			return;
		}
		this.pending.delete(response.id);
		clearTimeout(pending.timeout);

		if (isErrorResponse(response)) {
			pending.reject(new PythonServerError(response.error.message));
		} else {
			pending.resolve(response.result);
		}
	}

	private rejectAllPending(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pending.clear();
	}
}
