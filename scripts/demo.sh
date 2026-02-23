#!/bin/bash
# demo.sh — POST a mock email review session to AgentClick
# Usage: ./scripts/demo.sh [type]
#   type: email (default) | approval | code

TYPE=${1:-email}
BASE="http://localhost:3001"

case $TYPE in
  approval)
    curl -s -X POST "$BASE/api/review" \
      -H "Content-Type: application/json" \
      -d '{
        "type": "action_approval",
        "sessionKey": "demo-key",
        "payload": {
          "action": "Send Slack message to #engineering",
          "description": "Post the weekly deployment summary to the engineering channel.",
          "risk": "medium"
        }
      }' | python3 -m json.tool
    ;;
  code)
    curl -s -X POST "$BASE/api/review" \
      -H "Content-Type: application/json" \
      -d '{
        "type": "code_review",
        "sessionKey": "demo-key",
        "payload": {
          "command": "rm -rf ./dist && npm run build",
          "cwd": "/Users/demo/project",
          "explanation": "Clean build artifacts and rebuild the project.",
          "risk": "low",
          "files": ["src/index.ts", "src/pages/ReviewPage.tsx", "src/utils/helpers.ts", "package.json"]
        }
      }' | python3 -m json.tool
    ;;
  *)
    curl -s -X POST "$BASE/api/review" \
      -H "Content-Type: application/json" \
      -d '{
        "type": "email_review",
        "sessionKey": "demo-key",
        "payload": {
          "inbox": [
            {
              "id": "e1",
              "from": "john@example.com",
              "subject": "Q1 Review Follow-up",
              "preview": "Hi, just wanted to follow up on our Q1 review discussion.",
              "category": "Work",
              "isRead": false,
              "timestamp": 1771747653333
            },
            {
              "id": "e2",
              "from": "mom@family.com",
              "subject": "Dinner this Sunday?",
              "preview": "Hey, are you free this Sunday for dinner? Dad wants to try that new place.",
              "category": "Personal",
              "isRead": false,
              "timestamp": 1771747600000
            },
            {
              "id": "e3",
              "from": "deals@newsletter.com",
              "subject": "50% off this weekend only!",
              "preview": "Do not miss our biggest sale of the year. Limited time offer.",
              "category": "ADS",
              "isRead": false,
              "timestamp": 1771747500000
            }
          ],
          "draft": {
            "replyTo": "e1",
            "to": "john@example.com",
            "subject": "Re: Q1 Review Follow-up",
            "ccSuggestions": [
              { "name": "Hanwen Wang", "email": "hanwen@company.com" }
            ],
            "intentionGuess": "Confirm the meeting and ask about agenda",
            "paragraphs": [
              { "id": "p1", "content": "Hi John, thanks for following up on the Q1 review." },
              { "id": "p2", "content": "I confirm we are aligned on the timeline discussed in our last meeting." },
              { "id": "p3", "content": "Please do not hesitate to reach out should you require any further clarification on the matter at hand." }
            ],
            "intentSuggestions": [
              { "id": "agree_timeline", "text": "Agree to finalize the roadmap by Friday" },
              { "id": "schedule_sync", "text": "Schedule a follow-up sync meeting" }
            ]
          }
        }
      }' | python3 -m json.tool
    ;;
esac
