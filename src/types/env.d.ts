export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: 'development' | 'production' | 'test';
      PORT?: string;
      MYSQL_HOST?: string;
      MYSQL_PORT?: string;
      MYSQL_USER?: string;
      MYSQL_PASSWORD?: string;
      MYSQL_DATABASE?: string;
      MYSQL_POOL_LIMIT?: string;
      REDIS_URL?: string;
      REDIS_HOST?: string;
      REDIS_PORT?: string;
      REDIS_PASSWORD?: string;
      VISITOR_SYNC_CRON?: string;
      VISITOR_SLOW_CRON?: string;
      VISITOR_SYNC_MIN_INTERVAL_MS?: string;
      VISITOR_SYNC_BUFFER_MS?: string;
      TODAY_COUNT_MODE?: 'direct' | 'incremental' | 'delta';
    }
  }
}
