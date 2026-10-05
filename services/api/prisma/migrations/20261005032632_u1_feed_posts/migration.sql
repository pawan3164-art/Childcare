-- CreateTable
CREATE TABLE "feed_posts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "room_id" TEXT,
    "author_user_id" TEXT NOT NULL,
    "caption" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_post_media" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "feed_post_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feed_posts_org_id_idx" ON "feed_posts"("org_id");

-- CreateIndex
CREATE INDEX "feed_posts_centre_id_created_at_idx" ON "feed_posts"("centre_id", "created_at");

-- CreateIndex
CREATE INDEX "feed_post_media_org_id_idx" ON "feed_post_media"("org_id");

-- CreateIndex
CREATE INDEX "feed_post_media_media_asset_id_idx" ON "feed_post_media"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "feed_post_media_post_id_media_asset_id_key" ON "feed_post_media"("post_id", "media_asset_id");

-- AddForeignKey
ALTER TABLE "feed_post_media" ADD CONSTRAINT "feed_post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "feed_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation, same pattern as earlier stages. Posts are immutable for
-- the app role (no UPDATE/DELETE grants); corrections are new posts.
GRANT SELECT, INSERT ON feed_posts TO childcare_app;
GRANT SELECT, INSERT ON feed_post_media TO childcare_app;
ALTER TABLE feed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_posts FORCE ROW LEVEL SECURITY;
ALTER TABLE feed_post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_post_media FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_feed_posts ON feed_posts
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_feed_post_media ON feed_post_media
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
