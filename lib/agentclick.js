/**
 * AgentClick client library.
 * Agents use this to create review sessions and block until a human responds.
 */

/** Re-reads env vars at call time for late-binding in Docker/orchestrator contexts. */
function getBaseUrl() {
  if (process.env.AGENTCLICK_URL) return process.env.AGENTCLICK_URL;
  const port = process.env.AGENTCLICK_PORT || process.env.PORT || '38173';
  return `http://localhost:${port}`;
}

/**
 * Verify that an AgentClick server is reachable and returns the expected identity.
 * @param {Object} [options]
 * @param {number} [options.timeout=3000] - Timeout in ms
 * @returns {Promise<Object>} Identity object from the server
 */
async function ensureServer(options = {}) {
  const { timeout = 3000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${getBaseUrl()}/api/identity`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`AgentClick identity check failed: ${res.status} ${res.statusText}`);
    }
    const identity = await res.json();
    if (identity.service !== 'agentclick') {
      throw new Error(`Unexpected service: ${identity.service}`);
    }
    return identity;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`AgentClick server not reachable at ${getBaseUrl()} (timeout ${timeout}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send an action for human review and wait for approval.
 * @param {Object} options
 * @param {string} options.type - 'code_review' | 'email_review' | 'action_approval' | 'plan_review' | 'trajectory_review'
 * @param {string} [options.sessionKey] - OpenClaw session key
 * @param {Object} options.payload - Review-specific payload
 * @param {Function} [options.onRewrite] - async (session) => updatedPayload — called when user requests a rewrite
 * @param {number} [options.maxRounds=10] - Max rewrite rounds before returning
 * @param {boolean} [options.structured=false] - Return structured result object
 * @param {boolean} [options.noOpen] - If true, don't open browser
 * @returns {Promise<Object>} User's decision (structured or legacy format)
 */
async function reviewAndWait({ type, sessionKey, payload, onRewrite, maxRounds = 10, structured = false, noOpen, ...rest }) {
  const baseUrl = getBaseUrl();
  const legacyMode = !onRewrite && !structured;
  let rounds = 0;

  // Create review session
  const body = { type, payload, ...rest };
  if (sessionKey) body.sessionKey = sessionKey;
  if (noOpen) body.noOpen = noOpen;

  const res = await fetch(`${baseUrl}/api/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const msg = `AgentClick error: ${res.status} ${res.statusText}`;
    if (legacyMode) throw new Error(msg);
    return { status: 'error', error: msg, sessionId: null, rounds, result: null, session: null };
  }

  const { sessionId } = await res.json();
  console.log(`[agentclick] Waiting for review: ${sessionId}`);

  // Review loop
  while (rounds < maxRounds) {
    rounds++;

    let waitRes;
    try {
      waitRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/wait`);
    } catch (err) {
      const msg = `AgentClick network error during wait: ${err.message}`;
      if (legacyMode) throw new Error(msg);
      return { status: 'error', error: msg, sessionId, rounds, result: null, session: null };
    }

    // Timeout
    if (waitRes.status === 408) {
      console.log(`[agentclick] Review timed out: ${sessionId}`);
      if (legacyMode) throw new Error('AgentClick wait failed: 408');
      return { status: 'timeout', sessionId, rounds, result: null, session: null, error: null };
    }

    // Not found
    if (waitRes.status === 404) {
      const msg = `AgentClick session not found: ${sessionId}`;
      if (legacyMode) throw new Error(`AgentClick wait failed: 404`);
      return { status: 'error', error: msg, sessionId, rounds, result: null, session: null };
    }

    // Other HTTP errors
    if (!waitRes.ok) {
      const msg = `AgentClick wait failed: ${waitRes.status}`;
      if (legacyMode) throw new Error(msg);
      return { status: 'error', error: msg, sessionId, rounds, result: null, session: null };
    }

    const session = await waitRes.json();
    console.log(`[agentclick] Review status: ${session.status} (round ${rounds})`);

    // Completed
    if (session.status === 'completed') {
      if (legacyMode) return session.result || session;
      return { status: 'completed', result: session.result || null, sessionId, rounds, session, error: null };
    }

    // Rewriting
    if (session.status === 'rewriting') {
      if (!onRewrite) {
        // Legacy behavior: return immediately so caller can handle it
        if (legacyMode) return session.result || session;
        return { status: 'rewriting', result: session.result || null, sessionId, rounds, session, error: null };
      }

      // Call rewrite callback
      let updatedPayload;
      try {
        updatedPayload = await onRewrite(session);
      } catch (err) {
        const msg = `onRewrite callback error: ${err.message}`;
        console.error(`[agentclick] ${msg}`);
        return { status: 'error', error: msg, sessionId, rounds, result: session.result || null, session };
      }

      if (updatedPayload == null) {
        return { status: 'error', error: 'onRewrite returned null/undefined', sessionId, rounds, result: session.result || null, session };
      }

      // PUT updated payload back
      try {
        const putRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/payload`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: updatedPayload }),
        });
        if (!putRes.ok) {
          const msg = `AgentClick payload update failed: ${putRes.status}`;
          return { status: 'error', error: msg, sessionId, rounds, result: null, session };
        }
      } catch (err) {
        const msg = `AgentClick network error during payload update: ${err.message}`;
        return { status: 'error', error: msg, sessionId, rounds, result: null, session };
      }

      console.log(`[agentclick] Rewrite submitted, waiting for next review (round ${rounds})`);
      continue;
    }

    // Unexpected status — treat as completed to avoid infinite loop
    if (legacyMode) return session.result || session;
    return { status: session.status, result: session.result || null, sessionId, rounds, session, error: null };
  }

  // Max rounds exhausted
  console.log(`[agentclick] Max rounds (${maxRounds}) reached for: ${sessionId}`);
  if (legacyMode) throw new Error(`AgentClick max rewrite rounds (${maxRounds}) exceeded`);
  return { status: 'max_rounds', sessionId, rounds, result: null, session: null, error: null };
}

module.exports = { reviewAndWait, ensureServer };
