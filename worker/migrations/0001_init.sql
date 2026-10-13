-- 有归 云同步：家庭、通用记录表（按 kind 区分）、版本计数器、文件账本
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE counters (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  ver INTEGER NOT NULL DEFAULT 0
);

-- data 为客户端记录 JSON；ver 为家庭内单调递增的服务端版本，用作拉取游标与乐观并发
CREATE TABLE records (
  household_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  ver INTEGER NOT NULL,
  PRIMARY KEY (household_id, kind, id)
);
CREATE INDEX records_by_ver ON records (household_id, ver);

-- R2 对象账本：配额统计与孤儿清理
CREATE TABLE files (
  household_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, attachment_id)
);
