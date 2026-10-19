import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { Admin } from '../models/Admin.js';
import { getSalesRevenueMetrics, getApprovedSalesLeads } from '../utils/salesMetricsHelper.js';

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
    if (req.user.role === 'branchManager') {
      const { getBranchUserIds } = await import('../utils/branchHelper.js');
      const branchUserIds = await getBranchUserIds(req.user._id);
      query.$or = [
        { assignedTo: { $in: branchUserIds } },
        { createdBy: { $in: branchUserIds } }
      ];
    } else if (['calling', 'telecaller'].includes(req.user.role)) {
      query.$or = [
        { assignedTo: req.user._id },
        { createdBy: req.user._id },
        { originTelecaller: req.user._id },
        { 'remarks.addedBy': req.user._id }
      ];
    } else if (!['superAdmin', 'admin', 'crmuser'].includes(req.user.role)) {
      query.assignedTo = req.user._id;
    }

    const isAdmin = ['superAdmin', 'admin', 'crmuser', 'branchManager'].includes(req.user.role);

    // Dates for today
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    const { date } = req.query;

    if (date) {
      // Date format is expected to be YYYY-MM-DD
      const filterDateStart = new Date(date);
      filterDateStart.setUTCHours(0, 0, 0, 0);
      
      const filterDateEnd = new Date(date);
      filterDateEnd.setUTCHours(23, 59, 59, 999);
      
      query.createdAt = { $gte: filterDateStart, $lte: filterDateEnd };
    }

    // 1) Total Leads Count
    const totalLeads = await Lead.countDocuments(query);

    // 2) Assigned Leads Count
    const assignedLeadsQuery = { ...query };
    if (isAdmin) {
      assignedLeadsQuery.assignedTo = { $exists: true, $ne: null };
    } else {
      assignedLeadsQuery.assignedTo = req.user._id;
    }
    const assignedLeads = await Lead.countDocuments(assignedLeadsQuery);

    // 3) Today's Reminders Count
    const todayReminders = await Lead.countDocuments({
      ...query,
      followUpDate: { $gte: startOfToday, $lte: endOfToday },
    });

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 4) Missed Follow-ups Count
    const missedFollowUps = await Lead.countDocuments({
      ...query,
      followUpDate: { $lt: oneDayAgo },
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

    // Lead Flow Monitoring (Calling Team vs Sales Panel vs Branch/Admin vs Unassigned)
    let leadFlow = { callingTeam: 0, salesPanel: 0, branchTeam: 0, unassigned: 0 };
    
    const flowData = await Lead.aggregate([
      { $match: query },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedTo',
          foreignField: '_id',
          as: 'assigneeUser'
        }
      },
      {
        $lookup: {
          from: 'admins',
          localField: 'assignedTo',
          foreignField: '_id',
          as: 'assigneeAdmin'
        }
      },
      {
        $project: {
          assignedTo: 1,
          assignee: {
            $concatArrays: ['$assigneeUser', '$assigneeAdmin']
          }
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
              if: { $and: [{ $ifNull: ['$assignedTo', false] }, { $ne: ['$assignedTo', ''] }, { $ifNull: ['$assignee', false] }] },
              then: '$assignee.role',
              else: 'unassigned'
            }
          },
          count: { $sum: 1 }
        }
      }
    ]);

    flowData.forEach(item => {
      if (item._id === 'calling' || item._id === 'crmuser') {
        leadFlow.callingTeam += item.count;
      } else if (item._id === 'sales') {
        leadFlow.salesPanel += item.count;
      } else if (['branchManager', 'admin', 'superAdmin', 'branch'].includes(item._id)) {
        leadFlow.branchTeam += item.count;
      } else {
        leadFlow.unassigned += item.count;
      }
    });

    // Real-time sales count & revenue (counted after accounts verification & super admin approval)
    let salesScopeQuery = {};
    if (req.user.role === 'branchManager') {
      const { getBranchUserIds } = await import('../utils/branchHelper.js');
      const branchUserIds = await getBranchUserIds(req.user._id);
      salesScopeQuery.$or = [
        { assignedTo: { $in: branchUserIds } },
        { createdBy: { $in: branchUserIds } }
      ];
    }
    const salesRevenue = await getSalesRevenueMetrics({
      scopeQuery: salesScopeQuery,
      date: date || null
    });

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
        salesRevenue,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get detailed real-time sales & revenue analytics (day-wise and month-wise)
