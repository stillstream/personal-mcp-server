#!/usr/bin/env python3
"""Model fact probe for the unified MCP gateway (S0/S3).

Read-only inventory of local OpenAI-compatible model servers. For each model
and each network path (loopback / LAN / Tailscale) it verifies:

  health   GET  /health                  -> HTTP status
  models   GET  /v1/models               -> model id + context facts
                                              (vLLM max_model_len, or
                                               llama.cpp meta.n_ctx)
  complete POST /v1/chat/completions     -> minimal non-streaming request
The loopback path additionally verifies real streaming (SSE), tool calling
and vision input. Nothing on the server side is modified; prompts are tiny
synthetic strings with a small max_tokens budget.

Usage:
  python3 probe_model_facts.py [--config instance.json] [--paths loopback,lan,ts]
      [--skip tools,vision,stream] [--out evidence.json]

Instance JSON (optional; defaults to the discovered aifly-server1 layout):
{
  "host_paths": {"loopback": "127.0.0.1", "lan": "192.168.100.200",
                 "ts": "100.92.213.107"},
  "models": [
    {"key": "qwen27b",    "port": 18000, "model": "Qwen3.8-27B-NVFP4-RTX5090"},
    {"key": "flashnext",  "port": 18081, "model": "qwen3.8-flash-next-local"}
  ]
}
"""
import argparse
import json
import socket
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_CFG = {
    "host_paths": {"loopback": "127.0.0.1", "lan": "192.168.100.200",
                   "ts": "100.92.213.107"},
    "models": [
        {"key": "qwen27b", "port": 18000, "model": "Qwen3.8-27B-NVFP4-RTX5090"},
        {"key": "flashnext", "port": 18081, "model": "qwen3.8-flash-next-local"},
    ],
}

# 1x1 red PNG - smallest legal image for the vision probe.
RED_PNG_B64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
               "2mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

TOOLS = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city.",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]


def http(method, url, body=None, timeout=60, headers=None):
    data = None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return {"ok": True, "status": resp.status,
                    "ms": round((time.monotonic() - t0) * 1000, 1),
                    "raw": raw.decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code,
                "ms": round((time.monotonic() - t0) * 1000, 1),
                "error": e.read().decode("utf-8", "replace")[:400]}
    except Exception as e:  # noqa: BLE001 - report any transport failure as fact
        return {"ok": False, "status": None,
                "ms": round((time.monotonic() - t0) * 1000, 1),
                "error": f"{type(e).__name__}: {e}"}


def chat(base, model, messages, max_tokens=16, extra=None):
    body = {"model": model, "messages": messages,
            "max_tokens": max_tokens, "stream": False}
    if extra:
        body.update(extra)
    return http("POST", f"{base}/v1/chat/completions", body)


def parse_models(res):
    """Extract facts that work for both vLLM and llama.cpp style replies."""
    facts = {}
    try:
        j = json.loads(res["raw"])
    except Exception:  # noqa: BLE001
        return facts
    data = j.get("data") or []
    if data:
        m = data[0]
        facts["model_id"] = m.get("id")
        if isinstance(m.get("max_model_len"), int):
            facts["context_max_model_len"] = m["max_model_len"]
        meta = m.get("meta") or {}
        if isinstance(meta.get("n_ctx"), int):
            facts["context_n_ctx"] = meta["n_ctx"]
        if isinstance(meta.get("n_ctx_train"), int):
            facts["context_n_ctx_train"] = meta["n_ctx_train"]
        if meta.get("ftype"):
            facts["quant"] = meta["ftype"]
        facts["owned_by"] = m.get("owned_by")
    if "models" in j and isinstance(j["models"], list) and j["models"]:
        om = j["models"][0]
        facts["ollama_caps"] = om.get("capabilities")
    return facts


