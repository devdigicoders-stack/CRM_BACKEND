import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { Admin } from '../models/Admin.js';
import { notifyUser, notifyRoles, notifySuperAdminAndAdmins } from './notificationService.js';
import { Notification } from '../models/Notification.js';

let cronIntervals = [];

/**
 * 1. Check for upcoming follow-ups in the next 15 minutes
 */
const checkUpcomingFollowups = async () => {
  try {
    const now = new Date();
    const fifteenMinsLater = new Date(now.getTime() + 15 * 60 * 1000);

    // Find leads with followUpDate in [now, fifteenMinsLater]
    const upcomingLeads = await Lead.find({
      followUpDate: { $gte: now, $lte: fifteenMinsLater },
      status: { $nin: ['converted', 'closed', 'not_interested', 'lost', 'rejected'] },
      assignedTo: { $ne: null },
    }).select('_id name phone followUpDate assignedTo').lean();

    for (const lead of upcomingLeads) {
      // Check if we already sent a reminder for this lead in the last 30 mins
      const alreadySent = await Notification.findOne({
        lead: lead._id,
        recipient: lead.assignedTo,
        type: 'followup_reminder',
        createdAt: { $gte: new Date(now.getTime() - 30 * 60 * 1000) },
      });

      if (!alreadySent) {
        const timeStr = new Date(lead.followUpDate).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });

        await notifyUser(
          lead.assignedTo,
          '⏰ Upcoming Follow-Up (15 Mins)',
          `Reminder: "${lead.name}" (${lead.phone}) se ${timeStr} par follow-up call scheduled hai.`,
          lead._id,
          { followUpDate: lead.followUpDate },
          'followup_reminder'
        );
      }
    }
  } catch (err) {
    console.error('[CronService] Error in checkUpcomingFollowups:', err.message);
  }
};

/**
 * 2. Check for missed / overdue follow-ups
 */
const checkMissedFollowups = async () => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Follow-up was scheduled between 1h and 24h ago
    const overdueLeads = await Lead.find({
      followUpDate: { $gte: twentyFourHoursAgo, $lte: oneHourAgo },
      status: { $nin: ['converted', 'closed', 'not_interested', 'lost', 'rejected'] },
      assignedTo: { $ne: null },
    }).select('_id name phone followUpDate assignedTo branchId remarks').lean();

    for (const lead of overdueLeads) {
      // Check if remark was added after the followUpDate
      const hasRecentRemark = Array.isArray(lead.remarks) && lead.remarks.some(
        r => new Date(r.createdAt || r.date) >= new Date(lead.followUpDate)
      );

      if (!hasRecentRemark) {
        // Check if missed alert was already sent in last 12 hours
        const alreadyAlerted = await Notification.findOne({
          lead: lead._id,
          type: 'missed_followup',
          createdAt: { $gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
        });

        if (!alreadyAlerted) {
          // 1. Notify Salesperson
          await notifyUser(
            lead.assignedTo,
            '🚨 Missed Follow-Up Warning',
            `Overdue Follow-up: Lead "${lead.name}" (${lead.phone}) ka scheduled follow-up miss ho gaya hai. Kripya turant status update karein.`,
            lead._id,
            { followUpDate: lead.followUpDate },
            'missed_followup'
          );

          // 2. Notify SuperAdmin & Branch Manager
          await notifySuperAdminAndAdmins(
            '⚠️ Overdue Follow-Up Alert',
            `Lead "${lead.name}" ka follow-up overdue hai. Assigned staff ne abhi tak remark add nahi kiya.`,
            lead._id,
            { followUpDate: lead.followUpDate },
            'missed_followup'
          );
        }
      }
    }
  } catch (err) {
    console.error('[CronService] Error in checkMissedFollowups:', err.message);
  }
};

/**
 * 3. 24-Hour Inactive / Uncontacted Lead Warning (SLA)
 */
const checkInactiveLeads = async () => {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // Leads assigned > 24h ago with status still 'new' and no remarks
    const inactiveLeads = await Lead.find({
      status: 'new',
      assignedTo: { $ne: null },
      createdAt: { $gte: fortyEightHoursAgo, $lte: twentyFourHoursAgo },
      $or: [{ remarks: { $size: 0 } }, { remarks: { $exists: false } }],
    }).select('_id name phone assignedTo createdAt').lean();

    for (const lead of inactiveLeads) {
      const alreadyWarned = await Notification.findOne({
        lead: lead._id,
        type: 'lead_sla',
        createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      });

      if (!alreadyWarned) {
        // Alert salesperson
        await notifyUser(
          lead.assignedTo,
          '⏳ Inactive Lead Alert (SLA)',
          `Action Required: Lead "${lead.name}" (${lead.phone}) ko assign huye 24 ghante ho gaye hain, lekin koi call ya remark record nahi hua.`,
          lead._id,
          {},
          'lead_sla'
        );

        // Alert Admin
        await notifySuperAdminAndAdmins(
          '⏳ Uncontacted Lead SLA Warning',
          `Lead "${lead.name}" 24 ghante se uncontacted hai. Assigned staff ne koi activity nahi ki.`,
          lead._id,
          {},
          'lead_sla'
        );
      }
    }
  } catch (err) {
    console.error('[CronService] Error in checkInactiveLeads:', err.message);
  }
};

