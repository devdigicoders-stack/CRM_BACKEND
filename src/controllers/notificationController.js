import { Notification } from '../models/Notification.js';
import { Lead } from '../models/Lead.js';

// Helper to generate notifications for missed meetings / followups
export const generateMissedAlerts = async (userId, userRole) => {
  try {
    const now = new Date();
    const query = {
      followUpDate: { $lt: now },
      status: { $nin: ['converted', 'closed'] },
    };

    // If staff representative, only check their own leads. Otherwise, check all.
    if (!['superAdmin', 'admin'].includes(userRole)) {
      query.assignedTo = userId;
    } else {
      query.assignedTo = { $exists: true, $ne: null };
    }

    const missedLeads = await Lead.find(query).lean();

    for (const lead of missedLeads) {
      const recipientId = ['superAdmin', 'admin'].includes(userRole) ? userId : lead.assignedTo;

      if (!recipientId) continue;

      const alertExists = await Notification.findOne({
        recipient: recipientId,
        lead: lead._id,
        type: 'missed_followup',
      });

      if (!alertExists) {
        await Notification.create({
          title: '🚨 Missed Follow-up / Meeting',
          message: `Missed follow-up for lead "${lead.name}" (${lead.phone}) scheduled on ${new Date(lead.followUpDate).toISOString().split('T')[0]}`,
          recipient: recipientId,
          lead: lead._id,
          type: 'missed_followup',
        });
      }
    }
  } catch (error) {
    console.error('Error generating missed alerts:', error.message);
  }
};

// @desc    Get user notifications
// @route   GET /api/v1/notifications
// @access  Private
export const getNotifications = async (req, res, next) => {
  try {
    await generateMissedAlerts(req.user._id, req.user.role);

    const notifications = await Notification.find({ recipient: req.user._id })
      .populate('lead', 'name phone status')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      status: 'success',
      results: notifications.length,
      data: {
        notifications,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark a notification as read
// @route   PUT /api/v1/notifications/:id/read
// @access  Private
export const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { read: true },
      { new: true }
    );

    if (!notification) {
      res.status(404);
      throw new Error('Notification not found or access denied');
    }

    res.status(200).json({
      status: 'success',
      data: {
        notification,
      },
    });
  } catch (error) {
    next(error);
  }
};
