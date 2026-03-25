import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';

/** Server → client event types */
type ServerEvent =
  | { type: 'prefill_started'; data: { domain: string; strategy: string } }
  | { type: 'prefill_ready'; data: { domain: string | null; strategy: string | null; has_draft: boolean } }
  | { type: 'reasoning_chunk'; data: { chunk: string } }
  | { type: 'done'; data: Record<string, unknown> }
  | { type: 'error'; data: { message: string } };

interface UseWebSocketReasoningReturn {
  /** Send a partial (in-progress) query for predictive reasoning. Debounced internally. */
  sendPartial: (text: string, provider?: string, model?: string) => void;
  /** Notify server that the user submitted the final query. */
  sendFinal: (text: string) => void;
  /** Whether the server is currently pre-thinking on a partial query. */
  isPrethinking: boolean;
  /** Whether a usable prefill result is ready. */
  prefillReady: boolean;
}

const DEBOUNCE_MS = 500;
const WS_RECONNECT_MS = 3000;
const MAX_RECONNECTS = 5;

export function useWebSocketReasoning(sessionId: string): UseWebSocketReasoningReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);
  const mountedRef = useRef(true);

  const [isPrethinking, setIsPrethinking] = useState(false);
  const [prefillReady, setPrefillReady] = useState(false);

  // ── WebSocket lifecycle ──

  const connect = useCallback(() => {
    if (!sessionId) return;

    // Derive ws:// URL — use API_BASE if set, otherwise current origin
    const base = API_BASE || window.location.origin;
    const wsBase = base.replace(/^http(s?):\/\//, (_match: string, s: string) => `ws${s}://`);
    const url = `${wsBase}/api/chat/ws/${sessionId}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return; // graceful fallback — no WS support
    }

    ws.onopen = () => {
      reconnectCountRef.current = 0;
    };

    ws.onmessage = (ev) => {
      let msg: ServerEvent;
      try {
        msg = JSON.parse(ev.data) as ServerEvent;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'prefill_started':
          setIsPrethinking(true);
          setPrefillReady(false);
          break;

        case 'prefill_ready':
          setIsPrethinking(false);
          setPrefillReady(true);
          break;

        case 'reasoning_chunk':
          // Could be used for real-time thinking preview — currently just indicates activity
          break;

        case 'done':
          setIsPrethinking(false);
          // prefillReady stays true if it was already set
          break;

        case 'error':
          setIsPrethinking(false);
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setIsPrethinking(false);

      if (mountedRef.current && reconnectCountRef.current < MAX_RECONNECTS) {
        reconnectCountRef.current += 1;
        setTimeout(() => {
          if (mountedRef.current) connect();
        }, WS_RECONNECT_MS);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this — reconnect logic handled there
    };

    wsRef.current = ws;
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  // ── Outgoing messages ──

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const sendPartial = useCallback(
    (text: string, provider?: string, model?: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      const trimmed = text.trim();
      if (!trimmed) {
        // User cleared input — cancel any running prefill
        send({ type: 'cancel' });
        setIsPrethinking(false);
        setPrefillReady(false);
        return;
      }

      debounceRef.current = setTimeout(() => {
        setPrefillReady(false);
        send({
          type: 'partial_query',
          content: trimmed,
          ...(provider && { provider }),
          ...(model && { model }),
        });
      }, DEBOUNCE_MS);
    },
    [send],
  );

  const sendFinal = useCallback(
    (text: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      send({ type: 'final_query', content: text.trim() });
      // Reset state — the HTTP POST flow takes over from here
      setIsPrethinking(false);
      setPrefillReady(false);
    },
    [send],
  );

  return { sendPartial, sendFinal, isPrethinking, prefillReady };
}
