// lib/llm-http.ts
// LLM 请求的统一 fetch 出口。所有走 buildProviderRequest 的调用点统一经它发请求：
//  - 普通 provider：浏览器直连（现状不变）；
//  - serverProxy 标记（OpenCode 网关）：改发本站 /api/llm-proxy，由服务端转发，
//    绕过 opencode.ai 未开放浏览器 CORS 的问题。

import type { LlmRequestPayload } from "./llm-provider-adapter";

export type FetchLlmPayloadOptions = {
    signal?: AbortSignal;
};

// Pass 1 (pre-stringify): scrub individual string values in the body object.
// Removes C0 control chars (except \t \n \r) and replaces lone UTF-16 surrogates.
function sanitizeString(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
        if (code >= 0xD800 && code <= 0xDBFF) {
            const next = s.charCodeAt(i + 1);
            if (next >= 0xDC00 && next <= 0xDFFF) { out += s[i] + s[i + 1]; i++; }
            else out += "�";
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            out += "�";
        } else {
            out += s[i];
        }
    }
    return out;
}

function sanitizeBodyValue(value: unknown): unknown {
    if (typeof value === "string") return sanitizeString(value);
    if (Array.isArray(value)) return value.map(sanitizeBodyValue);
    if (value !== null && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            result[k] = sanitizeBodyValue(v);
        }
        return result;
    }
    return value;
}

// Pass 2 (post-stringify): scan the resulting JSON text for any \X where X is
// not a valid JSON escape character, and double the backslash so it becomes \\X.
// This is a last-resort catch for edge cases the pre-pass might miss.
function fixInvalidJsonEscapes(json: string): string {
    // Valid single-char JSON escapes: " \ / b f n r t
    // Valid multi-char: \uXXXX (handled separately by not touching \u)
    return json.replace(/\\([^"\\/bfnrtu])/g, "\\\\$1");
}

export function fetchLlmPayload(
    payload: LlmRequestPayload,
    options: FetchLlmPayloadOptions = {},
): Promise<Response> {
    const bodyText = fixInvalidJsonEscapes(JSON.stringify(sanitizeBodyValue(payload.body)));
    if (payload.serverProxy) {
        return fetch("/api/llm-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: payload.url,
                headers: payload.headers,
                body: bodyText,
            }),
            signal: options.signal,
        });
    }
    return fetch(payload.url, {
        method: "POST",
        headers: payload.headers,
        body: bodyText,
        signal: options.signal,
    });
}
