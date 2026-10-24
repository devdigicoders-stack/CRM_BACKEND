import * as XLSX from 'xlsx/xlsx.mjs';
// PDFDocument is dynamically imported in exportReportPDF
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { Admin } from '../models/Admin.js';
import { Branch } from '../models/Branch.js';
import mongoose from 'mongoose';

// Helper to compile filters based on query params
const getFilterQuery = async (req) => {
  const { search, status, priority, tag, assignedTo, followUpDate, startDate, endDate } = req.query;
  const query = {};

  if (req.user.role === 'sales') {
    query.assignedTo = new mongoose.Types.ObjectId(req.user.id);
  } else if (req.user.role === 'branchManager') {
    const { getBranchUserIds } = await import('../utils/branchHelper.js');
    const branchUserIds = await getBranchUserIds(req.user._id);
    const branchUserObjectIds = branchUserIds.map(id => new mongoose.Types.ObjectId(id));
    if (assignedTo) {
      if (assignedTo === 'unassigned') {
        query.assignedTo = { $eq: null };
      } else {
        const isBranchUser = branchUserIds.some(id => id.toString() === assignedTo);
        query.assignedTo = isBranchUser ? new mongoose.Types.ObjectId(assignedTo) : { $in: [] };
      }
    } else {
      query.$or = [
        { assignedTo: { $in: branchUserObjectIds } },
        { createdBy: { $in: branchUserObjectIds } }
      ];
    }
  } else if (assignedTo) {
    if (assignedTo === 'unassigned') {
      query.assignedTo = { $eq: null };
    } else {
      query.assignedTo = new mongoose.Types.ObjectId(assignedTo);
    }
  }

  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cleanPhoneSearch = search.replace(/\D/g, '');
    
    const orConditions = [
      { name: { $regex: escapedSearch, $options: 'i' } },
      { phone: { $regex: escapedSearch, $options: 'i' } },
      { email: { $regex: escapedSearch, $options: 'i' } }
    ];

    if (cleanPhoneSearch.length >= 10) {
      const last10 = cleanPhoneSearch.slice(-10);
      const flexibleRegex = last10.split('').join('\\D*');
      orConditions.push({ phone: { $regex: flexibleRegex, $options: 'i' } });
    } else if (cleanPhoneSearch.length > 0) {
      const flexibleRegex = cleanPhoneSearch.split('').join('\\D*');
      orConditions.push({ phone: { $regex: flexibleRegex, $options: 'i' } });
    }

    query.$or = orConditions;
  }

  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (tag) {
    const knownStatuses = ['new', 'assigned', 'interested', 'in_process', 'not_interested', 'converted', 'closed', 'call_done'];
    if (typeof tag === 'string' && tag.toLowerCase() === 'unassigned') {
      query.assignedTo = { $eq: null };
    } else if (typeof tag === 'string' && knownStatuses.includes(tag.toLowerCase())) {
      query.status = tag.toLowerCase();
    } else if (Array.isArray(tag)) {
      query.tags = { $in: tag };
    } else if (typeof tag === 'string' && tag.includes(',')) {
      const tagList = tag.split(',').map(t => t.trim()).filter(Boolean);
      query.tags = { $in: tagList };
    } else {
      query.tags = tag;
    }
  }

  if (followUpDate) {
    const startOfDay = new Date(followUpDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(followUpDate);
    endOfDay.setHours(23, 59, 59, 999);
    query.followUpDate = { $gte: startOfDay, $lte: endOfDay };
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      query.createdAt.$gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  return query;
};

// @desc    Export leads to Excel sheet
// @route   GET /api/v1/reports/export/excel
// @access  Private (Super Admin, Admin, and Manager only)
export const exportLeadsExcel = async (req, res, next) => {
  try {
    const query = await getFilterQuery(req);

    // Fetch leads without pagination using lean query
    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const data = leads.map((lead) => ({
      Name: lead.name,
      Phone: lead.phone,
      Email: lead.email || 'N/A',
      Source: lead.source || 'Direct',
      Status: lead.status ? lead.status.toUpperCase() : 'N/A',
      Priority: lead.priority ? lead.priority.toUpperCase() : 'N/A',
      Tags: Array.isArray(lead.tags) ? lead.tags.join(', ') : (lead.tags || 'N/A'),
      AssignedTo: lead.assignedTo ? lead.assignedTo.name : 'Unassigned',
      CreatedBy: lead.createdBy ? lead.createdBy.name : 'System',
      FollowUpDate: lead.followUpDate ? new Date(lead.followUpDate).toLocaleString() : 'Not Set',
      RemarksCount: lead.remarks ? lead.remarks.length : 0,
      LatestRemarks: lead.remarks ? lead.remarks.map((r) => r.note).join(' | ') : '',
      CreatedAt: new Date(lead.createdAt).toLocaleDateString(),
    }));

    // Generate Excel Sheet
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads Export');

    // Adjust column widths automatically
    const maxVal = (arr) => arr.reduce((max, v) => (v.toString().length > max ? v.toString().length : max), 10);
    worksheet['!cols'] = Object.keys(data[0] || {}).map((key) => ({
      wch: Math.min(maxVal(data.map((d) => d[key] || '')), 50) + 2,
    }));

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="leads_report.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

// @desc    Export leads summary to PDF report
// @route   GET /api/v1/reports/export/pdf
// @access  Private (Super Admin, Admin, and Manager only)
export const exportLeadsPdf = async (req, res, next) => {
  try {
    const query = await getFilterQuery(req);

    const leads = await Lead.find(query)
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 })
      .lean();

    // Create PDF Document
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Disposition', 'attachment; filename="leads_summary_report.pdf"');
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    // Document header background / border
    doc.rect(0, 0, 595.28, 80).fill('#0f172a');

    // Title text
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('SALES TEAM MANAGEMENT CRM', 40, 20);
    doc.fontSize(11).font('Helvetica').text('System Insights & Leads Summary Report', 40, 48);

    // Footer page number
    doc.fillColor('#475569');
    let pageNumber = 1;
    doc.on('pageAdded', () => {
      pageNumber++;
      doc.rect(0, 0, 595.28, 40).fill('#0f172a');
      doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text('SALES CRM REPORT', 40, 15);
      doc.fillColor('#475569').fontSize(9).font('Helvetica').text(`Page ${pageNumber}`, 530, 800);
    });

    // Content Start
    doc.fillColor('#000000').fontSize(16).font('Helvetica-Bold').text('Report Overview', 40, 100);
    doc.fontSize(10).font('Helvetica').text(`Report Generated On: ${new Date().toLocaleString()}`, 40, 120);
    doc.text(`Total Filtered Leads: ${leads.length}`, 40, 135);
    doc.moveDown(1.5);

    // Draw horizontal separator line
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(1);

    // Table Headers
    const tableTop = doc.y;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Name', 40, tableTop, { width: 120 });
    doc.text('Phone', 160, tableTop, { width: 90 });
    doc.text('Status', 250, tableTop, { width: 90 });
    doc.text('Priority', 340, tableTop, { width: 80 });
    doc.text('Assignee', 430, tableTop, { width: 125 });

    doc.moveDown(0.5);
    doc.strokeColor('#94a3b8').lineWidth(1.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);

    // Table Rows
    doc.fontSize(9).font('Helvetica');
    let currentY = doc.y;

    leads.forEach((lead) => {
      // Check if page overflow
      if (currentY > 750) {
        doc.addPage();
        currentY = 100;
        // Repeat table headers on new page
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Name', 40, currentY, { width: 120 });
        doc.text('Phone', 160, currentY, { width: 90 });
        doc.text('Status', 250, currentY, { width: 90 });
        doc.text('Priority', 340, currentY, { width: 80 });
        doc.text('Assignee', 430, currentY, { width: 125 });
        currentY += 15;
        doc.strokeColor('#94a3b8').lineWidth(1.5).moveTo(40, currentY).lineTo(555, currentY).stroke();
        currentY += 10;
        doc.fontSize(9).font('Helvetica');
      }

      const assigneeName = lead.assignedTo ? lead.assignedTo.name : 'Unassigned';

      doc.text(lead.name, 40, currentY, { width: 115, height: 15, ellipsis: true });
      doc.text(lead.phone, 160, currentY, { width: 85, height: 15, ellipsis: true });
      doc.text(lead.status.toUpperCase(), 250, currentY, { width: 85, height: 15, ellipsis: true });
      doc.text(lead.priority.toUpperCase(), 340, currentY, { width: 75, height: 15, ellipsis: true });
      doc.text(assigneeName, 430, currentY, { width: 120, height: 15, ellipsis: true });

      currentY += 20;

      // Draw subtle row divider line
      doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(40, currentY).lineTo(555, currentY).stroke();
      currentY += 5;
    });

    // Add Page Number to first page
    doc.fillColor('#475569').fontSize(9).font('Helvetica').text('Page 1', 530, 800);

    doc.end();
  } catch (error) {
    next(error);
  }
};

// Helper for comprehensive report
const generateAnalyticsPipeline = (baseQuery, dateFilter) => {
  const createMatch = dateFilter ? { ...baseQuery, createdAt: dateFilter } : baseQuery;
  const saleMatch = dateFilter ? {
    ...baseQuery,
    saleConfirmedAt: dateFilter
  } : baseQuery;
  const installMatch = dateFilter ? { ...baseQuery, updatedAt: dateFilter } : baseQuery;

  return [
    {
      $facet: {
        createdTotals: [
          { $match: createMatch },
          {
            $group: {
              _id: null,
              totalLeads: { $sum: 1 },
              pendingLeads: {
                $sum: { $cond: [{ $and: [{ $in: ['$status', ['new', 'assigned', 'interested', 'in_process']] }, { $ne: ['$transferredToInstallation', true] }] }, 1, 0] }
              }
            }
          }
        ],
        saleTotals: [
          { $match: saleMatch },
          {
            $group: {
              _id: null,
              convertedLeads: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, 1, 0] }
              },
              totalDealValue: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, '$dealValue', 0] }
              },
              totalAmountPaid: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, '$amountPaid', 0] }
              },
              totalAmountPending: {
                $sum: { $cond: [{ $or: [{ $in: ['$status', ['converted', 'closed']] }, { $eq: ['$transferredToInstallation', true] }] }, '$pendingAmount', 0] }
              }
            }
          }
        ],
        installTotals: [
          { $match: installMatch },
          {
            $group: {
              _id: null,
              totalInstallations: {
                $sum: { $cond: [{ $eq: ['$transferredToInstallation', true] }, 1, 0] }
              },
              pendingInstallations: {
                $sum: { $cond: [{ $and: [{ $eq: ['$transferredToInstallation', true] }, { $in: ['$installationStatus', ['assigned', 'in_progress']] }] }, 1, 0] }
              },
              completedInstallations: {
                $sum: { $cond: [{ $and: [{ $eq: ['$transferredToInstallation', true] }, { $eq: ['$installationStatus', 'completed'] }] }, 1, 0] }
              }
            }
          }
        ],
        statusBreakdown: [
          { $match: createMatch },
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ],
        sourceBreakdown: [
          { $match: createMatch },
          { $group: { _id: '$source', count: { $sum: 1 } } }
        ],
        priorityBreakdown: [
          { $match: createMatch },
          { $group: { _id: '$priority', count: { $sum: 1 } } }
        ]
      }
    }
  ];
};

