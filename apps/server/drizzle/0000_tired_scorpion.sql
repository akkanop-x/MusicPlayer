-- pg_trgm สำหรับ GIN trigram index บน tracks(title, artist) — database.md §2.2
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "eq_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" varchar(100) NOT NULL,
	"bands" jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liked_tracks" (
	"user_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"liked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liked_tracks_user_id_track_id_pk" PRIMARY KEY("user_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "listening_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"played_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ms_played" integer NOT NULL,
	"completed" boolean NOT NULL,
	"skipped" boolean NOT NULL,
	"context_type" varchar(20),
	"context_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlist_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playlist_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"cover_url" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(4) NOT NULL,
	"track_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"original_position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_snapshots" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_track" uuid,
	"position_ms" integer DEFAULT 0 NOT NULL,
	"shuffle_on" boolean DEFAULT false NOT NULL,
	"repeat_mode" varchar(5) DEFAULT 'off' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_name" varchar(50) NOT NULL,
	"source_identifier" varchar(500) NOT NULL,
	"title" varchar(500) NOT NULL,
	"artist" varchar(500) NOT NULL,
	"album" varchar(500),
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"duration_ms" integer NOT NULL,
	"is_stream" boolean DEFAULT false NOT NULL,
	"is_seekable" boolean DEFAULT false NOT NULL,
	"stream_url" text,
	"file_path" text,
	"content_type" varchar(100),
	"artwork_url" text,
	"isrc" varchar(15),
	"lavalink_encoded" text,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"volume" smallint DEFAULT 80 NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"autoplay" boolean DEFAULT true NOT NULL,
	"repeat_mode" varchar(5) DEFAULT 'off' NOT NULL,
	"shuffle" boolean DEFAULT false NOT NULL,
	"active_eq_preset_id" uuid,
	"locale" varchar(5) DEFAULT 'th' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "eq_presets" ADD CONSTRAINT "eq_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liked_tracks" ADD CONSTRAINT "liked_tracks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liked_tracks" ADD CONSTRAINT "liked_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_history" ADD CONSTRAINT "listening_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_history" ADD CONSTRAINT "listening_history_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_snapshots" ADD CONSTRAINT "queue_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_snapshots" ADD CONSTRAINT "queue_snapshots_current_track_tracks_id_fk" FOREIGN KEY ("current_track") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_active_eq_preset_id_eq_presets_id_fk" FOREIGN KEY ("active_eq_preset_id") REFERENCES "public"."eq_presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eq_presets_user_name_uq" ON "eq_presets" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "liked_tracks_user_liked_at_idx" ON "liked_tracks" USING btree ("user_id","liked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "listening_history_user_played_at_idx" ON "listening_history" USING btree ("user_id","played_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "listening_history_user_track_idx" ON "listening_history" USING btree ("user_id","track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_tracks_position_uq" ON "playlist_tracks" USING btree ("playlist_id","position");--> statement-breakpoint
CREATE INDEX "playlists_user_idx" ON "playlists" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playlists_user_name_uq" ON "playlists" USING btree ("user_id","name") WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "queue_items_position_uq" ON "queue_items" USING btree ("user_id","kind","position");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_source_uq" ON "tracks" USING btree ("source_name","source_identifier");--> statement-breakpoint
CREATE INDEX "tracks_genres_idx" ON "tracks" USING gin ("genres");--> statement-breakpoint
CREATE INDEX "tracks_search_trgm_idx" ON "tracks" USING gin ("title" gin_trgm_ops,"artist" gin_trgm_ops);