// @route   GET /api/v1/dashboard/sales-revenue
// @access  Private (Super Admin, Admin, Accountant, BranchManager)
export const getSalesRevenueAnalytics = async (req, res, next) => {
  try {
    const { date, startDate, endDate, month, search, page, limit, details } = req.query;

    let scopeQuery = {};
    if (req.user.role === 'branchManager') {
      const { getBranchUserIds } = await import('../utils/branchHelper.js');
      const branchUserIds = await getBranchUserIds(req.user._id);
      scopeQuery.$or = [
        { assignedTo: { $in: branchUserIds } },
        { createdBy: { $in: branchUserIds } }
      ];
    }

    const metrics = await getSalesRevenueMetrics({
      scopeQuery,
      date: date || null,
      startDate: startDate || null,
      endDate: endDate || null
    });

    let leadDetails = null;
    if (details === 'true' || date || month) {
      leadDetails = await getApprovedSalesLeads({
        scopeQuery,
        date: date || null,
        month: month || null,
        search: search || '',
        page: page || 1,
        limit: limit || 20
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        metrics,
        leads: leadDetails
      }
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
    } else if (req.user.role === 'branchManager') {
      const { getBranchUserIds } = await import('../utils/branchHelper.js');
      const branchUserIds = await getBranchUserIds(req.user._id);
      query.$or = [
        { assignedTo: { $in: branchUserIds } },
        { createdBy: { $in: branchUserIds } }
      ];
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
    } else if (req.user.role === 'branchManager') {
      const { getBranchUserIds } = await import('../utils/branchHelper.js');
      const branchUserIds = await getBranchUserIds(req.user._id);
      query.$or = [
        { assignedTo: { $in: branchUserIds } },
        { createdBy: { $in: branchUserIds } }
      ];
    } else if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.assignedTo = req.user._id;
    }

    const nowM = new Date();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    query.followUpDate = { $lt: oneDayAgo };
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

    const matchStage = {};
    if (req.user.role === 'branchManager') {
      const { getBranchUserIds } = await import('../utils/branchHelper.js');
      const branchUserIds = await getBranchUserIds(req.user._id);
      matchStage.assignedTo = { $in: branchUserIds };
    }
    if (req.query.startDate && req.query.endDate) {
      const endOfDay = new Date(req.query.endDate);
      endOfDay.setHours(23, 59, 59, 999);
      
      matchStage.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: endOfDay
      };
    }

    const performance = await Lead.aggregate([
      { $match: matchStage },
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
      { $match: matchStage },
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

// @desc    Get lead assignment report (date-wise and assignee-wise)
// @route   GET /api/v1/dashboard/report
// @access  Private (Super Admin, Admin, Manager, CRM User)
export const getLeadAssignmentReport = async (req, res, next) => {
  try {
    const query = {};

    if (req.user.role === 'crmuser') {
      query.$or = [
        { createdBy: req.user._id },
        { assignedTo: req.user._id },
        { assignedBy: req.user._id }
      ];
    } else if (req.user.role === 'branchManager') {
      const { getBranchUserIds } = await import('../utils/branchHelper.js');
      const branchUserIds = await getBranchUserIds(req.user._id);
      query.$or = [
        { assignedTo: { $in: branchUserIds } },
        { createdBy: { $in: branchUserIds } }
      ];
    } else if (!['superAdmin', 'admin'].includes(req.user.role)) {
      query.assignedTo = req.user._id;
    }

    if (req.query.startDate && req.query.endDate) {
      const endOfDay = new Date(req.query.endDate);
      endOfDay.setHours(23, 59, 59, 999);
      const startOfDay = new Date(req.query.startDate);
      startOfDay.setHours(0, 0, 0, 0);

      const dateCondition = {
        $or: [
          { createdAt: { $gte: startOfDay, $lte: endOfDay } },
          { assignedAt: { $gte: startOfDay, $lte: endOfDay } }
        ]
      };

      if (query.$or) {
        query.$and = [
          { $or: query.$or },
          dateCondition
        ];
        delete query.$or;
      } else {
        query.$or = dateCondition.$or;
      }
    }

    // Overall summary metrics across the matching query
    const [totalMatching, totalAssigned, totalUnassigned, pendingCalls, callsDone] = await Promise.all([
      Lead.countDocuments(query),
      Lead.countDocuments({ ...query, assignedTo: { $ne: null } }),
      Lead.countDocuments({ ...query, assignedTo: null }),
      Lead.countDocuments({ ...query, isCallDone: false, assignedTo: { $ne: null } }),
      Lead.countDocuments({ ...query, isCallDone: true, assignedTo: { $ne: null } }),
    ]);

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: query },
      {
        $group: {
          _id: {
            assignee: "$assignedTo"
          },
          count: { $sum: 1 },
          callsDone: { $sum: { $cond: [{ $eq: ["$isCallDone", true] }, 1, 0] } },
          pendingCalls: { $sum: { $cond: [{ $eq: ["$isCallDone", false] }, 1, 0] } }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id.assignee',
          foreignField: '_id',
          as: 'assigneeDoc'
        }
      },
      {
        $unwind: {
          path: '$assigneeDoc',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          _id: 0,
          assigneeId: '$_id.assignee',
          assignee: {
            $cond: {
              if: { $ifNull: ['$assigneeDoc', false] },
              then: '$assigneeDoc.name',
              else: 'Unassigned'
            }
          },
          assigneeRole: {
            $cond: {
              if: { $ifNull: ['$assigneeDoc', false] },
              then: '$assigneeDoc.role',
              else: 'N/A'
            }
          },
          leadsAssigned: '$count',
          callsDone: 1,
          pendingCalls: 1
        }
      },
      {
        $sort: { leadsAssigned: -1 }
      },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }]
        }
      }
    ];

    const reportAgg = await Lead.aggregate(pipeline);
    const reportData = reportAgg[0].data;
    const total = reportAgg[0].metadata[0] ? reportAgg[0].metadata[0].total : 0;
    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      status: 'success',
      results: reportData.length,
      pagination: {
        page,
        limit,
        total,
        totalPages
      },
      summary: {
        totalLeads: totalMatching,
        assignedCount: totalAssigned,
        unassignedCount: totalUnassigned,
        pendingCallsCount: pendingCalls,
        callsDoneCount: callsDone,
      },
      data: {
        report: reportData
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get telecaller performance statistics for telecaller's own dashboard
// @route   GET /api/v1/dashboard/telecaller-performance
// @access  Private (calling, telecaller, superAdmin, admin)
export const getTelecallerMyStats = async (req, res, next) => {
  try {
    const { timeframe = 'today', startDate, endDate, telecallerId } = req.query;

    let targetUserId = req.user._id;
    if (['superAdmin', 'admin'].includes(req.user.role) && telecallerId) {
      targetUserId = telecallerId;
    }

    const targetUser = await User.findById(targetUserId).select('name email role phone').lean();
    const telecallerName = targetUser?.name || req.user.name || 'Telecaller';

    const now = new Date();
    let dateFilter = null;

    if (startDate || endDate) {
      dateFilter = {};
      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        dateFilter.$gte = s;
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        dateFilter.$lte = e;
      }
    } else if (timeframe === 'today') {
      const s = new Date(now);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      dateFilter = { $gte: s, $lte: e };
    } else if (timeframe === 'yesterday') {
      const s = new Date(now);
      s.setDate(s.getDate() - 1);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setDate(e.getDate() - 1);
      e.setHours(23, 59, 59, 999);
      dateFilter = { $gte: s, $lte: e };
    } else if (timeframe === 'thisWeek') {
      const s = new Date(now);
      s.setDate(now.getDate() - now.getDay());
      s.setHours(0, 0, 0, 0);
      dateFilter = { $gte: s };
    } else if (timeframe === 'thisMonth') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      s.setHours(0, 0, 0, 0);
      dateFilter = { $gte: s };
    }

    // Identify CRM users & Admins (to count leads assigned by CRM User / SuperAdmin)
    const crmUsersList = await User.find({ role: 'crmuser' }).select('_id').lean();
    const adminsList = await Admin.find({}).select('_id').lean();
    const crmAndAdminIds = [...crmUsersList.map(u => u._id), ...adminsList.map(a => a._id)];

    // 1. Total Leads Assigned / Received
    const allTimeAssignedQuery = {
      $or: [
        { assignedTo: targetUserId },
        { originTelecaller: targetUserId }
      ]
    };
    const allTimeLeadsReceived = await Lead.countDocuments(allTimeAssignedQuery);

    let assignedQuery = allTimeAssignedQuery;
    if (dateFilter) {
      assignedQuery = {
        $and: [
          allTimeAssignedQuery,
          {
            $or: [
              { assignedAt: dateFilter },
              { createdAt: dateFilter },
              { reassignedAt: dateFilter }
            ]
          }
        ]
      };
    }
    const totalLeadsReceived = await Lead.countDocuments(assignedQuery);

    // 1b. Total leads assigned by CRM User or SuperAdmin
    const crmAssignCondition = {
      $or: [
        { assignedBy: { $in: crmAndAdminIds } },
        { createdBy: { $in: crmAndAdminIds } }
      ]
    };
    const allTimeAssignedByCrmOrAdmin = await Lead.countDocuments({
      $and: [
        allTimeAssignedQuery,
        crmAssignCondition
      ]
    });
    const totalAssignedByCrmOrAdmin = dateFilter
      ? await Lead.countDocuments({
          $and: [
            assignedQuery,
            crmAssignCondition
          ]
        })
      : allTimeAssignedByCrmOrAdmin;

    // 2. Total Calls Completed (remarks added by this user in date range)
    const callsCountAgg = await Lead.aggregate([
      { $match: { 'remarks.addedBy': targetUserId } },
      { $unwind: '$remarks' },
      {
        $match: {
          'remarks.addedBy': targetUserId,
          ...(dateFilter ? { 'remarks.createdAt': dateFilter } : {})
        }
      },
      { $count: 'total' }
    ]);
    const totalCallsCompleted = callsCountAgg[0]?.total || 0;

    const allTimeCallsAgg = await Lead.aggregate([
      { $match: { 'remarks.addedBy': targetUserId } },
      { $unwind: '$remarks' },
      { $match: { 'remarks.addedBy': targetUserId } },
      { $count: 'total' }
    ]);
    const allTimeCallsCompleted = allTimeCallsAgg[0]?.total || 0;

    // 3. Pending Calls (Present & Past Backlog)
    // All active leads currently assigned to telecaller with isCallDone == false
    const pendingBaseFilter = {
      assignedTo: targetUserId,
      isCallDone: false,
      status: { $nin: ['converted', 'closed', 'not_interested', 'invalid_number', 'disqualified'] }
    };
    const totalPendingCalls = await Lead.countDocuments(pendingBaseFilter);

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const pendingCallsToday = await Lead.countDocuments({
      ...pendingBaseFilter,
      $or: [
        { createdAt: { $gte: startOfToday, $lte: endOfToday } },
        { assignedAt: { $gte: startOfToday, $lte: endOfToday } }
      ]
    });
    const pendingCallsPast = Math.max(0, totalPendingCalls - pendingCallsToday);

    // 4. Callbacks / Reminders scheduled
    const followUpDateRange = dateFilter || { $gte: startOfToday, $lte: endOfToday };
    const totalCallbacks = await Lead.countDocuments({
      $or: [
        { assignedTo: targetUserId },
        { originTelecaller: targetUserId }
      ],
      followUpDate: followUpDateRange,
      status: { $nin: ['converted', 'closed'] }
    });

    // 5. Total Leads Handed Over to Sales
    const baseHandoverCondition = {
      $or: [
        { originTelecaller: targetUserId },
        { assignedTo: targetUserId }
      ],
      $and: [
        {
          $or: [
            { status: 'assigned_to_branch' },
            { assignedBranch: { $ne: null } },
            { branchOwner: { $ne: null } }
          ]
        }
      ]
    };
    const allTimeHandedOver = await Lead.countDocuments(baseHandoverCondition);

    let handoverQuery = baseHandoverCondition;
    if (dateFilter) {
      handoverQuery = {
        ...baseHandoverCondition,
        $and: [
          ...baseHandoverCondition.$and,
          {
            $or: [
              { updatedAt: dateFilter },
              { 'remarks.createdAt': dateFilter }
            ]
          }
        ]
      };
    }
    const totalHandedOver = await Lead.countDocuments(handoverQuery);

    // 6. Remaining Leads for Follow-up (active non-closed leads with a future follow-up or pending)
    const remainingFollowups = await Lead.countDocuments({
      assignedTo: targetUserId,
      status: { $nin: ['converted', 'closed', 'disqualified', 'not_interested'] }
    });

    // 7. Dynamic 7-day activity trend
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyActivity = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayName = daysOfWeek[d.getDay()];
      const dayStart = new Date(d);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);
      const dayDateFilter = { $gte: dayStart, $lte: dayEnd };

      const dayCallsAgg = await Lead.aggregate([
        { $match: { 'remarks.addedBy': targetUserId } },
        { $unwind: '$remarks' },
        {
          $match: {
            'remarks.addedBy': targetUserId,
            'remarks.createdAt': dayDateFilter
          }
        },
        { $count: 'count' }
      ]);
      const dayCalls = dayCallsAgg[0]?.count || 0;

      const dayReceived = await Lead.countDocuments({
        $or: [
          { assignedTo: targetUserId, assignedAt: dayDateFilter },
          { assignedTo: targetUserId, createdAt: dayDateFilter },
          { originTelecaller: targetUserId, createdAt: dayDateFilter }
        ]
      });

      const dayHandovers = await Lead.countDocuments({
        $or: [{ originTelecaller: targetUserId }, { assignedTo: targetUserId }],
        $and: [
          { $or: [{ status: 'assigned_to_branch' }, { assignedBranch: { $ne: null } }] },
          { updatedAt: dayDateFilter }
        ]
      });

      dailyActivity.push({
        day: dayName,
        date: dayStart.toISOString().split('T')[0],
        calls: dayCalls,
        received: dayReceived,
        handedOver: dayHandovers,
      });
    }

    const effectiveAssigned = totalLeadsReceived > 0 ? totalLeadsReceived : allTimeLeadsReceived;
    const effectiveHandedOver = totalHandedOver > 0 ? totalHandedOver : allTimeHandedOver;
    const conversionRate = effectiveAssigned > 0
      ? ((effectiveHandedOver / effectiveAssigned) * 100).toFixed(1) + '%'
      : '0.0%';

    const metricsPayload = {
      totalLeadsReceived: timeframe === 'today' && totalLeadsReceived === 0 ? allTimeLeadsReceived : totalLeadsReceived,
      allTimeLeadsReceived,
      totalAssignedByCrmOrAdmin: timeframe === 'today' && totalAssignedByCrmOrAdmin === 0 ? allTimeAssignedByCrmOrAdmin : totalAssignedByCrmOrAdmin,
      allTimeAssignedByCrmOrAdmin,
      totalCallsCompleted: timeframe === 'today' && totalCallsCompleted === 0 ? allTimeCallsCompleted : totalCallsCompleted,
      allTimeCallsCompleted,
      totalPendingCalls,
      pendingCallsToday,
      pendingCallsPast,
      totalCallbacks,
      totalHandedOverToSales: timeframe === 'today' && totalHandedOver === 0 ? allTimeHandedOver : totalHandedOver,
      allTimeHandedOver,
      remainingFollowups,
      conversionRate,
      weeklyActivity: dailyActivity,
      dailyActivity,
    };

    res.status(200).json({
      status: 'success',
      telecaller: {
        _id: targetUser?._id || targetUserId,
        name: telecallerName,
        role: targetUser?.role || 'telecaller'
      },
      data: {
        metrics: metricsPayload,
        ...metricsPayload,
        telecaller: {
          _id: targetUser?._id || targetUserId,
          name: telecallerName,
          role: targetUser?.role || 'telecaller'
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

