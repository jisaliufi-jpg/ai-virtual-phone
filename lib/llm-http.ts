// lib/llm-http.ts
// LLM 请求的统一 fetch 出口。所有走 buildProviderRequest 的调用点统一经它发请求：
//  - 普通 provider：浏览器直连（现状不变）；
//  - serverProxy 标记（OpenCode 网关）：改发本站 /api/llm-proxy，由服务端转发，
//    绕过 opencode.ai 未开放浏览器 CORS 的问题。

import type { LlmRequestPayload } from "./llm-provider-adapter";

export type FetchLlmPayloadOptions = {
    signal?: AbortSignal;
};

// Clean control chars (except \t\n\r) and lone UTF-16 surrogates so that
// JSON.stringify produces output accepted by strict API parsers.
function sanitizeString(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue; // strip C0 ctrl
        if (code >= 0xD800 && code <= 0xDBFF) { // high surrogate
            const next = s.charCodeAt(i + 1);
            if (next >= 0xDC00 && next <= 0xDFFF) { out += s[i] + s[i + 1]; i++; } // valid pair
            else out += "�"; // lone high surrogate
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            out += "�"; // lone low surrogate
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

export function fetchLlmPayload(
    payload: LlmRequestPayload,
    options: FetchLlmPayloadOptions = {},
): Promise<Response> {
    const bodyText = JSON.stringify(sanitizeBodyValue(payload.body));
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
