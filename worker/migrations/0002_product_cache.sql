-- 商品码查询缓存（公开商品信息，跨家庭共享，减少对上游免费额度的消耗）
CREATE TABLE product_cache (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL,          -- found | notFound
  data TEXT,                     -- ProductInfo JSON（found 时）
  fetched_at INTEGER NOT NULL
);
