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
      $and: [
        {
          $or: [
            {
              followUpDate: {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
              }
            },
            {
              'remarks.followUpDate': {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
              }
            }
          ]
        }
      ]
    };

    // Access control
    if (req.user.role === 'branchManager') {
      const { getBranchUserIds } = await import('../utils/branchHelper.js');
      const branchUserIds = await getBranchUserIds(req.user._id);
      query.$and.push({
        $or: [
          { assignedTo: { $in: branchUserIds } },
          { createdBy: { $in: branchUserIds } }
        ]
      });
    } else if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.$and.push({ assignedTo: req.user._id });
    }

    const leads = await Lead.find(query)
      .select('name phone email status priority followUpDate remarks createdBy createdByModel assignedTo assignedToModel')
      .populate('createdBy', 'name')
      .populate('assignedTo', 'name')
      .sort({ followUpDate: 1 })
      .lean();

    const events = [];
    leads.forEach(lead => {
      const datesAdded = new Set();
      const addEvent = (dateObj, note, isHistorical) => {
        if (!dateObj) return;
        const dStr = new Date(dateObj).toISOString();
        if (datesAdded.has(dStr)) return;
        datesAdded.add(dStr);
        events.push({
          ...lead,
          followUpDate: dateObj,
          meetingNote: note || '',
          status: isHistorical ? 'Meeting Done / Follow-up Completed' : lead.status,
          remarks: undefined,
        });
      };

      if (lead.remarks && lead.remarks.length > 0) {
        lead.remarks.forEach(r => {
          if (r.followUpDate) {
            const rDate = new Date(r.followUpDate);
            if (rDate >= new Date(startDate) && rDate <= new Date(endDate)) {
              const isHistorical = lead.followUpDate && new Date(lead.followUpDate).getTime() !== rDate.getTime();
              let statusText = r.note || '';
              addEvent(r.followUpDate, statusText, isHistorical);
            }
          }
        });
      }

      if (lead.followUpDate) {
        const mDate = new Date(lead.followUpDate);
        if (mDate >= new Date(startDate) && mDate <= new Date(endDate)) {
          let meetingNote = "";
          if (lead.remarks && lead.remarks.length > 0) {
            let meetingRemark = lead.remarks.find(r => r.note && r.note.startsWith("[Meeting]"));
            if (!meetingRemark) meetingRemark = lead.remarks[lead.remarks.length - 1];
            meetingNote = meetingRemark.note;
          }
          addEvent(lead.followUpDate, meetingNote, false);
        }
      }
    });

    // Sort events correctly
    events.sort((a, b) => new Date(a.followUpDate) - new Date(b.followUpDate));

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

// @desc    Get leads scheduled for visit/demo within date range
// @route   GET /api/v1/calendar/visits
// @access  Private
export const getVisitsCalendar = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      res.status(400);
      throw new Error('Please provide startDate and endDate query parameters');
    }

    const query = {
      visitDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };

    // Access control: Staff members can only view their own visits
    if (req.user.role === 'branchManager') {
      const { getBranchUserIds } = await import('../utils/branchHelper.js');
      const branchUserIds = await getBranchUserIds(req.user._id);
      query.$or = [
        { assignedTo: { $in: branchUserIds } },
        { createdBy: { $in: branchUserIds } }
      ];
    } else if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.assignedTo = req.user._id;
    }

    const leads = await Lead.find(query)
      .select('name phone email status priority visitDate remarks createdBy createdByModel assignedTo assignedToModel')
      .populate('createdBy', 'name')
      .populate('assignedTo', 'name')
      .sort({ visitDate: 1 })
      .lean();

    const events = leads.map(lead => {
      let visitNote = "";
      if (lead.remarks && lead.remarks.length > 0) {
        // Try to find the remark matching "[Visit]"
        let visitRemark = lead.remarks.find(r => r.note && r.note.startsWith("[Visit]"));
        // Otherwise, use the latest remark
        if (!visitRemark) {
          visitRemark = lead.remarks[lead.remarks.length - 1];
        }
        visitNote = visitRemark.note;
      }
      delete lead.remarks; // clean payload
      return { ...lead, visitNote };
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