def probe_stream(base, model):
    body = {"model": model, "stream": True, "max_tokens": 24,
            "messages": [{"role": "user",
                          "content": "Count from 1 to 5. Nothing else."}]}
    req = urllib.request.Request(
        f"{base}/v1/chat/completions", data=json.dumps(body).encode(),
        method="POST", headers={"Content-Type": "application/json"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            first_chunk_ms = None
            chunks, content = 0, ""
            done = False
            for line in resp:
                if first_chunk_ms is None:
                    first_chunk_ms = round((time.monotonic() - t0) * 1000, 1)
                line = line.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    done = True
                    break
                chunks += 1
                try:
                    d = json.loads(payload)
                    delta = d["choices"][0].get("delta", {}).get("content")
                    if delta:
                        content += delta
                except Exception:  # noqa: BLE001
                    pass
            return {"ok": chunks > 0, "sse_chunks": chunks, "done_sent": done,
                    "first_chunk_ms": first_chunk_ms,
                    "total_ms": round((time.monotonic() - t0) * 1000, 1),
                    "content_head": content[:80]}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def probe_tools(base, model):
    res = chat(base, model, [{"role": "user",
                              "content": "What is the weather in Beijing? "
                                         "You must call the get_weather tool."}],
               max_tokens=128,
               extra={"tools": TOOLS, "tool_choice": "auto"})
    out = {"http_status": res.get("status"), "tool_called": False}
    if res.get("ok"):
        try:
            msg = json.loads(res["raw"])["choices"][0]["message"]
            tcs = msg.get("tool_calls") or []
            out["tool_called"] = bool(tcs)
            if tcs:
                fn = tcs[0].get("function", {})
                out["tool_name"] = fn.get("name")
                out["tool_args_head"] = (fn.get("arguments") or "")[:80]
            else:
                out["content_head"] = (msg.get("content") or "")[:120]
        except Exception as e:  # noqa: BLE001
            out["parse_error"] = str(e)
    elif res.get("error"):
        out["error"] = res["error"][:200]
    return out


def probe_vision(base, model):
    res = chat(base, model, [{
        "role": "user",
        "content": [
            {"type": "text", "text": "What color is this image? One word."},
            {"type": "image_url", "image_url": {
                "url": f"data:image/png;base64,{RED_PNG_B64}"}},
        ],
    }], max_tokens=8)
    out = {"http_status": res.get("status"), "accepted": False}
    if res.get("ok"):
        out["accepted"] = True
        try:
            out["content_head"] = (json.loads(res["raw"])["choices"][0]
                                   ["message"].get("content") or "")[:80]
        except Exception:  # noqa: BLE001
            pass
    elif res.get("error"):
        out["error"] = res["error"][:200]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config")
    ap.add_argument("--paths", default="loopback,lan,ts")
    ap.add_argument("--skip", default="",
                    help="comma list of: stream,tools,vision,complete")
    ap.add_argument("--out", default="-")
    a = ap.parse_args()
    cfg = json.load(open(a.config)) if a.config else DEFAULT_CFG
    paths = [p.strip() for p in a.paths.split(",") if p.strip()]
    skip = {s.strip() for s in a.skip.split(",") if s.strip()}
    results, table = {}, []

    for m in cfg["models"]:
        for p in paths:
            host = cfg["host_paths"].get(p)
            if not host:
                continue
            base = f"http://{host}:{m['port']}"
            rec = {"base": base}
            h = http("GET", f"{base}/health", timeout=8)
            rec["health"] = {"status": h["status"], "ms": h["ms"],
                             "ok": bool(h["ok"])}
            r = http("GET", f"{base}/v1/models", timeout=8)
            rec["models"] = ({"status": r["status"], "ok": bool(r["ok"]),
                              **parse_models(r)} if r["ok"]
                             else {"status": r["status"],
                                   "error": r.get("error", "")[:150]})
            if "complete" not in skip and rec["health"]["ok"]:
                c = chat(base, m["model"])
                rec["complete"] = {"status": c.get("status"),
                                   "ok": bool(c.get("ok")), "ms": c.get("ms")}
                if c.get("ok"):
                    try:
                        ch = json.loads(c["raw"])["choices"][0]
                        rec["complete"]["finish_reason"] = ch.get(
                            "finish_reason")
                        rec["complete"]["reply_head"] = (
                            ch["message"].get("content") or "")[:60]
                    except Exception:  # noqa: BLE001
                        rec["complete"]["parse_error"] = True
                else:
                    rec["complete"]["error"] = c.get("error", "")[:150]
            if p == "loopback":
                if "stream" not in skip and rec["health"]["ok"]:
                    rec["stream"] = probe_stream(base, m["model"])
                if "tools" not in skip and rec["health"]["ok"]:
                    rec["tools"] = probe_tools(base, m["model"])
                if "vision" not in skip and rec["health"]["ok"]:
                    rec["vision"] = probe_vision(base, m["model"])
            key = f"{m['key']}@{p}"
            results[key] = rec
            comp = rec.get("complete", {})
            st = rec["stream"] if "stream" in rec else {}
            tl = rec.get("tools", {})
            vi = rec.get("vision", {})
            table.append((key, rec["health"].get("status"),
                          rec["models"].get("context_max_model_len")
                          or rec["models"].get("context_n_ctx") or "-",
                          comp.get("status"), st.get("sse_chunks"),
                          tl.get("tool_called"), vi.get("accepted")))

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "host": socket.gethostname(),
        "results": results,
    }
    out = json.dumps(report, ensure_ascii=False, indent=2)
    if a.out == "-":
        print(out)
    else:
        with open(a.out, "w") as f:
            f.write(out)
    print("\n%-22s %-7s %-8s %-9s %-7s %-6s %-7s" % (
        "target", "health", "ctx", "complete", "sseN", "tool", "vision"))
    for row in table:
        print("%-22s %-7s %-8s %-9s %-7s %-6s %-7s" % row)
    print("\nevidence ->", a.out if a.out != "-" else "stdout")


if __name__ == "__main__":
    main()
