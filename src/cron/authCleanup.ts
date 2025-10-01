import cron from 'node-cron';
import { AuthService } from '../services/authService.js';

// Job untuk membersihkan expired refresh tokens setiap hari jam 02:00
export function registerAuthCleanupJob() {
  console.log('[cron] registering auth cleanup job (daily at 02:00)');
  
  cron.schedule('0 2 * * *', async () => {
    console.log('[cron] running auth cleanup job - removing expired refresh tokens');
    
    try {
      await AuthService.cleanExpiredTokens();
      console.log('[cron] auth cleanup completed successfully');
    } catch (error) {
      console.error('[cron] auth cleanup failed:', error);
    }
  }, {
    timezone: 'Asia/Makassar' // Sesuaikan dengan timezone yang diinginkan
  });
}

export default { registerAuthCleanupJob };