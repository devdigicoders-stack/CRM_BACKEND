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
      // Check if alert already exists for this lead
      const alertExists = await Notification.findOne({
        recipient: lead.assignedTo,
        lead: lead._id,
        type: 'missed_followup',
      });

      if (!alertExists) {
        // Create notification for assignee
        await Notification.create({
          title: '🚨 Missed Follow-up / Meeting',
          message: `You missed a scheduled follow-up for lead "${lead.name}" (${lead.phone}) scheduled on ${new Date(lead.followUpDate).toLocaleString()}`,
          recipient: lead.assignedTo,
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
    // 1) Dynamically check and generate alerts for missed followups before listing
    await generateMissedAlerts(req.user.id, req.user.role);

    // 2) Fetch user notifications, ordered by latest
    const notifications = await Notification.find({ recipient: req.user.id })
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
      { _id: req.params.id, recipient: req.user.id },
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
