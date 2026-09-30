#!/data/data/com.termux/files/usr/bin/bash
# JARVIS phone agent (Android / Termux).
# Setup on the phone:
#   1) Install Termux + Termux:API from F-Droid
#   2) pkg install termux-api jq curl
#   3) Set JARVIS_URL to your laptop (Tailscale IP recommended) and TOKEN below
#   4) bash phone-agent-android.sh   (or add to Termux:Boot to autostart)
JARVIS_URL="${JARVIS_URL:-http://REPLACE_LAPTOP_IP:8799/phone}"
TOKEN="${PHONE_INGEST_TOKEN:-REPLACE_TOKEN}"
INTERVAL="${INTERVAL:-120}"
while true; do
  batt=$(termux-battery-status 2>/dev/null || echo null)
  notifs=$(termux-notification-list 2>/dev/null || echo '[]')
  loc=$(timeout 15 termux-location -p network 2>/dev/null || echo null)
  # flag anything that looks security-relevant as urgent (forwarded to Telegram)
  urgent=$(echo "$notifs" | jq -r '[.[]? | select((.title+" "+.content)|test("(?i)code|verify|login|sign.?in|otp|2fa|alert|bank"))] | (if length>0 then (.[0].title+": "+.[0].content) else empty end)' 2>/dev/null)
  payload=$(jq -n --argjson b "${batt:-null}" --argjson n "${notifs:-[]}" --argjson l "${loc:-null}" --arg u "${urgent:-}" \
    '{device:"android", battery:$b, notifications:$n, location:$l} + (if $u=="" then {} else {urgent:$u} end)' 2>/dev/null)
  curl -s -m 20 -X POST "$JARVIS_URL" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d "$payload" >/dev/null 2>&1
  sleep "$INTERVAL"
done
