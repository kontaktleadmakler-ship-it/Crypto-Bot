import React, { useEffect, useState, useRef } from 'react';

interface AgentState {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'executing';
  accuracy: number;
  lastSignal?: string;
}

export const NeuralCoreAgents: React.FC = () => {
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const wsUrl = process.env.REACT_APP_WS_URL || 'wss://api.neuralcore.internal/ws/agents';
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      console.log('[NeuralCore] WebSocket-Verbindung erfolgreich aufgebaut.');
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'AGENT_UPDATE' && payload.agent) {
          // Throttled UI state updates via AnimationFrame
          requestAnimationFrame(() => {
            setAgents((prev) => {
              const index = prev.findIndex((a) => a.id === payload.agent.id);
              if (index >= 0) {
                const updated = [...prev];
                updated[index] = { ...updated[index], ...payload.agent };
                return updated;
              }
              return [...prev, payload.agent];
            });
          });
        }
      } catch (err) {
        console.error('[NeuralCore] Fehler beim Parsen des WebSocket-Streams:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('[NeuralCore] WebSocket Fehler:', err);
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.warn('[NeuralCore] Verbindung getrennt. Reconnect wird vorbereitet...');
    };

    // Clean up memory leaks on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  return (
    <div className="neural-core-agents-panel p-6 bg-slate-900 text-white rounded-xl border border-slate-800 shadow-xl">
      <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-cyan-400">Neural Core Agents</h2>
          <p className="text-xs text-slate-400 mt-1">Echtzeit-Überwachung der aktiven KI-Handelsagenten</p>
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
        {agents.map((agent) => (
          <div key={agent.id} className="p-4 bg-slate-800/80 rounded-lg border border-slate-700/60 hover:border-cyan-500/50 transition-colors">
            <div className="flex justify-between items-start mb-2">
              <span className="font-semibold text-slate-100">{agent.name}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300 uppercase font-mono">{agent.status}</span>
            </div>
            <div className="text-sm text-cyan-400 font-mono mt-2">
              Genauigkeit: {(agent.accuracy * 100).toFixed(1)}%
            </div>
            {agent.lastSignal && (
              <div className="text-xs text-slate-400 mt-2 border-t border-slate-700/40 pt-2">
                Letztes Signal: <span className="font-semibold text-slate-200">{agent.lastSignal}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