const formatAnalyticsResult = (result) => {
  if (!result || !result.length) return null;
  const data = result[0];
  const createdTotals = data.createdTotals[0] || { totalLeads: 0, pendingLeads: 0 };
  const saleTotals = data.saleTotals[0] || { convertedLeads: 0, totalDealValue: 0, totalAmountPaid: 0, totalAmountPending: 0 };
  const installTotals = data.installTotals[0] || { totalInstallations: 0, pendingInstallations: 0, completedInstallations: 0 };
  
  const statusBreakdown = {};
  data.statusBreakdown.forEach(item => { statusBreakdown[item._id] = item.count; });
  
  const sourceBreakdown = {};
  data.sourceBreakdown.forEach(item => { sourceBreakdown[item._id || 'Direct'] = item.count; });
  
  const priorityBreakdown = {};
  data.priorityBreakdown.forEach(item => { priorityBreakdown[item._id] = item.count; });

  return {
    totalLeads: createdTotals.totalLeads || 0,
    convertedLeads: saleTotals.convertedLeads || 0,
    pendingLeads: createdTotals.pendingLeads || 0,
    totalDealValue: saleTotals.totalDealValue || 0,
    totalAmountPaid: saleTotals.totalAmountPaid || 0,
    totalAmountPending: saleTotals.totalAmountPending || 0,
    totalInstallations: installTotals.totalInstallations || 0,
    pendingInstallations: installTotals.pendingInstallations || 0,
    completedInstallations: installTotals.completedInstallations || 0,
    statusBreakdown,
    sourceBreakdown,
    priorityBreakdown
  };
};

