import { Lead } from '../models/Lead.js';

// @desc    Get leads scheduled for calendar within date range
// @route   GET /api/v1/calendar
// @access  Private
export const getCalendarLeads = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      res.status(400);
      throw new Error('Please provide startDate and endDate query parameters');
    }

    const query = {
      followUpDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };

    // Access control: Staff members can only view their own followups
    if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.assignedTo = req.user._id;
    }

    const leads = await Lead.find(query)
      .select('name phone email status priority followUpDate')
      .sort({ followUpDate: 1 })
      .lean();

    res.status(200).json({
      status: 'success',
      results: leads.length,
      data: {
        events: leads,
      },
    });
  } catch (error) {
    next(error);
  }
};
