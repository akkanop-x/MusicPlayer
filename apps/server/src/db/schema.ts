import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Schema ครบทุก table ตาม docs/database.md §2
 * กฎทั่วไป: UUID PK (gen_random_uuid), TIMESTAMPTZ ทุกที่, ทุก table มี created_at
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceName: varchar("source_name", { length: 50 }).notNull(),
    sourceIdentifier: varchar("source_identifier", { length: 500 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    artist: varchar("artist", { length: 500 }).notNull(),
    album: varchar("album", { length: 500 }),
    genres: text("genres")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    durationMs: integer("duration_ms").notNull(),
    isStream: boolean("is_stream").notNull().default(false),
    isSeekable: boolean("is_seekable").notNull().default(false),
    streamUrl: text("stream_url"),
    filePath: text("file_path"),
    contentType: varchar("content_type", { length: 100 }),
    artworkUrl: text("artwork_url"),
    isrc: varchar("isrc", { length: 15 }),
    lavalinkEncoded: text("lavalink_encoded"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tracks_source_uq").on(t.sourceName, t.sourceIdentifier),
    index("tracks_genres_idx").using("gin", t.genres),
    index("tracks_search_trgm_idx").using(
      "gin",
      sql`${t.title} gin_trgm_ops`,
      sql`${t.artist} gin_trgm_ops`,
    ),
  ],
);

export const playlists = pgTable(
  "playlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    coverUrl: text("cover_url"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("playlists_user_idx").on(t.userId),
    uniqueIndex("playlists_user_name_uq")
      .on(t.userId, t.name)
      .where(sql`is_deleted = false`),
  ],
);

export const playlistTracks = pgTable(
  "playlist_tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playlistId: uuid("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("playlist_tracks_position_uq").on(t.playlistId, t.position),
  ],
);

export const likedTracks = pgTable(
  "liked_tracks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    likedAt: timestamp("liked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.trackId] }),
    index("liked_tracks_user_liked_at_idx").on(t.userId, t.likedAt.desc()),
  ],
);

export const listeningHistory = pgTable(
  "listening_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "restrict" }),
    playedAt: timestamp("played_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    msPlayed: integer("ms_played").notNull(),
    completed: boolean("completed").notNull(),
    skipped: boolean("skipped").notNull(),
    contextType: varchar("context_type", { length: 20 }),
    contextId: uuid("context_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("listening_history_user_played_at_idx").on(t.userId, t.playedAt.desc()),
    index("listening_history_user_track_idx").on(t.userId, t.trackId),
  ],
);

export const eqPresets = pgTable(
  "eq_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    name: varchar("name", { length: 100 }).notNull(),
    bands: jsonb("bands").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("eq_presets_user_name_uq").on(t.userId, t.name)],
);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  volume: smallint("volume").notNull().default(80),
  muted: boolean("muted").notNull().default(false),
  autoplay: boolean("autoplay").notNull().default(true),
  repeatMode: varchar("repeat_mode", { length: 5 }).notNull().default("off"),
  shuffle: boolean("shuffle").notNull().default(false),
  activeEqPresetId: uuid("active_eq_preset_id").references(() => eqPresets.id, {
    onDelete: "set null",
  }),
  locale: varchar("locale", { length: 5 }).notNull().default("th"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const queueSnapshots = pgTable("queue_snapshots", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  currentTrackId: uuid("current_track").references(() => tracks.id),
  positionMs: integer("position_ms").notNull().default(0),
  shuffleOn: boolean("shuffle_on").notNull().default(false),
  repeatMode: varchar("repeat_mode", { length: 5 }).notNull().default("off"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const queueItems = pgTable(
  "queue_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 4 }).notNull(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    originalPosition: integer("original_position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("queue_items_position_uq").on(t.userId, t.kind, t.position),
  ],
);
