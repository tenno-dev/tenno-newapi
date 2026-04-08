-- Migration: 0001_push_subscriptions.sql
-- Adds tables for Web Push subscription management.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  lang TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS push_subscription_rootkeys (
  subscription_id TEXT NOT NULL,
  root_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (subscription_id, root_key)
);
