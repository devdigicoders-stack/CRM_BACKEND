import { Lead } from '../models/Lead.js';

// Helper to format lead response with helper integration links
const formatLeadWithIntegrations = (lead) => {
  const leadObj = lead.toObject ? lead.toObject() : lead;
  const cleanedPhone = leadObj.phone.replace(/\D/g, '');
  const phoneWithCountry = cleanedPhone.length === 10 ? `91${cleanedPhone}` : cleanedPhone;

  return {
    ...leadObj,
    integrations: {
      whatsappLink: `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(`Hello ${leadObj.name}, `)}`,
      callUri: `tel:${leadObj.phone}`,
    },
  };
};

// @desc    Get dashboard statistics overview
// @route   GET /api/v1/dashboard/stats
// @access  Private
export const getDashboardStats = async (req, res, next) => {
  try {
    const query = {};

    // If staff user, restrict metrics to their own leads
    if (req.user.role === 'crmuser') {
      query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
    } else if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.assignedTo = req.user._id;
    }

    const isAdmin = ['superAdmin', 'admin'].includes(req.user.role);

    // Dates for today
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    // 1) Total Leads Count
    const totalLeads = await Lead.countDocuments(query);

    // 2) Assigned Leads Count
    const assignedLeads = await Lead.countDocuments(
      isAdmin
        ? { assignedTo: { $exists: true, $ne: null } }
        : { assignedTo: req.user._id }
    );

    // 3) Today's Reminders Count
    const todayReminders = await Lead.countDocuments({
      ...query,
      followUpDate: { $gte: startOfToday, $lte: endOfToday },
    });

    // 4) Missed Follow-ups Count
    const missedFollowUps = await Lead.countDocuments({
      ...query,
      followUpDate: { $lt: startOfToday },
      status: { $nin: ['converted', 'closed'] },
    });

    // 5) Breakdown by status
    const statusBreakdown = await Lead.aggregate([
      { $match: query },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    // 6) Breakdown by priority
    const priorityBreakdown = await Lead.aggregate([
      { $match: query },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
    ]);

    // Format breakdown outputs
    const statsByStatus = {};
    ['new', 'assigned', 'interested', 'not_interested', 'converted', 'closed', 'call_done'].forEach((status) => {
      statsByStatus[status] = 0;
    });
    statusBreakdown.forEach((item) => {
      if (item._id) statsByStatus[item._id] = item.count;
    });

    const statsByPriority = { high: 0, medium: 0, low: 0 };
    priorityBreakdown.forEach((item) => {
      if (item._id) statsByPriority[item._id] = item.count;
    });

    // Lead Flow Monitoring (Calling Team vs Sales Panel vs Unassigned)
    let leadFlow = { callingTeam: 0, salesPanel: 0, unassigned: 0 };
    
    if (['superAdmin', 'admin'].includes(req.user.role)) {
      const flowData = await Lead.aggregate([
        {
          $lookup: {
            from: 'users',
            localField: 'assignedTo',
            foreignField: '_id',
            as: 'assignee'
          }
        },
        {
          $unwind: {
            path: '$assignee',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: {
              $cond: {
                if: { $ifNull: ['$assignee', false] },
                then: '$assignee.role',
                else: 'unassigned'
              }
            },
            count: { $sum: 1 }
          }
        }
      ]);

      flowData.forEach(item => {
        if (item._id === 'calling') {
          leadFlow.callingTeam = item.count;
        } else if (item._id === 'sales') {
          leadFlow.salesPanel = item.count;
        } else if (item._id === 'unassigned') {
          leadFlow.unassigned = item.count;
        }
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        totalLeads,
        assignedLeads,
        todayReminders,
        missedFollowUps,
        categories: {
          pending: (statsByStatus.new || 0) + (statsByStatus.assigned || 0) + (statsByStatus.interested || 0) + (statsByStatus.call_done || 0),
          closed: (statsByStatus.converted || 0) + (statsByStatus.closed || 0),
          negative: statsByStatus.not_interested || 0,
          missed: missedFollowUps,
        },
        leadFlow,
        breakdown: {
          byStatus: statsByStatus,
          byPriority: statsByPriority,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get list of today's reminders/followups
// @route   GET /api/v1/dashboard/reminders/today
// @access  Private
export const getTodayReminders = async (req, res, next) => {
  try {
    const query = {};

    if (req.user.role === 'crmuser') {
      query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
    } else if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.assignedTo = req.user._id;
    }

    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    query.followUpDate = {
      $gte: startOfToday,
      $lte: endOfToday,
    };

    console.log('DEBUG today reminders query:', JSON.stringify(query));
    console.log('DEBUG user:', req.user._id, req.user.role);
    console.log('DEBUG startOfToday:', startOfToday, 'endOfToday:', endOfToday);

    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email role')
      .sort({ followUpDate: 1 });

    console.log('DEBUG leads found:', leads.length);

    const formattedLeads = leads.map(formatLeadWithIntegrations);

    res.status(200).json({
      status: 'success',
      results: formattedLeads.length,
      data: {
        leads: formattedLeads,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get list of missed followups (overdue followUpDate)
// @route   GET /api/v1/dashboard/reminders/missed
// @access  Private
export const getMissedFollowUps = async (req, res, next) => {
  try {
    const query = {};

    if (req.user.role === 'crmuser') {
      query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
    } else if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.assignedTo = req.user._id;
    }

    const nowM = new Date();
    const startOfToday = new Date(Date.UTC(nowM.getUTCFullYear(), nowM.getUTCMonth(), nowM.getUTCDate(), 0, 0, 0, 0));

    query.followUpDate = { $lt: startOfToday };
    query.status = { $nin: ['converted', 'closed'] };

    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email role')
      .sort({ followUpDate: 1 });

    const formattedLeads = leads.map(formatLeadWithIntegrations);

    res.status(200).json({
      status: 'success',
      results: formattedLeads.length,
      data: {
        leads: formattedLeads,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get sales representative performance analytics
// @route   GET /api/v1/dashboard/performance
// @access  Private (Super Admin, Admin, and Manager only)
export const getPerformanceAnalytics = async (req, res, next) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const performance = await Lead.aggregate([
      {
        $group: {
          _id: '$assignedTo',
          totalLeads: { $sum: 1 },
          convertedLeads: {
            $sum: {
              $cond: [{ $in: ['$status', ['converted', 'closed']] }, 1, 0]
            }
          },
          missedFollowUps: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $lt: ['$followUpDate', startOfToday] },
                    { $not: [{ $in: ['$status', ['converted', 'closed']] }] }
                  ]
                },
                1,
                0
              ]
            }
          },
          remarksCount: { $sum: { $size: '$remarks' } }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          _id: 1,
          totalLeads: 1,
          convertedLeads: 1,
          missedFollowUps: 1,
          remarksCount: 1,
          conversionRate: {
            $cond: [
              { $gt: ['$totalLeads', 0] },
              { $multiply: [{ $divide: ['$convertedLeads', '$totalLeads'] }, 100] },
              0
            ]
          },
          user: {
            name: 1,
            email: 1,
            role: 1
          }
        }
      },
      {
        $sort: { conversionRate: -1 }
      }
    ]);

    // Call Activity tracking (number of calls/remarks made by each team member)
    const callActivity = await Lead.aggregate([
      { $unwind: '$remarks' },
      {
        $group: {
          _id: '$remarks.addedBy',
          callsCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDoc'
        }
      },
      {
        $lookup: {
          from: 'admins',
          localField: '_id',
          foreignField: '_id',
          as: 'adminDoc'
        }
      },
      {
        $project: {
          _id: 1,
          callsCount: 1,
          user: {
            $cond: {
              if: { $gt: [{ $size: '$userDoc' }, 0] },
              then: { $arrayElemAt: ['$userDoc', 0] },
              else: { $arrayElemAt: ['$adminDoc', 0] }
            }
          }
        }
      },
      {
        $project: {
          _id: 1,
          callsCount: 1,
          'user.name': 1,
          'user.email': 1,
          'user.role': 1
        }
      },
      {
        $sort: { callsCount: -1 }
      }
    ]);

    res.status(200).json({
      status: 'success',
      results: performance.length,
      data: {
        performance,
        callActivity
      }
    });
  } catch (error) {
    next(error);
  }
};