/**
 * 4. Daily Morning Summary (Runs at 9:00 AM)
 */
let lastMorningSummaryDate = null;
const checkDailyMorningSummary = async () => {
  try {
    const now = new Date();
    // Check if it is around 9:00 AM (e.g. hour == 9)
    const currentHour = now.getHours();
    const todayDateStr = now.toISOString().split('T')[0];

    if (currentHour === 9 && lastMorningSummaryDate !== todayDateStr) {
      lastMorningSummaryDate = todayDateStr;
      console.log('🌅 [CronService] Running Daily 9:00 AM Morning Follow-up Summary...');

      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      // Aggregate today's followups grouped by assignedTo
      const summary = await Lead.aggregate([
        {
          $match: {
            followUpDate: { $gte: startOfDay, $lte: endOfDay },
            status: { $nin: ['converted', 'closed', 'not_interested', 'lost', 'rejected'] },
            assignedTo: { $ne: null },
          },
        },
        {
          $group: {
            _id: '$assignedTo',
            count: { $sum: 1 },
          },
        },
      ]);

      for (const item of summary) {
        if (item._id && item.count > 0) {
          await notifyUser(
            item._id,
            '🌅 Daily Follow-Up Summary',
            `Good Morning! Aaj aapke schedule mein total ${item.count} follow-up call${item.count > 1 ? 's' : ''} lined up hain. Best of luck!`,
            null,
            { todayFollowupsCount: item.count },
            'daily_summary'
          );
        }
      }
    }
  } catch (err) {
    console.error('[CronService] Error in checkDailyMorningSummary:', err.message);
  }
};

/**
 * 5. Pending Balance Payment Reminder
 */
const checkPendingPaymentReminders = async () => {
  try {
    const now = new Date();
    // Leads converted or delivered with balance remaining
    const pendingBalanceLeads = await Lead.find({
      status: { $in: ['converted', 'won'] },
      dealValue: { $gt: 0 },
      $expr: { $gt: ['$dealValue', { $ifNull: ['$receivedAmount', 0] }] },
      updatedAt: { $lte: new Date(now.getTime() - 48 * 60 * 60 * 1000) }, // more than 2 days old
    }).select('_id name phone dealValue receivedAmount assignedTo').lean();

    for (const lead of pendingBalanceLeads.slice(0, 10)) {
      const balance = (lead.dealValue || 0) - (lead.receivedAmount || 0);
      const alreadySent = await Notification.findOne({
        lead: lead._id,
        type: 'payment_alert',
        createdAt: { $gte: new Date(now.getTime() - 72 * 60 * 60 * 1000) },
      });

      if (!alreadySent) {
        if (lead.assignedTo) {
          await notifyUser(
            lead.assignedTo,
            '💵 Pending Payment Reminder',
            `Lead "${lead.name}" ka balance amount ₹${balance.toLocaleString('en-IN')} pending hai. Kripya customer se follow-up karein.`,
            lead._id,
            { balanceAmount: balance },
            'payment_alert'
          );
        }

        // Also notify accountant team
        await notifyRoles(
          ['accountant', 'superAdmin'],
          '💵 Pending Payment Alert',
          `Lead "${lead.name}" par ₹${balance.toLocaleString('en-IN')} ka balance pending hai.`,
          lead._id,
          { balanceAmount: balance },
          'payment_alert'
        );
      }
    }
  } catch (err) {
    console.error('[CronService] Error in checkPendingPaymentReminders:', err.message);
  }
};

/**
 * Start all recurring Cron tasks
 */
export const startCronJobs = () => {
  console.log('⏰ [CronService] Initializing Background CRM Notification Jobs...');

  // 1. Upcoming follow-up check (Every 2 minutes)
  const interval15Min = setInterval(checkUpcomingFollowups, 2 * 60 * 1000);
  cronIntervals.push(interval15Min);

  // 2. Missed follow-up check (Every 15 minutes)
  const intervalMissed = setInterval(checkMissedFollowups, 15 * 60 * 1000);
  cronIntervals.push(intervalMissed);

  // 3. Inactive lead SLA check (Every 30 minutes)
  const intervalSLA = setInterval(checkInactiveLeads, 30 * 60 * 1000);
  cronIntervals.push(intervalSLA);

  // 4. Daily morning 9 AM summary check (Every 15 minutes)
  const intervalMorning = setInterval(checkDailyMorningSummary, 15 * 60 * 1000);
  cronIntervals.push(intervalMorning);

  // 5. Pending payment check (Every 4 hours)
  const intervalPayment = setInterval(checkPendingPaymentReminders, 4 * 60 * 60 * 1000);
  cronIntervals.push(intervalPayment);

  // Run immediately on boot after 10 seconds delay
  setTimeout(() => {
    checkUpcomingFollowups();
    checkMissedFollowups();
    checkInactiveLeads();
    checkDailyMorningSummary();
  }, 10000);

  console.log('✅ [CronService] 5 Background Notification Jobs running successfully.');
};

export const stopCronJobs = () => {
  cronIntervals.forEach(clearInterval);
  cronIntervals = [];
};
