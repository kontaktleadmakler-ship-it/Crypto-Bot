import React, { useEffect, useState, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// FIX (Neural Core panel showed no live data at all):
//
// Root cause: this component was never actually wired to the trading bot's
// backend. It opened a WebSocket to a placeholder host
// (`wss://api.neuralcore.internal/ws/agents`) that does not exist anywhere
// in this project, waited for a `{ type: 'AGENT_UPDATE', agent: {...} }`
// message shape the backend never sends, and never supplied the
// `X-API-Key` the backend's auth middleware requires for every non-/health
// route (see trading-bot-v24.6-runtime.mjs, the
// `app.use((req,res,next)=>{...})` API-key guard). So the socket could
// never even complete a handshake, `onopen`/`onmessage` never fired, and
// the panel stayed on its empty initial state forever - matching exactly
// the reported symptom.
//
// The bot does have a real live-agent data path, already used by
// dashboard.html:
//   - REST snapshot:   GET /api/dashboard/agents?symbol=<SYM>
//                       -> { nodes: [{id,label,score,decision,status,color}],
//                            dqn, meta, confidence, consensus, vetoes,
//                            finalAction }  (see getDashboardAgentNetwork()).
//   - Live push (SSE): GET /api/dashboard/events/stream?apiKey=...
//                       -> `event: jarvis` messages whose payload has
//                          { type: 'AGENTS:EVALUATED', symbol, payload: {
//                            nodes, dqn, confidence, consensus, vetoes,
//                            finalAction } } every time any dashboard/scan
//                          path re-evaluates the agent suite for a symbol.
// EventSource cannot set custom headers, which is exactly why the backend
// also accepts the key as a `?apiKey=` query parameter for this one route.
//
// This rewrite switches the panel to that real data path: an initial REST
// fetch for the current snapshot, then an EventSource subscription for
// live updates, with the same node schema the backend actually emits
// (label/score/decision/status/color) instead of the old, never-matching
// name/accuracy/lastSignal shape. A working reconnect-with-backoff replaces
// the old code's comment that only *said* "Reconnect wird vorbereitet..."
// without ever doing it.
// ---------------------------------------------------------------------------

interface AgentNode {
  id: string;
  label: string;
  score: number;
  decision: string;
  status: string;
  color: string;
}

interface AgentNetworkPayload {
  timestamp?: number;
  symbol?: string;
  nodes: AgentNode[];
  confidence?: number;
  consensus?: number;
  finalAction?: string;
  vetoes?: Array<{ agent: string; reason: string }>;
}

const API_KEY_STORAGE_KEY = 'neuralCoreApiKey';

function getStoredApiKey(): string {
  try {
    return window.localStorage.getItem(API_KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function getApiBase(): string {
  return process.env.REACT_APP_API_BASE_URL || '';
}

export const NeuralCoreAgents: React.FC<{ symbol?: string }> = ({ symbol = 'BTC-USDT' }) => {
  const [nodes, setNodes] = useState<AgentNode[]>([]);
  const [finalAction, setFinalAction] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>(getStoredApiKey());
  const [needsApiKey, setNeedsApiKey] = useState<boolean>(!getStoredApiKey());
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  const applyNetwork = useCallback((data: AgentNetworkPayload) => {
    if (!data || !Array.isArray(data.nodes)) return;
    setNodes(data.nodes);
    if (typeof data.finalAction === 'string') setFinalAction(data.finalAction);
    if (typeof data.confidence === 'number') setConfidence(data.confidence);
  }, []);

  // Initial snapshot so the panel isn't empty while the SSE connection
  // is still (re)establishing.
  const fetchSnapshot = useCallback(async () => {
    if (!apiKey) return;
    try {
      const res = await fetch(
        `${getApiBase()}/api/dashboard/agents?symbol=${encodeURIComponent(symbol)}`,
        { headers: { 'X-API-Key': apiKey } }
      );
      if (res.status === 401) {
        setNeedsApiKey(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AgentNetworkPayload = await res.json();
      applyNetwork(data);
    } catch (err) {
      console.error('[NeuralCore] Snapshot-Fetch fehlgeschlagen:', err);
    }
  }, [apiKey, symbol, applyNetwork]);

  const connect = useCallback(() => {
    if (!apiKey) return;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // EventSource can't set an X-API-Key header, so the backend also
    // accepts the key as a query parameter on this one route.
    const url = `${getApiBase()}/api/dashboard/events/stream?symbol=${encodeURIComponent(symbol)}&apiKey=${encodeURIComponent(apiKey)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener('ready', () => {
      setIsConnected(true);
      setNeedsApiKey(false);
      reconnectAttemptRef.current = 0;
      console.log('[NeuralCore] Live-Stream verbunden.');
    });

    es.addEventListener('jarvis', (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed?.type === 'AGENTS:EVALUATED' && parsed.payload) {
          requestAnimationFrame(() => applyNetwork(parsed.payload));
        }
      } catch (err) {
        console.error('[NeuralCore] Fehler beim Parsen des Live-Streams:', err);
      }
    });

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      eventSourceRef.current = null;
      // Exponential backoff instead of the previous code's no-op reconnect.
      const attempt = Math.min(reconnectAttemptRef.current + 1, 6);
      reconnectAttemptRef.current = attempt;
      const delayMs = Math.min(30000, 1000 * 2 ** attempt);
      console.warn(`[NeuralCore] Verbindung getrennt. Reconnect in ${delayMs}ms...`);
      reconnectTimerRef.current = setTimeout(connect, delayMs);
    };
  }, [apiKey, symbol, applyNetwork]);

  useEffect(() => {
    if (!apiKey) return;
    fetchSnapshot();
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [apiKey, symbol, connect, fetchSnapshot]);

  const handleApiKeySubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      window.localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
    } catch {
      // localStorage unavailable (private browsing etc.) - key still works
      // for this session via component state.
    }
    setApiKey(trimmed);
  };

  if (needsApiKey) {
    return (
      <div className="neural-core-agents-panel p-6 bg-slate-900 text-white rounded-xl border border-slate-800 shadow-xl">
        <h2 className="text-xl font-bold text-cyan-400 mb-2">Neural Core Agents</h2>
        <p className="text-xs text-slate-400 mb-4">
          API-Key erforderlich, um auf die Live-Daten des Bot-Backends zuzugreifen.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem('apiKey') as HTMLInputElement;
            handleApiKeySubmit(input.value);
          }}
        >
          <input
            name="apiKey"
            type="password"
            placeholder="API Key"
            className="flex-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm text-slate-100"
          />
          <button type="submit" className="px-4 py-2 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-sm font-semibold">
            Verbinden
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="neural-core-agents-panel p-6 bg-slate-900 text-white rounded-xl border border-slate-800 shadow-xl">
      <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-cyan-400">Neural Core Agents</h2>
          <p className="text-xs text-slate-400 mt-1">
            Echtzeit-Überwachung der aktiven KI-Handelsagenten · {symbol}
            {finalAction && <> · Entscheidung: <span className="text-slate-200 font-semibold">{finalAction}</span></>}
            {confidence != null && <> · Konfidenz: <span className="text-slate-200 font-semibold">{confidence}%</span></>}
          </p>
        </div>
        <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${
          isConnected
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
            : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
        }`}>
          {isConnected ? 'ONLINE / STREAMING' : 'OFFLINE'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {nodes.length === 0 && (
          <p className="text-xs text-slate-500 col-span-full">Warte auf die erste Live-Auswertung der Agenten...</p>
        )}
        {nodes.map((agent) => (
          <div key={agent.id} className="p-4 bg-slate-800/80 rounded-lg border border-slate-700/60 hover:border-cyan-500/50 transition-colors">
            <div className="flex justify-between items-start mb-2">
              <span className="font-semibold text-slate-100">{agent.label}</span>
              <span
                className="text-xs px-2 py-0.5 rounded uppercase font-mono"
                style={{ backgroundColor: 'rgba(148,163,184,0.15)', color: agent.color || '#94a3b8' }}
              >
                {agent.status}
              </span>
            </div>
            <div className="text-sm text-cyan-400 font-mono mt-2">
              Score: {(agent.score * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-slate-400 mt-2 border-t border-slate-700/40 pt-2">
              Entscheidung: <span className="font-semibold text-slate-200">{agent.decision}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
