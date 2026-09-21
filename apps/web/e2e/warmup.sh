#!/usr/bin/env bash
# Warm-up ก่อน E2E (ใช้ใน CI): สมัคร account ชั่วคราว → search → play → ดึง stream
# ชิ้นแรก — บังคับ resolve cache ของ track แรกให้พร้อม เพื่อไม่ให้ J1 ไปเจอ cold resolve
# ที่ช้ากว่า 20 s บน GitHub runner (YouTube มัก throttle datacenter IP)
set -euo pipefail
BASE="${BASE:-http://localhost:8080}"
EMAIL="warmup-$(date +%s)@warmup.test"

AUTH=$(curl -sf -c /tmp/jar.txt -X POST "$BASE/api/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"warmup-password-123\",\"displayName\":\"Warmup\"}")
TOKEN=$(echo "$AUTH" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

TRACK=$(curl -sf "$BASE/api/v1/search?q=daft%20punk" \
  -H "authorization: Bearer $TOKEN" \
  | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

curl -sf -X POST "$BASE/api/v1/player/play" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"trackId\":\"$TRACK\"}" > /dev/null

# ดึง stream ชิ้นแรก (cookie auth — security.md §8.6) เพื่อ trigger resolve
curl -sf -b /tmp/jar.txt -r 0-1024 "$BASE/api/v1/stream/$TRACK" > /dev/null || true
echo "warmup done (track $TRACK resolved)"
