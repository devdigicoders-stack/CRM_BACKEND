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
      .select('name phone email status priority followUpDate remarks')
      .sort({ followUpDate: 1 })
      .lean();

    const events = leads.map(lead => {
      let meetingNote = "";
      if (lead.remarks && lead.remarks.length > 0) {
        // Try to find the remark matching "[Meeting]"
        let meetingRemark = lead.remarks.find(r => r.note && r.note.startsWith("[Meeting]"));
        // Otherwise, use the latest remark
        if (!meetingRemark) {
          meetingRemark = lead.remarks[lead.remarks.length - 1];
        }
        meetingNote = meetingRemark.note;
      }
      delete lead.remarks; // clean payload
      return { ...lead, meetingNote };
    });

    res.status(200).json({
      status: 'success',
      results: events.length,
      data: {
        events: events,
      },
    });
  } catch (error) {
    next(error);
  }
};
