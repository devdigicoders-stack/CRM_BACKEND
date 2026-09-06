import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { Admin } from '../models/Admin.js';
import { sendPushNotification } from '../config/firebase.js';

/**
 * Send notification to a specific user or admin (DB Record + Push Notification)
 */
export const notifyUser = async (recipientId, title, message, leadId = null, metadata = {}, type = 'general') => {
  if (!recipientId) return;
  try {
    const payload = {
      title,
      message,
      recipient: recipientId,
      type,
      metadata: metadata || {},
    };
    if (leadId) payload.lead = leadId;

    const notif = await Notification.create(payload);

    // Look for recipient in User or Admin model
    let recipient = await User.findById(recipientId).select('fcmToken fcmTokens name').lean();
    if (!recipient) {
      recipient = await Admin.findById(recipientId).select('fcmToken fcmTokens name').lean();
    }

    if (recipient) {
      const tokens = [];
      if (recipient.fcmToken) tokens.push(recipient.fcmToken);
      if (Array.isArray(recipient.fcmTokens)) {
        recipient.fcmTokens.forEach(t => {
          if (t && !tokens.includes(t)) tokens.push(t);
        });
      }

      for (const token of tokens) {
        await sendPushNotification(token, title, message, {
          notificationId: notif._id.toString(),
          leadId: leadId ? leadId.toString() : '',
          type,
          ...metadata,
        });
      }
    }
    return notif;
  } catch (err) {
    console.error(`[NotificationService] Error notifying user ${recipientId}:`, err.message);
  }
};

/**
 * Send notification to all active users matching specific roles (or SuperAdmin/Admin)
 */
export const notifyRoles = async (roles = [], title, message, leadId = null, metadata = {}, type = 'general') => {
  try {
    const roleList = Array.isArray(roles) ? roles : [roles];
    const targetUserIds = new Set();

    // 1. Check Admins if roles include admin / superAdmin / branchManager
    const adminRoles = roleList.filter(r => ['superAdmin', 'admin', 'branchManager', 'all_admins'].includes(r));
    if (adminRoles.length > 0) {
      const query = { active: true };
      if (!adminRoles.includes('all_admins')) {
        query.role = { $in: adminRoles };
      }
      const admins = await Admin.find(query).select('_id').lean();
      admins.forEach(a => targetUserIds.add(a._id.toString()));
    }

    // 2. Check Staff Users (sales, calling, accountant, stock, installer, etc.)
    const userRoles = roleList.filter(r => !['superAdmin'].includes(r));
    if (userRoles.length > 0) {
      const query = { active: true };
      if (!userRoles.includes('all_admins')) {
        query.role = { $in: userRoles };
      }
      const users = await User.find(query).select('_id').lean();
      users.forEach(u => targetUserIds.add(u._id.toString()));
    }

    const promises = Array.from(targetUserIds).map(id => 
      notifyUser(id, title, message, leadId, metadata, type)
    );
    await Promise.allSettled(promises);
  } catch (err) {
    console.error('[NotificationService] Error notifying roles:', err.message);
  }
};

/**
 * Convenience helper to notify SuperAdmin & Admins
 */
export const notifySuperAdminAndAdmins = async (title, message, leadId = null, metadata = {}, type = 'general') => {
  return notifyRoles(['superAdmin', 'admin'], title, message, leadId, metadata, type);
};