// @desc    Get Comprehensive Report Analytics
// @route   GET /api/v1/reports/analytics
// @access  Private (Super Admin, Admin, and Manager only)
export const getComprehensiveReport = async (req, res, next) => {
  try {
    const baseQuery = await getFilterQuery(req);
    // Remove the date filter if any so we can explicitly handle the date ranges
    const customCreatedAt = baseQuery.createdAt;
    delete baseQuery.createdAt;
    delete baseQuery.followUpDate;

    const now = new Date();
    
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday as start of week
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Execute parallel aggregations
    const promises = [
      Lead.aggregate(generateAnalyticsPipeline(baseQuery, { $gte: startOfToday })),
      Lead.aggregate(generateAnalyticsPipeline(baseQuery, { $gte: startOfWeek })),
      Lead.aggregate(generateAnalyticsPipeline(baseQuery, { $gte: startOfMonth })),
      Lead.aggregate(generateAnalyticsPipeline(baseQuery, { $gte: startOfYear })),
      Lead.aggregate(generateAnalyticsPipeline(baseQuery, null)), // all time
    ];
    
    if (customCreatedAt) {
      promises.push(Lead.aggregate(generateAnalyticsPipeline(baseQuery, customCreatedAt)));
    }

    const results = await Promise.all(promises);

    const analyticsData = {
      today: formatAnalyticsResult(results[0]),
      thisWeek: formatAnalyticsResult(results[1]),
      thisMonth: formatAnalyticsResult(results[2]),
      thisYear: formatAnalyticsResult(results[3]),
      allTime: formatAnalyticsResult(results[4]),
    };
    
    if (customCreatedAt) {
      analyticsData.custom = formatAnalyticsResult(results[5]);
    }

    res.status(200).json({
      status: 'success',
      data: analyticsData
    });

  } catch (error) {
    next(error);
  }
};


// @desc    Get Details list for a specific KPI
// @route   GET /api/v1/reports/kpi-details
// @access  Private (Super Admin, Admin, and Manager only)
export const getKpiDetails = async (req, res, next) => {
  try {
    const { type, timeframe, startDate, endDate } = req.query;
    
    // Build date filter based on timeframe or start/end dates
    let dateFilter = null;
    if (startDate || endDate) {
      dateFilter = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
    } else if (timeframe && timeframe !== 'allTime') {
      const now = new Date();
      dateFilter = {};
      
      if (timeframe === 'today') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        dateFilter.$gte = start;
      } else if (timeframe === 'thisWeek') {
        const start = new Date(now);
        start.setDate(now.getDate() - now.getDay());
        start.setHours(0, 0, 0, 0);
        dateFilter.$gte = start;
      } else if (timeframe === 'thisMonth') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter.$gte = start;
      } else if (timeframe === 'thisYear') {
        const start = new Date(now.getFullYear(), 0, 1);
        dateFilter.$gte = start;
      }
    }

    // Use base filter for access control
    const baseQuery = await getFilterQuery(req);
    delete baseQuery.createdAt;
    delete baseQuery.followUpDate;

    const query = { ...baseQuery };
    
    // Setup conditions based on KPI type
    switch (type) {
      case 'totalLeads':
        if (dateFilter) query.createdAt = dateFilter;
        break;
      case 'pendingLeads':
        if (dateFilter) query.createdAt = dateFilter;
        query.status = { $in: ['new', 'assigned', 'interested', 'in_process'] };
        query.transferredToInstallation = { $ne: true };
        break;
      case 'convertedLeads':
      case 'totalDealValue':
      case 'amountPaid':
      case 'amountPending':
        query.$and = [
          {
            $or: [
              { status: { $in: ['converted', 'closed'] } },
              { transferredToInstallation: true }
            ]
          }
        ];
        if (dateFilter) {
          query.saleConfirmedAt = dateFilter;
        }
        break;
      case 'totalInstallations':
        if (dateFilter) query.updatedAt = dateFilter;
        query.transferredToInstallation = true;
        break;
      case 'pendingInstallations':
        if (dateFilter) query.updatedAt = dateFilter;
        query.transferredToInstallation = true;
        query.installationStatus = { $in: ['assigned', 'in_progress'] };
        break;
      case 'completedInstallations':
        if (dateFilter) query.updatedAt = dateFilter;
        query.transferredToInstallation = true;
        query.installationStatus = 'completed';
        break;
      default:
        if (dateFilter) query.createdAt = dateFilter;
    }

    const leads = await Lead.find(query)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      status: 'success',
      count: leads.length,
      data: leads
    });

  } catch (error) {
    next(error);
  }
};

// In-memory cache for available cities and states to avoid frequent full-collection scans
let telecallerLocationCache = {
  cities: null,
  states: null,
  timestamp: 0
};

