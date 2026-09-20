# MusicPlayer

Web Music Player ที่สตรีมเพลงจาก YouTube (เสียงจริง) โดยใช้ Spotify เป็นแหล่ง metadata/catalog สำหรับผู้ใช้ส่วนตัวกลุ่มเล็ก (1–5 คน)

## Language

### Playback

**Track**:
เพลงหนึ่งเพลงในระบบ อ้างด้วย `trackId` (UUID) — มี metadata อาจมาจาก source ใดก็ได้ แต่เสียงจริงมาจาก YouTube เสมอ
_Avoid_: ไฟล์เพลง, ไฟล์, Song

**Current Track**:
Track ที่กำลังเล่นอยู่ ณ ขณะนั้น — อยู่นอกทั้ง Upcoming Queue และ Playback History
_Avoid_: Now playing (ใช้เป็นชื่อหน้า UI เท่านั้น)

**Playback History**:
โครงสร้าง stack ชั่วคราวใน Queue ที่เก็บ track ที่เพิ่งเล่นไป — ใช้เพื่อปุ่ม Previous เท่านั้น (ไม่ใช่ log ถาวร)
_Avoid_: History (เปล่า ๆ — กำกวมกับ Listening History), Recent

**Listening History**:
Log ถาวรใน database ของทุกครั้งที่เล่นจริง (จบเพลงหรือเล่น ≥ 30 วินาที) — ใช้เพื่อหน้า History, Recommendation และ Radio
_Avoid_: History, Play log

**Upcoming Queue**:
รายการ track ที่จะเล่นต่อจาก Current Track เรียงจาก "ถัดไป" ไป "สุดท้าย"
_Avoid_: Queue (เปล่า ๆ — Queue หมายรวมทั้งระบบ), Playlist (Playlist คือ collection ที่บันทึกถาวร)

**Playlist**:
Collection ของ track ที่ผู้ใช้สร้างและบันทึกถาวร มีลำดับที่ผู้ใช้กำหนด — เมื่อ "เล่น playlist" จะถูกคัดลอกเข้า Upcoming Queue
_Avoid_: คลังเพลง, Library (Library คือรวมของ Liked + Playlists + History)

**Radio**:
โหมดเล่นต่อเนื่องไม่รู้จบที่ seed จาก track หนึ่ง โดยทุก track ต้องอยู่แนวเพลงเดียวกับ seed (genre constraint)
_Avoid_: Station

**Autoplay**:
การต่อ Upcoming Queue อัตโนมัติด้วย Recommendation เมื่อใกล้หมด — ไม่มี genre constraint แบบ Radio (ผ่อนคลายตาม recommendation.md)

**Skipped Track**:
Track ที่ผู้ใช้กดข้ามก่อนจบและเล่นได้ไม่ถึง 30 วินาที — โผล่ใน Listening History พร้อม tag skipped และถูกตีความเป็นสัญญาณเชิงลบโดย Recommendation
_Avoid_: ข้าม, Ignore

### Sources

**Source**:
แหล่งที่มาของ track โดยแบ่งบทบาทชัดเจน: **YouTube** คือแหล่งเสียงจริงเพียงแหล่งเดียว, **Spotify** คือแหล่ง metadata/catalog เท่านั้น (ไม่มีเสียง), **Local files** คือ fallback ที่ยังไม่ implement
_Avoid_: Provider

**Resolver**:
Service แยก container ที่แปลง trackId → stream URL อายุสั้นของ YouTube — สิ่งเดียวที่รู้จัก URL จริง
_Avoid_: Extractor, Downloader

**Genre**:
แนวเพลงของ track เก็บเป็น list ของ raw tags ที่ normalize แล้ว (มาจาก Spotify artist genres) — กติกา recommendation คือ candidate ต้องมี genre ตรงกับ seed อย่างน้อย 1 ตัว
_Avoid_: หมวดเพลง, Category

### User data

**Like**:
การกดหัวใจบันทึก track เข้ารายการโปรดของผู้ใช้ (ถาวร, sync ข้ามอุปกรณ์)
_Avoid_: Favorite, Bookmark

**Library**:
รวมทุกอย่าง "ของผู้ใช้": Liked tracks + Playlists + Listening History
_Avoid_: คลัง, Collection

**Preset**:
ชุดค่า EQ ครบ 10 bands — มี **System Preset** (แก้ไม่ได้, ใช้ร่วมกัน) และ **Custom Preset** (ของผู้ใช้คนเดียว)
_Avoid_: Profile, Setting
