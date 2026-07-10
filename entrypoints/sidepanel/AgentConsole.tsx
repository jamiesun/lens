import { useState } from 'react';
import { useAgentStore } from '../../src/sidepanel/agent-store';

export function AgentConsole() {
  const phase = useAgentStore((state) => state.phase);
  const status = useAgentStore((state) => state.runStatus);
  const events = useAgentStore((state) => state.events);
  const reply = useAgentStore((state) => state.assistantReply);
  const error = useAgentStore((state) => state.runError);
  const runGoal = useAgentStore((state) => state.runGoal);
  const cancelRun = useAgentStore((state) => state.cancelRun);
  const [goal, setGoal] = useState('');

  return (
    <section className="agent-console" aria-labelledby="agent-goal-title">
      <div className="agent-console__header">
        <div>
          <p className="section-index">A0 / AGENT</p>
          <h2 id="agent-goal-title">Declare a page goal</h2>
        </div>
        <span className={`agent-phase agent-phase--${phase}`}>
          {status ?? phase}
        </span>
      </div>

      <textarea
        value={goal}
        data-testid="agent-goal"
        placeholder="例如：把客户姓名改为 Grace Hopper，手机号改为 13900001111"
        disabled={phase === 'running'}
        onChange={(event) => setGoal(event.target.value)}
      />
      <div className="agent-console__actions">
        <span>MODEL → CONTROLLED TOOLS → RECEIPTS</span>
        {phase === 'running' ? (
          <button
            type="button"
            className="agent-run agent-run--stop"
            onClick={cancelRun}
          >
            STOP
          </button>
        ) : (
          <button
            type="button"
            className="agent-run"
            data-testid="run-agent"
            disabled={!goal.trim()}
            onClick={() => runGoal(goal.trim())}
          >
            RUN GOAL
          </button>
        )}
      </div>

      {events.length > 0 && (
        <ol className="agent-event-list" data-testid="agent-events">
          {events.map((event, index) => (
            <li key={`${event.kind}-${index}`}>
              <span>{event.kind.toUpperCase()}</span>
              <p>
                {event.kind === 'status'
                  ? event.text
                  : event.kind === 'tool'
                    ? `${event.tool} · ${event.status} · ${event.detail}`
                    : event.kind === 'assistant'
                      ? event.text
                      : event.kind === 'error'
                        ? `${event.code} · ${event.message}`
                        : 'Run complete'}
              </p>
            </li>
          ))}
        </ol>
      )}

      {reply && (
        <div className="assistant-reply" data-testid="assistant-reply">
          <span>LENS / REPLY</span>
          <p>{reply}</p>
        </div>
      )}
      {error && (
        <p className="agent-error" data-testid="agent-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
