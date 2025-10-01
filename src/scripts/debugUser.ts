import { initAuthSequelize } from '../db/authSequelize.js';
import { User } from '../models/SimpleUser.js';

(async () => {
  try {
    await initAuthSequelize();
    const user = await User.findOne({ where: { username: 'admin' } });
    if (!user) {
      console.log('User admin not found');
      process.exit(0);
    }
    const raw = user.toJSON();
    console.log('Admin row snapshot:', {
      id: raw.id,
      username: raw.username,
      password_hash_exists: !!raw.password_hash,
      password_hash_prefix: raw.password_hash ? String(raw.password_hash).slice(0, 15) : null,
      password_hash_length: raw.password_hash ? String(raw.password_hash).length : 0,
      access_token_null: raw.access_token == null,
      refresh_token_null: raw.refresh_token == null,
      token_expires_at: raw.token_expires_at
    });
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
})();