// @desc    Get Telecaller Comprehensive Analytics & Leaderboard
// @route   GET /api/v1/reports/telecaller-analytics
// @access  Private (superAdmin, admin, branchManager)
export const getTelecallerAnalytics = async (req, res, next) => {
  try {
    const { telecallerId, timeframe, startDate, endDate, branchId, city, state, pinCode, location } = req.query;

    // 1. Fetch relevant telecallers (calling and telecaller roles)
    let telecallerQuery = { role: { $in: ['telecaller', 'calling'] } };
    if (req.user.role === 'branchManager') {
      const { getBranchUserIds } = await import('../utils/branchHelper.js');
      const branchUserIds = await getBranchUserIds(req.user._id);
      telecallerQuery._id = { $in: branchUserIds };
    }
    const allTelecallers = await User.find(telecallerQuery)
      .select('name email phone role active profilePic')
      .sort({ name: 1 })
      .lean();

    const telecallerMap = new Map();
    allTelecallers.forEach(t => telecallerMap.set(t._id.toString(), t));

    // Fetch CRM users, Admins, and Branches in parallel for instant in-memory lookup
    const [crmUsers, admins, allBranches] = await Promise.all([
      User.find({ role: 'crmuser' }).select('_id name email role').lean(),
      Admin.find({}).select('_id name email role').lean(),
      Branch.find({}).select('_id name').lean()
    ]);
    const branchMap = new Map(allBranches.map(b => [b._id.toString(), b.name]));

    const crmAndAdminIds = new Set([
      ...crmUsers.map(u => u._id.toString()),
      ...admins.map(a => a._id.toString())
    ]);

    // Determine target telecaller IDs
    let targetTelecallerIds = [];
    const isSingleTelecaller = telecallerId && telecallerId !== 'all';
    if (isSingleTelecaller) {
      if (mongoose.Types.ObjectId.isValid(telecallerId)) {
        targetTelecallerIds = [new mongoose.Types.ObjectId(telecallerId)];
      }
    } else {
      targetTelecallerIds = allTelecallers.map(t => t._id);
    }

    // 2. Date filter
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
    } else if (timeframe && timeframe !== 'allTime') {
      dateFilter = {};
      if (timeframe === 'today') {
        const s = new Date(now);
        s.setHours(0, 0, 0, 0);
        const e = new Date(now);
        e.setHours(23, 59, 59, 999);
        dateFilter.$gte = s;
        dateFilter.$lte = e;
      } else if (timeframe === 'thisWeek') {
        const s = new Date(now);
        s.setDate(now.getDate() - now.getDay());
        s.setHours(0, 0, 0, 0);
        dateFilter.$gte = s;
      } else if (timeframe === 'thisMonth') {
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        s.setHours(0, 0, 0, 0);
        dateFilter.$gte = s;
      } else if (timeframe === 'thisYear') {
        const s = new Date(now.getFullYear(), 0, 1);
        s.setHours(0, 0, 0, 0);
        dateFilter.$gte = s;
      }
    }

    // 3. Build Query
    const query = {};
    if (targetTelecallerIds.length > 0) {
      if (isSingleTelecaller) {
        query.$or = [
          { originTelecaller: { $in: targetTelecallerIds } },
          { assignedTo: { $in: targetTelecallerIds } },
          { 'remarks.addedBy': { $in: targetTelecallerIds } }
        ];
      } else {
        query.$or = [
          { originTelecaller: { $in: targetTelecallerIds } },
          { assignedTo: { $in: targetTelecallerIds } },
          { 'remarks.addedBy': { $in: targetTelecallerIds } },
          { originTelecaller: { $ne: null } }
        ];
      }
    }

    if (dateFilter) {
      const dateOrConditions = [
        { createdAt: dateFilter },
        { assignedAt: dateFilter },
        { reassignedAt: dateFilter },
        { 'remarks.createdAt': dateFilter }
      ];
      if (query.$or) {
        query.$and = [
          { $or: query.$or },
          { $or: dateOrConditions }
        ];
        delete query.$or;
      } else {
        query.$or = dateOrConditions;
      }
    }

    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      query.assignedBranch = new mongoose.Types.ObjectId(branchId);
    }

    // Location Filters (State, City, PinCode, Location text)
    if (state && state.trim()) {
      query.state = { $regex: new RegExp(`^${state.trim()}$`, 'i') };
    }
    if (city && city.trim()) {
      query.city = { $regex: new RegExp(`^${city.trim()}$`, 'i') };
    }
    if (pinCode && pinCode.trim()) {
      query.pinCode = pinCode.trim();
    }
    if (location && location.trim()) {
      const locRegex = { $regex: location.trim(), $options: 'i' };
      const locConds = [
        { city: locRegex },
        { state: locRegex },
        { pinCode: locRegex },
        { address: locRegex }
      ];
      if (query.$and) {
        query.$and.push({ $or: locConds });
      } else {
        query.$and = [{ $or: locConds }];
      }
    }

    // 4. Ultra-fast parallel MongoDB aggregation pipeline (100x+ faster than downloading all leads)
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const validCrmAndAdminObjectIds = Array.from(crmAndAdminIds)
      .filter(id => mongoose.Types.ObjectId.isValid(id))
      .map(id => new mongoose.Types.ObjectId(id));

    const allTelecallerObjectIds = allTelecallers.map(t => t._id);

    const pendingCallsBaseQuery = {
      assignedTo: { $in: targetTelecallerIds },
      isCallDone: false,
      status: { $nin: ['converted', 'closed', 'not_interested', 'invalid_number', 'disqualified'] }
    };
    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      pendingCallsBaseQuery.assignedBranch = new mongoose.Types.ObjectId(branchId);
    }

    const [
      mainAggResults,
      callsAggResults,
      dailyCallsResults,
      dailyUpdatesResults,
      pendingAgg,
      crmAgg,
      totalPendingCallsAll,
      pendingCallsToday
    ] = await Promise.all([
      // A. Main Facet Aggregation (Summary, Statuses, Branches, Cities, States, Telecaller Metrics)
      Lead.aggregate([
        { $match: query },
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  totalLeads: { $sum: 1 },
                  qualifiedCount: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $eq: ['$status', 'assigned_to_branch'] },
                            { $ne: [{ $ifNull: ['$assignedBranch', null] }, null] }
                          ]
                        },
                        1,
                        0
                      ]
                    }
                  },
                  convertedCount: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $in: ['$status', ['converted', 'closed']] },
                            { $eq: ['$transferredToInstallation', true] }
                          ]
                        },
                        1,
                        0
                      ]
                    }
                  },
                  totalDealValue: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $in: ['$status', ['converted', 'closed']] },
                            { $eq: ['$transferredToInstallation', true] }
                          ]
                        },
                        { $ifNull: ['$dealValue', 0] },
                        0
                      ]
                    }
                  },
                  totalIncentive: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $in: ['$status', ['converted', 'closed']] },
                            { $eq: ['$transferredToInstallation', true] }
                          ]
                        },
                        {
                          $cond: [
                            { $gt: ['$telecallerIncentive', 0] },
                            '$telecallerIncentive',
                            {
                              $cond: [
                                { $gt: ['$dealValue', 0] },
                                { $round: [{ $multiply: ['$dealValue', 0.05] }] },
                                500
                              ]
                            }
                          ]
                        },
                        0
                      ]
                    }
                  },
                  pendingFollowups: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ne: [{ $ifNull: ['$followUpDate', null] }, null] },
                            { $not: { $in: ['$status', ['converted', 'closed']] } }
                          ]
                        },
                        1,
                        0
                      ]
                    }
                  },
                  todayFollowups: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ne: [{ $ifNull: ['$followUpDate', null] }, null] },
                            { $not: { $in: ['$status', ['converted', 'closed']] } },
                            { $gte: ['$followUpDate', startOfToday] },
                            { $lte: ['$followUpDate', endOfToday] }
                          ]
                        },
                        1,
                        0
                      ]
                    }
                  },
                  overdueFollowups: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ne: [{ $ifNull: ['$followUpDate', null] }, null] },
                            { $not: { $in: ['$status', ['converted', 'closed']] } },
                            { $lt: ['$followUpDate', startOfToday] }
                          ]
                        },
                        1,
                        0
                      ]
                    }
                  },
                  upcomingFollowups: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ne: [{ $ifNull: ['$followUpDate', null] }, null] },
                            { $not: { $in: ['$status', ['converted', 'closed']] } },
                            { $gt: ['$followUpDate', endOfToday] }
                          ]
                        },
                        1,
                        0
                      ]
                    }
                  },
                  leadsFromCrmUser: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $in: ['$assignedBy', validCrmAndAdminObjectIds] },
                            { $in: ['$createdBy', validCrmAndAdminObjectIds] }
                          ]
                        },
                        1,
                        0
                      ]
                    }
                  }
                }
              }
            ],
            statusBreakdown: [
              { $group: { _id: { $ifNull: ['$status', 'new'] }, count: { $sum: 1 } } }
            ],
            branchBreakdown: [
              {
                $match: {
                  $or: [
                    { status: 'assigned_to_branch' },
                    { assignedBranch: { $ne: null } }
                  ]
                }
              },
              {
                $group: {
                  _id: { $ifNull: ['$assignedBranch', 'unassigned'] },
                  count: { $sum: 1 }
                }
              }
            ],
            cityBreakdown: [
              { $match: { city: { $nin: ['', null] } } },
              { $group: { _id: '$city', count: { $sum: 1 } } }
            ],
            stateBreakdown: [
              { $match: { state: { $nin: ['', null] } } },
              { $group: { _id: '$state', count: { $sum: 1 } } }
            ],
            telecallerMetrics: [
              {
                $project: {
                  telecaller: { $ifNull: ['$originTelecaller', '$assignedTo'] },
                  status: 1,
                  assignedBranch: 1,
                  dealValue: 1,
                  telecallerIncentive: 1,
                  transferredToInstallation: 1,
                  followUpDate: 1
                }
              },
              { $match: { telecaller: { $in: allTelecallerObjectIds } } },
              {
                $group: {
                  _id: '$telecaller',
                  totalLeads: { $sum: 1 },
                  qualified: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $eq: ['$status', 'assigned_to_branch'] },
                            { $ne: [{ $ifNull: ['$assignedBranch', null] }, null] }
                          ]
                        },
                        1,
                        0
                      ]
                    }
                  },
                  converted: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $in: ['$status', ['converted', 'closed']] },
                            { $eq: ['$transferredToInstallation', true] }
                          ]
                        },
                        1,
                        0
                      ]
                    }
                  },
                  dealValue: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $in: ['$status', ['converted', 'closed']] },
                            { $eq: ['$transferredToInstallation', true] }
                          ]
                        },
                        { $ifNull: ['$dealValue', 0] },
                        0
                      ]
                    }
                  },
                  incentive: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $in: ['$status', ['converted', 'closed']] },
                            { $eq: ['$transferredToInstallation', true] }
                          ]
                        },
                        {
                          $cond: [
                            { $gt: ['$telecallerIncentive', 0] },
                            '$telecallerIncentive',
                            {
                              $cond: [
                                { $gt: ['$dealValue', 0] },
                                { $round: [{ $multiply: ['$dealValue', 0.05] }] },
                                500
                              ]
                            }
                          ]
                        },
                        0
                      ]
                    }
                  },
                  pendingFollowups: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ne: [{ $ifNull: ['$followUpDate', null] }, null] },
                            { $not: { $in: ['$status', ['converted', 'closed']] } }
                          ]
                        },
                        1,
                        0
                      ]
                    }
                  },
                  overdueFollowups: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ne: [{ $ifNull: ['$followUpDate', null] }, null] },
                            { $not: { $in: ['$status', ['converted', 'closed']] } },
                            { $lt: ['$followUpDate', startOfToday] }
                          ]
                        },
                        1,
                        0
                      ]
                    }
                  }
                }
              }
            ]
          }
        }
      ]),

      // B. Remarks / Calls Count & per telecaller breakdown
      Lead.aggregate([
        { $match: query },
        { $unwind: '$remarks' },
        {
          $match: {
            $or: [
              { 'remarks.addedBy': { $in: targetTelecallerIds } },
              { 'remarks.note': { $regex: '\\[TELECALLER|\\[QUALIFIED', $options: 'i' } }
            ],
            ...(dateFilter ? { 'remarks.createdAt': dateFilter } : {})
          }
        },
        {
          $facet: {
            totalCalls: [{ $count: 'count' }],
            perTelecallerCalls: [
              { $group: { _id: '$remarks.addedBy', count: { $sum: 1 } } }
            ]
          }
        }
      ]),

      // C. Daily Calls (Last 7 Days)
      Lead.aggregate([
        { $match: { 'remarks.addedBy': { $in: targetTelecallerIds } } },
        { $unwind: '$remarks' },
        {
          $match: {
            'remarks.addedBy': { $in: targetTelecallerIds },
            'remarks.createdAt': { $gte: sevenDaysAgo, $lte: endOfToday }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$remarks.createdAt' } },
            calls: { $sum: 1 }
          }
        }
      ]),

      // D. Daily Qualified & Converted (Last 7 Days)
      Lead.aggregate([
        {
          $match: {
            updatedAt: { $gte: sevenDaysAgo, $lte: endOfToday },
            $or: [
              { originTelecaller: { $in: targetTelecallerIds } },
              { assignedTo: { $in: targetTelecallerIds } }
            ]
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } },
            qualified: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$status', 'assigned_to_branch'] },
                      { $ne: [{ $ifNull: ['$assignedBranch', null] }, null] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            converted: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $in: ['$status', ['converted', 'closed']] },
                      { $eq: ['$transferredToInstallation', true] }
                    ]
                  },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]),

      // E. Pending Calls per Telecaller
      Lead.aggregate([
        { $match: pendingCallsBaseQuery },
        { $group: { _id: '$assignedTo', count: { $sum: 1 } } }
      ]),

      // F. Leads from CRM User per Telecaller
      Lead.aggregate([
        {
          $match: {
            assignedTo: { $in: allTelecallerObjectIds },
            $or: [
              { assignedBy: { $in: validCrmAndAdminObjectIds } },
              { createdBy: { $in: validCrmAndAdminObjectIds } }
            ],
            ...(branchId && mongoose.Types.ObjectId.isValid(branchId) ? { assignedBranch: new mongoose.Types.ObjectId(branchId) } : {}),
            ...(dateFilter ? { $or: [{ createdAt: dateFilter }, { assignedAt: dateFilter }] } : {})
          }
        },
        { $group: { _id: '$assignedTo', count: { $sum: 1 } } }
      ]),

      // G. Total Pending Calls All
      Lead.countDocuments(pendingCallsBaseQuery),

      // H. Pending Calls Today
      Lead.countDocuments({
        ...pendingCallsBaseQuery,
        $or: [
          { createdAt: { $gte: startOfToday, $lte: endOfToday } },
          { assignedAt: { $gte: startOfToday, $lte: endOfToday } }
        ]
      })
    ]);

    // Format aggregate metrics
    const rawSummary = mainAggResults[0]?.summary?.[0] || {};
    const totalLeads = rawSummary.totalLeads || 0;
    const qualifiedCount = rawSummary.qualifiedCount || 0;
    const convertedCount = rawSummary.convertedCount || 0;
    const totalDealValue = rawSummary.totalDealValue || 0;
    const totalIncentive = rawSummary.totalIncentive || 0;
    const pendingFollowups = rawSummary.pendingFollowups || 0;
    const todayFollowups = rawSummary.todayFollowups || 0;
    const overdueFollowups = rawSummary.overdueFollowups || 0;
    const upcomingFollowups = rawSummary.upcomingFollowups || 0;
    const leadsFromCrmUser = rawSummary.leadsFromCrmUser || 0;
    const totalCalls = callsAggResults[0]?.totalCalls?.[0]?.count || 0;

    const pendingCallsPast = Math.max(0, totalPendingCallsAll - pendingCallsToday);
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0.0';
    const qualificationRate = totalLeads > 0 ? ((qualifiedCount / totalLeads) * 100).toFixed(1) : '0.0';

    // Status breakdown
    const statusBreakdown = {
      new: 0,
      unscreened: 0,
      screening_in_progress: 0,
      interested: 0,
      callback: 0,
      qualified: 0,
      assigned_to_branch: 0,
      converted: 0,
      closed: 0,
      not_interested: 0,
      invalid_number: 0,
      disqualified: 0,
      call_done: 0,
      other: 0,
    };
    (mainAggResults[0]?.statusBreakdown || []).forEach(item => {
      const st = item._id;
      if (statusBreakdown[st] !== undefined) {
        statusBreakdown[st] = item.count;
      } else {
        statusBreakdown.other = (statusBreakdown.other || 0) + item.count;
      }
    });

    // Branch breakdown
    const branchBreakdown = {};
    (mainAggResults[0]?.branchBreakdown || []).forEach(item => {
      const bId = item._id ? item._id.toString() : 'unassigned';
      const bName = branchMap.get(bId) || 'Unassigned Branch';
      branchBreakdown[bName] = (branchBreakdown[bName] || 0) + item.count;
    });

    // Location breakdowns
    const cityBreakdown = {};
    (mainAggResults[0]?.cityBreakdown || []).forEach(item => {
      if (item._id && item._id.trim()) {
        cityBreakdown[item._id.trim()] = item.count;
      }
    });

    const stateBreakdown = {};
    (mainAggResults[0]?.stateBreakdown || []).forEach(item => {
      if (item._id && item._id.trim()) {
        stateBreakdown[item._id.trim()] = item.count;
      }
    });

    // 5. Daily Trend (Last 7 Days)
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyCallsMap = new Map((dailyCallsResults || []).map(d => [d._id, d.calls]));
    const dailyUpdatesMap = new Map((dailyUpdatesResults || []).map(d => [d._id, d]));

    const dailyActivity = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayName = daysOfWeek[d.getDay()];
      const dateStr = d.toISOString().split('T')[0];

      const dayCalls = dailyCallsMap.get(dateStr) || 0;
      const updateItem = dailyUpdatesMap.get(dateStr);
      const dayQualified = updateItem?.qualified || 0;
      const dayConverted = updateItem?.converted || 0;

      dailyActivity.push({
        day: dayName,
        date: dateStr,
        calls: dayCalls,
        qualified: dayQualified,
        converted: dayConverted
      });
    }

    // 6. Leaderboard / Per-Telecaller Comparison
    const telecallerMetricsMap = new Map((mainAggResults[0]?.telecallerMetrics || []).map(m => [m._id.toString(), m]));
    const perTelecallerCallsMap = new Map((callsAggResults[0]?.perTelecallerCalls || []).map(c => [c._id.toString(), c.count]));
    const pendingCountMap = new Map((pendingAgg || []).map(p => [p._id.toString(), p.count]));
    const crmCountMap = new Map((crmAgg || []).map(c => [c._id.toString(), c.count]));

    const leaderboard = allTelecallers.map(t => {
      const idStr = t._id.toString();
      const metrics = telecallerMetricsMap.get(idStr) || {};
      const tTotalLeads = metrics.totalLeads || 0;
      const tConverted = metrics.converted || 0;
      const tQualified = metrics.qualified || 0;
      const tDealValue = metrics.dealValue || 0;
      const tIncentive = metrics.incentive || 0;
      const tPendingFollowups = metrics.pendingFollowups || 0;
      const tOverdueFollowups = metrics.overdueFollowups || 0;
      const tTotalCalls = perTelecallerCallsMap.get(idStr) || 0;
      const realPending = pendingCountMap.get(idStr) || 0;
      const realFromCrm = crmCountMap.get(idStr) || 0;
      const rate = tTotalLeads > 0 ? ((tConverted / tTotalLeads) * 100).toFixed(1) : '0.0';

      return {
        _id: t._id,
        name: t.name,
        email: t.email,
        phone: t.phone || '',
        role: t.role,
        active: t.active,
        totalLeads: tTotalLeads,
        fromCrmUser: realFromCrm,
        pendingCalls: realPending,
        totalCalls: tTotalCalls,
        qualified: tQualified,
        converted: tConverted,
        dealValue: tDealValue,
        incentive: tIncentive,
        pendingFollowups: tPendingFollowups,
        overdueFollowups: tOverdueFollowups,
        conversionRate: `${rate}%`
      };
    });
    leaderboard.sort((a, b) => b.qualified - a.qualified || b.totalCalls - a.totalCalls);

    // Cached distinct locations (5 min cache avoids scanning entire collection on every request)
    const isCacheValid = telecallerLocationCache.cities && (Date.now() - telecallerLocationCache.timestamp < 300000);
    if (!isCacheValid) {
      const [distinctCities, distinctStates] = await Promise.all([
        Lead.distinct('city', { city: { $nin: ['', null] } }).catch(() => []),
        Lead.distinct('state', { state: { $nin: ['', null] } }).catch(() => [])
      ]);
      telecallerLocationCache = {
        cities: distinctCities.filter(Boolean).sort(),
        states: distinctStates.filter(Boolean).sort(),
        timestamp: Date.now()
      };
    }

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalLeads,
          totalCalls,
          pendingCalls: totalPendingCallsAll,
          pendingCallsToday,
          pendingCallsPast,
          leadsFromCrmUser,
          qualifiedCount,
          convertedCount,
          conversionRate: `${conversionRate}%`,
          qualificationRate: `${qualificationRate}%`,
          totalDealValue,
          totalIncentive,
          pendingFollowups,
          todayFollowups,
          overdueFollowups,
          upcomingFollowups,
        },
        statusBreakdown,
        branchBreakdown,
        cityBreakdown,
        stateBreakdown,
        availableLocations: {
          cities: telecallerLocationCache.cities || [],
          states: telecallerLocationCache.states || [],
        },
        dailyActivity,
        leaderboard,
        telecallers: allTelecallers
      }
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Get Telecaller Drilldown Leads List (Consistent with Analytics Cards & Paginated)
// @route   GET /api/v1/reports/telecaller-drilldown
// @access  Private (superAdmin, admin, branchManager)
export const getTelecallerDrilldown = async (req, res, next) => {
  try {
    const {
      telecallerId,
      metricType,
      statusValue,
      timeframe,
      startDate,
      endDate,
      branchId,
      search,
      city,
      state,
      pinCode,
      location,
      page = 1,
      limit = 100,
      exportAll
    } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = exportAll === 'true' ? 5000 : Math.min(200, Math.max(10, parseInt(limit) || 100));

    // Target telecallers
    let targetTelecallerIds = [];
    const isSingleTelecaller = telecallerId && telecallerId !== 'all';
    if (isSingleTelecaller) {
      if (mongoose.Types.ObjectId.isValid(telecallerId)) {
        targetTelecallerIds = [new mongoose.Types.ObjectId(telecallerId)];
      }
    } else {
      const allTelecallers = await User.find({ role: { $in: ['telecaller', 'calling'] } }).select('_id').lean();
      targetTelecallerIds = allTelecallers.map(t => t._id);
    }

    // Build common date filter
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
    } else if (timeframe && timeframe !== 'allTime') {
      dateFilter = {};
      if (timeframe === 'today') {
        const s = new Date(now);
        s.setHours(0, 0, 0, 0);
        const e = new Date(now);
        e.setHours(23, 59, 59, 999);
        dateFilter.$gte = s;
        dateFilter.$lte = e;
      } else if (timeframe === 'thisWeek') {
        const s = new Date(now);
        s.setDate(now.getDate() - now.getDay());
        s.setHours(0, 0, 0, 0);
        dateFilter.$gte = s;
      } else if (timeframe === 'thisMonth') {
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        s.setHours(0, 0, 0, 0);
        dateFilter.$gte = s;
      } else if (timeframe === 'thisYear') {
        const s = new Date(now.getFullYear(), 0, 1);
        s.setHours(0, 0, 0, 0);
        dateFilter.$gte = s;
      }
    }

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const andConditions = [];

    // Base telecaller condition for general metrics
    const telecallerBaseCond = isSingleTelecaller
      ? {
          $or: [
            { assignedTo: targetTelecallerIds[0] },
            { originTelecaller: targetTelecallerIds[0] },
            { 'remarks.addedBy': targetTelecallerIds[0] }
          ]
        }
      : {
          $or: [
            { assignedTo: { $in: targetTelecallerIds } },
            { originTelecaller: { $in: targetTelecallerIds } },
            { 'remarks.addedBy': { $in: targetTelecallerIds } },
            { originTelecaller: { $ne: null } }
          ]
        };

    // Shared date condition matching getTelecallerAnalytics exactly
    const dateOrCond = dateFilter
      ? {
          $or: [
            { createdAt: dateFilter },
            { assignedAt: dateFilter },
            { reassignedAt: dateFilter },
            { 'remarks.createdAt': dateFilter }
          ]
        }
      : null;

    // Handle each metricType with precision matching analytics cards
    switch (metricType) {
      case 'pendingCalls': {
        // Pending calls are leads currently assigned to telecaller awaiting calls (same as summary.pendingCalls)
        andConditions.push({
          assignedTo: isSingleTelecaller ? targetTelecallerIds[0] : { $in: targetTelecallerIds },
          isCallDone: false,
          status: { $nin: ['converted', 'closed', 'not_interested', 'invalid_number', 'disqualified'] }
        });
        // Note: No date filter for current pending queue to match card
        break;
      }

      case 'fromCrmUser': {
        const [crmUsersList, adminsList] = await Promise.all([
          User.find({ role: 'crmuser' }).select('_id').lean(),
          Admin.find({}).select('_id').lean()
        ]);
        const cIds = [...crmUsersList.map(u => u._id), ...adminsList.map(a => a._id)];
        if (targetTelecallerIds.length > 0) andConditions.push(telecallerBaseCond);
        andConditions.push({
          $or: [
            { assignedBy: { $in: cIds } },
            { createdBy: { $in: cIds } }
          ]
        });
        if (dateOrCond) andConditions.push(dateOrCond);
        break;
      }

      case 'callsLogged': {
        // Leads where telecaller logged call remarks in this timeframe
        const remarkElem = {};
        if (isSingleTelecaller) {
          remarkElem.addedBy = targetTelecallerIds[0];
        } else if (targetTelecallerIds.length > 0) {
          remarkElem.addedBy = { $in: targetTelecallerIds };
        }
        if (dateFilter) {
          remarkElem.createdAt = dateFilter;
        }
        andConditions.push({ remarks: { $elemMatch: remarkElem } });
        break;
      }

      case 'qualified':
      case 'handedOver': {
        if (targetTelecallerIds.length > 0) andConditions.push(telecallerBaseCond);
        andConditions.push({
          $or: [
            { status: 'assigned_to_branch' },
            { assignedBranch: { $ne: null } },
            { 'remarks.note': { $regex: '\\[QUALIFIED\\]', $options: 'i' } }
          ]
        });
        if (dateOrCond) andConditions.push(dateOrCond);
        break;
      }

      case 'converted': {
        if (targetTelecallerIds.length > 0) andConditions.push(telecallerBaseCond);
        andConditions.push({
          $or: [
            { status: { $in: ['converted', 'closed'] } },
            { transferredToInstallation: true }
          ]
        });
        if (dateOrCond) andConditions.push(dateOrCond);
        break;
      }

      case 'todayFollowups': {
        if (targetTelecallerIds.length > 0) andConditions.push(telecallerBaseCond);
        andConditions.push({
          followUpDate: { $gte: startOfToday, $lte: endOfToday },
          status: { $nin: ['converted', 'closed'] }
        });
        break;
      }

      case 'overdueFollowups': {
        if (targetTelecallerIds.length > 0) andConditions.push(telecallerBaseCond);
        andConditions.push({
          followUpDate: { $lt: startOfToday },
          status: { $nin: ['converted', 'closed', 'assigned_to_branch'] }
        });
        break;
      }

      case 'pendingFollowups': {
        if (targetTelecallerIds.length > 0) andConditions.push(telecallerBaseCond);
        andConditions.push({
          followUpDate: { $ne: null },
          status: { $nin: ['converted', 'closed'] }
        });
        break;
      }

      case 'status': {
        if (targetTelecallerIds.length > 0) andConditions.push(telecallerBaseCond);
        if (statusValue) {
          andConditions.push({ status: statusValue });
        }
        if (dateOrCond) andConditions.push(dateOrCond);
        break;
      }

      case 'totalLeads':
      default: {
        if (targetTelecallerIds.length > 0) andConditions.push(telecallerBaseCond);
        if (dateOrCond) andConditions.push(dateOrCond);
        break;
      }
    }

    // Branch filter
    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      andConditions.push({ assignedBranch: new mongoose.Types.ObjectId(branchId) });
    }

    // Location filters
    if (state && state.trim()) {
      andConditions.push({ state: { $regex: new RegExp(`^${state.trim()}$`, 'i') } });
    }
    if (city && city.trim()) {
      andConditions.push({ city: { $regex: new RegExp(`^${city.trim()}$`, 'i') } });
    }
    if (pinCode && pinCode.trim()) {
      andConditions.push({ pinCode: pinCode.trim() });
    }
    if (location && location.trim()) {
      const locRegex = { $regex: location.trim(), $options: 'i' };
      andConditions.push({
        $or: [
          { city: locRegex },
          { state: locRegex },
          { pinCode: locRegex },
          { address: locRegex }
        ]
      });
    }

    // Search filter
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      andConditions.push({
        $or: [
          { name: searchRegex },
          { phone: searchRegex },
          { email: searchRegex },
          { city: searchRegex }
        ]
      });
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};

    const totalCount = await Lead.countDocuments(query);

    const leads = await Lead.find(query)
      .populate('originTelecaller', 'name email phone')
      .populate('assignedTo', 'name email phone role')
      .populate('assignedBranch', 'name city state')
      .populate('remarks.addedBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    res.status(200).json({
      status: 'success',
      count: leads.length,
      totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalCount / limitNum) || 1,
      data: leads
    });

  } catch (error) {
    next(error);
  }
};

