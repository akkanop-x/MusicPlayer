#!/usr/bin/env bash
# Warm-up ก่อน E2E (ใช้ใน CI): สมัคร account ชั่วคราว → search → play → ดึง stream
# ชิ้นแรก — บังคับ resolve cache ของ track แรกให้พร้อม เพื่อไม่ให้ J1 ไปเจอ cold resolve
# ที่ช้ากว่า 20 s บน GitHub runner (YouTube มัก throttle datacenter IP)
# ไม่ hard-fail เมื่อยังไม่พร้อม — E2E เองมี retry; warm-up เป็นตัวช่วยเท่านั้น
BASE="${BASE:-http://localhost:8080}"
EMAIL="warmup-$(date +%s)@warmup.test"

AUTH=$(curl -s -c /tmp/jar.txt -X POST "$BASE/api/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"warmup-password-123\",\"displayName\":\"Warmup\"}")
TOKEN=$(echo "$AUTH" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

# Lavalink ต้องร้องพร้อมก่อน search จะสำเร็จ — ลองสูงสุด ~90 s
TRACK=""
for _ in $(seq 1 30); do
  TRACK=$(curl -s "$BASE/api/v1/search?q=daft%20punk" \
    -H "authorization: Bearer $TOKEN" \
    | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4 || true)
  [ -n "$TRACK" ] && break
  sleep 3
done

if [ -z "$TRACK" ]; then
  echo "WARN: search ยังไม่สำเร็จ — ข้าม warm-up (E2E จะ retry เอง)"
  exit 0
fi

curl -s -X POST "$BASE/api/v1/player/play" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"trackId\":\"$TRACK\"}" > /dev/null || true

# ดึง stream ชิ้นแรก (cookie auth — security.md §8.6) เพื่อ trigger resolve
curl -s -b /tmp/jar.txt -r 0-1024 "$BASE/api/v1/stream/$TRACK" > /dev/null || true
echo "warmup done (track $TRACK resolved)"
