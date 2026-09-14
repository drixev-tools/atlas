// Wire protocol between the Node extension host and the persistent Python
// extraction server (src/pipelines/python/server.py). Each side exchanges
// newline-delimited JSON objects over the child process's stdin/stdout:
//
//   Node -> Python: { "id": number, "method": string, "params": object }
//   Python -> Node: { "id": number, "result": unknown }
//                or { "id": number, "error": { "message": string } }
//
// One JSON object per line; the Python process never writes anything else to
// stdout so partial/garbled lines never happen. Diagnostics from the Python
// side go to stderr instead.

export interface PythonRequest {
	id: number;
	method: string;
	params: Record<string, unknown>;
}

export interface PythonSuccessResponse {
	id: number;
	result: unknown;
}

export interface PythonErrorResponse {
	id: number;
	error: { message: string };
}

export type PythonResponse = PythonSuccessResponse | PythonErrorResponse;

export function isErrorResponse(response: PythonResponse): response is PythonErrorResponse {
	return (response as PythonErrorResponse).error !== undefined;
}

export function encodeRequest(request: PythonRequest): string {
	return `${JSON.stringify(request)}\n`;
}

export function parseResponseLine(line: string): PythonResponse | undefined {
	const trimmed = line.trim();
	if (!trimmed) {
		return undefined;
	}
	return JSON.parse(trimmed) as PythonResponse;
}
