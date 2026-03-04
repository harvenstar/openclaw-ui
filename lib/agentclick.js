const AGENTCLICK_PORT = process.env.AGENTCLICK_PORT || process.env.PORT || '38173';
const AGENTCLICK_URL = process.env.AGENTCLICK_URL || `http://localhost:${AGENTCLICK_PORT}`;

/**
 * Send an action for human review and wait for approval.
 * @param {Object} options
 * @param {string} options.type - 'code_review' | 'email_review' | 'action_approval' | 'plan_review' | 'trajectory_review'
 * @param {string} options.sessionKey - OpenClaw session key
 * @param {Object} options.payload - Review-specific payload
 * @returns {Promise<Object>} User's decision
 */
async function reviewAndWait({ type, sessionKey, payload }) {
  // Create review session
  const res = await fetch(`${AGENTCLICK_URL}/api/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, sessionKey, payload })
  });
  
  if (!res.ok) {
    throw new Error(`AgentClick error: ${res.status} ${res.statusText}`);
  }
  
  const { sessionId } = await res.json();
  console.log(`[agentclick] Waiting for review: ${sessionId}`);
  
  // Long-poll for result (up to 5 min)
  const waitRes = await fetch(`${AGENTCLICK_URL}/api/sessions/${sessionId}/wait`);
  
  if (!waitRes.ok) {
    throw new Error(`AgentClick wait failed: ${waitRes.status}`);
  }
  
  const session = await waitRes.json();
  console.log(`[agentclick] Review complete: ${session.status}`);
  
  return session.result || session;
}

module.exports = { reviewAndWait };
